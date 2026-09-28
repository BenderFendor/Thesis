use super::*;
#[derive(Clone, Copy, Debug, Default)]
pub(super) struct RetrievalSummary {
    pub(super) semantic_count: usize,
    pub(super) keyword_count: usize,
    pub(super) recent_count: usize,
    pub(super) total: usize,
    pub(super) vector_enabled: bool,
}

pub(super) struct RetrievalResult {
    pub(super) articles: Vec<Value>,
    pub(super) summary: RetrievalSummary,
}

#[derive(Clone, Debug)]
struct SemanticHit {
    chroma_id: String,
    article_id: i64,
    distance: f64,
    similarity_score: f64,
    metadata: Map<String, Value>,
    preview: String,
}

#[derive(Clone)]
pub(crate) struct NewsResearchProviderImpl {
    pub(super) database: Database,
    pub(super) clients: ProviderClients,
    pub(super) catalog: ResearchModelCatalog,
    vector_enabled: bool,
}

impl NewsResearchProviderImpl {
    pub(crate) fn new(database: Database, clients: ProviderClients) -> Self {
        let vector_enabled =
            vector_store_enabled(std::env::var("ENABLE_VECTOR_STORE").ok().as_deref());
        Self {
            database,
            clients,
            catalog: ResearchModelCatalog::from_environment(),
            vector_enabled,
        }
    }

    pub(super) async fn retrieve(&self, query: &str) -> Result<RetrievalResult, NewsResearchError> {
        let vector_enabled =
            vector_store_available(self.vector_enabled, &self.clients.chroma).await;
        let semantic_hits = if vector_enabled {
            match self.search_semantic(query).await {
                Ok(hits) => hits,
                Err(error) => {
                    warn!(%error, "news research semantic retrieval failed");
                    Vec::new()
                }
            }
        } else {
            Vec::new()
        };

        let keyword_floor = 25_i64.max(KEYWORD_LIMIT / 2);
        let keyword_records = if query.is_empty() {
            Vec::new()
        } else {
            self.database
                .search_news_articles_by_keyword(query, KEYWORD_LIMIT)
                .await
                .map_err(|error| provider_failed(format!("keyword article search failed: {error}")))?
        };

        let semantic_ids = semantic_hits
            .iter()
            .map(|hit| hit.article_id)
            .collect::<Vec<_>>();
        let semantic_records = if semantic_ids.is_empty() {
            Vec::new()
        } else {
            self.database
                .load_news_articles_by_ids(&semantic_ids)
                .await
                .map_err(|error| provider_failed(format!("semantic article lookup failed: {error}")))?
        };
        let semantic_record_map = semantic_records
            .into_iter()
            .map(|record| (record.id, record))
            .collect::<HashMap<_, _>>();

        let recent_records = if keyword_records.len() < keyword_floor as usize {
            self.database
                .list_recent_news_research_articles(RECENT_LIMIT)
                .await
                .map_err(|error| provider_failed(format!("recent article search failed: {error}")))?
        } else {
            Vec::new()
        };

        let semantic_articles = semantic_hits
            .iter()
            .map(|hit| {
                semantic_record_map
                    .get(&hit.article_id)
                    .map(article_record_to_value)
                    .unwrap_or_else(|| semantic_fallback_article(hit))
            })
            .map(|mut article| {
                let hit = semantic_hits
                    .iter()
                    .find(|hit| article.get("id").and_then(Value::as_i64) == Some(hit.article_id));
                if let Some(hit) = hit {
                    let object = article.as_object_mut().expect("article projection is an object");
                    object.insert(
                        "retrieval_method".to_owned(),
                        Value::String("semantic_vector_store".to_owned()),
                    );
                    object.insert("semantic_score".to_owned(), json!(hit.similarity_score));
                    object.insert("semantic_distance".to_owned(), json!(hit.distance));
                    object.insert("chroma_id".to_owned(), json!(hit.chroma_id));
                    object.insert("preview".to_owned(), json!(hit.preview));
                }
                article
            })
            .collect::<Vec<_>>();

        let keyword_articles = keyword_records
            .iter()
            .map(|record| {
                let mut article = article_record_to_value(record);
                article
                    .as_object_mut()
                    .expect("article projection is an object")
                    .insert(
                        "retrieval_method".to_owned(),
                        Value::String("keyword_postgres".to_owned()),
                    );
                article
            })
            .collect::<Vec<_>>();

        let recent_articles = recent_records
            .iter()
            .map(|record| {
                let mut article = article_record_to_value(record);
                article
                    .as_object_mut()
                    .expect("article projection is an object")
                    .insert(
                        "retrieval_method".to_owned(),
                        Value::String("recent_postgres".to_owned()),
                    );
                article
            })
            .collect::<Vec<_>>();

        let mut deduper = ArticleDeduper::new(MAX_RETRIEVED_ARTICLES);
        deduper.add_bucket(&semantic_articles);
        deduper.add_bucket(&keyword_articles);
        if keyword_articles.len() < keyword_floor as usize {
            deduper.add_bucket(&recent_articles);
        }
        let articles = deduper.finish();

        Ok(RetrievalResult {
            summary: RetrievalSummary {
                semantic_count: semantic_articles.len(),
                keyword_count: keyword_articles.len(),
                recent_count: if keyword_articles.len() < keyword_floor as usize {
                    recent_articles.len()
                } else {
                    0
                },
                total: articles.len(),
                vector_enabled,
            },
            articles,
        })
    }

    async fn search_semantic(&self, query: &str) -> Result<Vec<SemanticHit>, String> {
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let embedded = self
            .clients
            .embedding
            .embed(&[query.to_owned()], 32)
            .await
            .map_err(|error| error.to_string())?;
        let query_embedding = embedded
            .embeddings
            .into_iter()
            .next()
            .ok_or_else(|| "embedding service returned no query vector".to_owned())?;
        let collection = self
            .clients
            .chroma
            .get_collection()
            .await
            .map_err(|error| error.to_string())?;
        let response = collection
            .query(ChromaQueryRequest {
                query_embeddings: vec![query_embedding],
                n_results: SEMANTIC_LIMIT,
                where_filter: None,
                where_document: None,
                include: vec![
                    ChromaInclude::Metadatas,
                    ChromaInclude::Documents,
                    ChromaInclude::Distances,
                ],
            })
            .await
            .map_err(|error| error.to_string())?;
        let ids = response.ids.into_iter().next().unwrap_or_default();
        let distances = response
            .distances
            .and_then(|rows| rows.into_iter().next())
            .unwrap_or_default();
        let metadatas = response
            .metadatas
            .and_then(|rows| rows.into_iter().next())
            .unwrap_or_default();
        let documents = response
            .documents
            .and_then(|rows| rows.into_iter().next())
            .unwrap_or_default();
        let result_count = ids
            .len()
            .min(distances.len())
            .min(metadatas.len())
            .min(documents.len());
        let mut hits = Vec::with_capacity(result_count);
        for index in 0..result_count {
            let chroma_id = ids[index].clone();
            let article_id = chroma_id
                .replace("article_", "")
                .parse::<i64>()
                .map_err(|_| "Chroma returned an invalid article id".to_owned())?;
            let distance = distances[index];
            let metadata = metadatas[index].clone().unwrap_or_default();
            let preview = documents[index]
                .as_deref()
                .map(|document| take_chars(document, 200))
                .unwrap_or_default();
            hits.push(SemanticHit {
                chroma_id,
                article_id,
                distance,
                similarity_score: 1.0 - distance,
                metadata,
                preview,
            });
        }
        Ok(hits)
    }

    pub(super) fn resolve_model(&self, model_id: Option<&str>) -> Result<ResearchModelOption, NewsResearchError> {
        if self.catalog.models.is_empty() {
            return Err(provider_failed("No research model is configured on the backend."));
        }
        let selected_id = match model_id {
            Some(id) => id,
            None => self
                .catalog
                .default
                .as_deref()
                .ok_or_else(|| provider_failed("No research model is configured on the backend."))?,
        };
        self.catalog
            .models
            .iter()
            .find(|model| model.id == selected_id)
            .cloned()
            .ok_or_else(|| provider_failed("That research model is not configured on the backend."))
    }

    pub(super) fn chat_client(&self) -> Result<ChatCompletionClient, NewsResearchError> {
        self.clients
            .chat
            .clone()
            .ok_or(NewsResearchError::ProviderUnavailable)
    }
}
#[derive(Clone)]
pub(super) struct ArticleDeduper {
    max_total: usize,
    articles: Vec<Value>,
    seen_ids: HashSet<String>,
    seen_urls: HashSet<String>,
}

impl ArticleDeduper {
    pub(super) fn new(max_total: usize) -> Self {
        Self {
            max_total,
            articles: Vec::new(),
            seen_ids: HashSet::new(),
            seen_urls: HashSet::new(),
        }
    }

    pub(super) fn add_bucket(&mut self, bucket: &[Value]) {
        for article in bucket {
            if self.articles.len() >= self.max_total {
                return;
            }
            self.add_article(article);
        }
    }

    fn add_article(&mut self, article: &Value) {
        let Some(source) = article.as_object() else {
            return;
        };
        if source.is_empty() || self.articles.len() >= self.max_total {
            return;
        }
        let mut payload = source.clone();
        payload
            .entry("title".to_owned())
            .or_insert_with(|| Value::String("Untitled article".to_owned()));
        let summary = payload.get("summary").cloned().unwrap_or(Value::Null);
        payload.entry("description".to_owned()).or_insert(summary);
        payload
            .entry("category".to_owned())
            .or_insert_with(|| Value::String("general".to_owned()));

        let article_id = truthy_value(payload.get("id"))
            .or_else(|| truthy_value(payload.get("article_id")))
            .map(value_to_string);
        let url = truthy_string(payload.get("url"))
            .or_else(|| truthy_string(payload.get("link")))
            .map(|url| url.trim_end_matches('/').to_owned());
        if article_id
            .as_ref()
            .is_some_and(|id| self.seen_ids.contains(id))
            || url.as_ref().is_some_and(|url| self.seen_urls.contains(url))
        {
            return;
        }
        if let Some(id) = article_id {
            self.seen_ids.insert(id);
        }
        if let Some(url) = url {
            self.seen_urls.insert(url);
        }
        self.articles.push(Value::Object(payload));
    }

    pub(super) fn finish(self) -> Vec<Value> {
        self.articles
    }
}

pub(super) fn article_record_to_value(record: &SearchArticleRecord) -> Value {
    let published = naive_datetime_to_value(Some(record.published_at));
    let image = optional_string_value(record.image_url.as_deref());
    let summary = optional_string_value(record.summary.as_deref());
    let content = optional_string_value(record.content.as_deref());
    let description = record
        .summary
        .as_deref()
        .or(record.content.as_deref())
        .map(|value| Value::String(value.to_owned()))
        .unwrap_or(Value::Null);
    let category = record
        .category
        .as_deref()
        .filter(|value| !value.is_empty())
        .unwrap_or("general");
    let title = if record.title.is_empty() {
        "Untitled article"
    } else {
        &record.title
    };
    let source = if record.source.is_empty() {
        "Unknown"
    } else {
        &record.source
    };
    json!({
        "id": record.id,
        "title": title,
        "source": source,
        "provider": "internal",
        "source_id": record.source_id,
        "country": record.country,
        "credibility": record.credibility,
        "bias": record.bias,
        "summary": summary,
        "content": content,
        "description": description,
        "image": image,
        "image_url": image,
        "published": published,
        "published_at": published,
        "category": category,
        "url": record.url,
        "link": record.url,
        "author": record.author,
        "authors": record.authors,
        "tags": record.tags,
        "original_language": record.original_language,
        "translated": record.translated,
        "chroma_id": record.chroma_id,
        "embedding_generated": record.embedding_generated,
        "created_at": naive_datetime_to_value(record.created_at),
        "updated_at": naive_datetime_to_value(record.updated_at),
        "source_country": record.country,
        "mentioned_countries": record.mentioned_countries,
    })
}

fn semantic_fallback_article(hit: &SemanticHit) -> Value {
    let metadata = &hit.metadata;
    let url = metadata.get("url").cloned().unwrap_or(Value::Null);
    let title = truthy_string(metadata.get("title"))
        .or_else(|| truthy_string(Some(&url)))
        .map(Value::String)
        .unwrap_or_else(|| Value::String("Semantic match".to_owned()));
    let summary = metadata.get("summary").cloned().unwrap_or(Value::Null);
    json!({
        "id": hit.article_id,
        "title": title,
        "source": metadata.get("source").cloned().unwrap_or_else(|| json!("Unknown")),
        "category": metadata.get("category").cloned().unwrap_or_else(|| json!("general")),
        "description": summary,
        "summary": summary,
        "link": url,
        "url": url,
        "published": metadata.get("published").cloned().unwrap_or(Value::Null),
        "image": metadata.get("image").cloned().unwrap_or(Value::Null),
        "country": metadata.get("country").cloned().unwrap_or(Value::Null),
        "bias": metadata.get("bias").cloned().unwrap_or(Value::Null),
        "credibility": metadata.get("credibility").cloned().unwrap_or(Value::Null),
        "chroma_id": hit.chroma_id,
    })
}

fn naive_datetime_to_value(value: Option<NaiveDateTime>) -> Value {
    value
        .map(|date| Value::String(date.format("%Y-%m-%dT%H:%M:%S%.f").to_string()))
        .unwrap_or(Value::Null)
}

fn optional_string_value(value: Option<&str>) -> Value {
    value.map(|value| Value::String(value.to_owned())).unwrap_or(Value::Null)
}
fn vector_store_enabled(value: Option<&str>) -> bool {
    !matches!(value, Some("0" | "false" | "False" | ""))
}

async fn vector_store_available(
    enabled: bool,
    chroma: &thesis_api::chroma::ChromaClient,
) -> bool {
    enabled && chroma.heartbeat().await.is_ok()
}

#[cfg(test)]
mod tests {
    use super::{vector_store_available, vector_store_enabled};
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::sync::mpsc::{self, Receiver};
    use std::thread::{self, JoinHandle};
    use std::time::Duration;
    use thesis_api::chroma::{ChromaClient, ChromaConfig};

    #[test]
    fn vector_store_environment_flag_matches_fastapi_false_values() {
        assert!(vector_store_enabled(None));
        assert!(vector_store_enabled(Some("1")));
        assert!(vector_store_enabled(Some("FALSE")));
        assert!(vector_store_enabled(Some(" false ")));
        for disabled in ["0", "false", "False", ""] {
            assert!(!vector_store_enabled(Some(disabled)));
        }
    }

    #[tokio::test]
    async fn vector_store_availability_requires_a_successful_chroma_heartbeat() {
        let (chroma, request, server) = chroma_fixture(200, r#"{"nanosecond heartbeat":123}"#);
        assert!(vector_store_available(true, &chroma).await);
        assert!(request
            .recv_timeout(Duration::from_secs(2))
            .expect("Chroma heartbeat request")
            .starts_with("GET /api/v2/heartbeat "));
        server.join().expect("Chroma server thread");

        let (chroma, request, server) = chroma_fixture(503, r#"{"error":"offline"}"#);
        assert!(!vector_store_available(true, &chroma).await);
        request
            .recv_timeout(Duration::from_secs(2))
            .expect("unavailable Chroma request");
        server.join().expect("Chroma server thread");
    }

    fn chroma_fixture(
        status: u16,
        body: &'static str,
    ) -> (ChromaClient, Receiver<String>, JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind Chroma fixture");
        let address = listener.local_addr().expect("Chroma fixture address");
        let (sender, receiver) = mpsc::channel();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept heartbeat");
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .expect("set Chroma fixture timeout");
            sender
                .send(read_request_headers(&mut stream))
                .expect("send captured heartbeat request");
            let reason = if status == 200 {
                "OK"
            } else {
                "Service Unavailable"
            };
            write!(
                stream,
                "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .expect("write heartbeat response");
        });
        let base_url = format!("http://{address}");
        let configuration = ChromaConfig::new(
            &base_url,
            "default_tenant",
            "default_database",
            "articles",
            Duration::from_secs(2),
        )
        .expect("Chroma test config");
        let client = ChromaClient::new(
            reqwest::Client::builder()
                .no_proxy()
                .build()
                .expect("Chroma test HTTP client"),
            configuration,
        );
        (client, receiver, server)
    }

    fn read_request_headers(stream: &mut TcpStream) -> String {
        let mut request = Vec::new();
        let mut buffer = [0; 1024];
        loop {
            let bytes_read = stream.read(&mut buffer).expect("read heartbeat request");
            assert_ne!(bytes_read, 0, "client closed before heartbeat request");
            request.extend_from_slice(&buffer[..bytes_read]);
            if request.windows(4).any(|window| window == b"\r\n\r\n") {
                return String::from_utf8_lossy(&request).into_owned();
            }
        }
    }
}
