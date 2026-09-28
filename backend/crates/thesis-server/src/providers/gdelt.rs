use std::{
    collections::{HashMap, HashSet},
    time::Duration,
};

use chrono::{NaiveDate, NaiveDateTime, NaiveTime};
use reqwest::{
    header::{LOCATION, USER_AGENT},
    Response, Url,
};
use serde_json::{json, Value};
use thesis_api::{
    chroma::{ChromaClient, ChromaInclude, ChromaQueryRequest},
    embedding::EmbeddingClient,
    gdelt::{
        parse_gdelt_export_zip, GdeltRecord, GdeltSyncError, GdeltSyncFuture, GdeltSyncProvider,
        GdeltSyncResult, MAX_GDELT_EXPORT_ARCHIVE_BYTES, MAX_GDELT_SYNC_EVENT_LIMIT,
    },
};
use thesis_db::{Database, GdeltEventUpsert};
use thesis_ingest::gdelt::extract_domain;

const GDELT_LASTUPDATE_URL: &str = "https://data.gdeltproject.org/gdeltv2/lastupdate.txt";
const GDELT_HOST: &str = "data.gdeltproject.org";
const GDELT_USER_AGENT: &str = "ScoopNewsBot/1.0 (https://github.com/anomalyco/Thesis)";
const GDELT_REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_REDIRECTS: usize = 5;
const MAX_EMBEDDING_BATCH_SIZE: usize = 256;
const MAX_GDELT_LASTUPDATE_BYTES: usize = 64 * 1024;
const SEMANTIC_MATCH_THRESHOLD: f64 = 0.75;

#[derive(Clone)]
pub(crate) struct GdeltHttpSyncProvider {
    database: Database,
    http: reqwest::Client,
    chroma: ChromaClient,
    embedding: EmbeddingClient,
}

impl GdeltHttpSyncProvider {
    pub(crate) fn new(
        database: Database,
        http: reqwest::Client,
        chroma: ChromaClient,
        embedding: EmbeddingClient,
    ) -> Self {
        Self {
            database,
            http,
            chroma,
            embedding,
        }
    }

    async fn sync_inner(&self, limit: i64) -> Result<GdeltSyncResult, GdeltSyncError> {
        let limit = usize::try_from(limit).map_err(|_| {
            GdeltSyncError::Failed("GDELT limit must be a non-negative integer".to_owned())
        })?;
        let records = self.fetch_recent_events(limit).await?;
        let article_matches = self.match_articles(&records).await;
        let matched = article_matches
            .iter()
            .filter(|matched| matched.is_some())
            .count() as i64;
        let total = records.len() as i64;
        let now = chrono::Utc::now().naive_utc();
        let events: Vec<GdeltEventUpsert> = records
            .into_iter()
            .zip(article_matches)
            .map(|(record, article_match)| event_upsert(record, article_match, now))
            .collect();

        self.database
            .upsert_gdelt_events(&events)
            .await
            .map_err(|error| {
                GdeltSyncError::Failed(format!("could not persist GDELT events: {error}"))
            })?;

        Ok(GdeltSyncResult { matched, total })
    }

    async fn fetch_recent_events(&self, limit: usize) -> Result<Vec<GdeltRecord>, GdeltSyncError> {
        let response = self.request(GDELT_LASTUPDATE_URL).await?;
        let lastupdate = read_limited_body(
            response,
            MAX_GDELT_LASTUPDATE_BYTES,
            "GDELT lastupdate feed",
        )
        .await?;
        let lastupdate = String::from_utf8(lastupdate).map_err(|error| {
            GdeltSyncError::Failed(format!("GDELT lastupdate feed is not UTF-8: {error}"))
        })?;
        if lastupdate.trim_start().starts_with("Please limit requests") {
            return Err(GdeltSyncError::Failed(
                "GDELT lastupdate feed is rate limited".to_owned(),
            ));
        }

        let mut records = Vec::with_capacity(limit.min(1024));
        let export_urls = export_urls(&lastupdate).map_err(GdeltSyncError::Failed)?;
        for export_url in export_urls {
            if records.len() >= limit {
                break;
            }
            let response = self.request(&export_url).await?;
            let archive = read_limited_body(
                response,
                MAX_GDELT_EXPORT_ARCHIVE_BYTES,
                "GDELT export archive",
            )
            .await?;
            let remaining = limit - records.len();
            let parse_limit = remaining.min(MAX_GDELT_SYNC_EVENT_LIMIT);
            let parsed = tokio::task::spawn_blocking(move || {
                parse_gdelt_export_zip(&archive, parse_limit)
            })
            .await
            .map_err(|error| {
                GdeltSyncError::Failed(format!("GDELT export decoding task failed: {error}"))
            })?
            .map_err(|error| {
                GdeltSyncError::Failed(format!("could not decode GDELT export: {error}"))
            })?;
            records.extend(parsed);
        }
        Ok(records)
    }

    async fn request(&self, requested_url: &str) -> Result<Response, GdeltSyncError> {
        let mut url = Url::parse(requested_url).map_err(|error| {
            GdeltSyncError::Failed(format!("invalid GDELT URL {requested_url}: {error}"))
        })?;
        for redirect_count in 0..=MAX_REDIRECTS {
            if !is_gdelt_url(&url) {
                return Err(GdeltSyncError::Failed(format!(
                    "refusing non-GDELT URL {url}"
                )));
            }
            let response = self
                .http
                .get(url.clone())
                .header(USER_AGENT, GDELT_USER_AGENT)
                .timeout(GDELT_REQUEST_TIMEOUT)
                .send()
                .await
                .map_err(|error| {
                    GdeltSyncError::Failed(format!("GDELT request failed for {url}: {error}"))
                })?;
            if response.status().is_redirection() {
                if redirect_count == MAX_REDIRECTS {
                    return Err(GdeltSyncError::Failed(format!(
                        "GDELT request exceeded {MAX_REDIRECTS} redirects"
                    )));
                }
                let location = response
                    .headers()
                    .get(LOCATION)
                    .and_then(|value| value.to_str().ok())
                    .ok_or_else(|| {
                        GdeltSyncError::Failed(format!(
                            "GDELT redirect from {url} omitted a valid Location header"
                        ))
                    })?;
                url = url.join(location).map_err(|error| {
                    GdeltSyncError::Failed(format!("invalid GDELT redirect URL: {error}"))
                })?;
                continue;
            }
            if !response.status().is_success() {
                return Err(GdeltSyncError::Failed(format!(
                    "GDELT request to {url} returned HTTP {}",
                    response.status()
                )));
            }
            return Ok(response);
        }
        Err(GdeltSyncError::Failed(
            "GDELT redirect limit exceeded".to_owned(),
        ))
    }

    async fn match_articles(&self, records: &[GdeltRecord]) -> Vec<Option<ArticleMatch>> {
        let mut matches = vec![None; records.len()];
        let mut unique_urls = Vec::new();
        let mut seen_urls = HashSet::new();
        for record in records {
            if seen_urls.insert(record.source_url.clone()) {
                unique_urls.push(record.source_url.clone());
            }
        }

        if !unique_urls.is_empty() {
            match self.database.article_ids_by_url(&unique_urls).await {
                Ok(article_rows) => {
                    let mut article_ids_by_url = HashMap::with_capacity(article_rows.len());
                    for (url, article_id) in article_rows {
                        article_ids_by_url.entry(url).or_insert(article_id);
                    }
                    for (index, record) in records.iter().enumerate() {
                        if let Some(article_id) = article_ids_by_url.get(&record.source_url) {
                            matches[index] = Some(ArticleMatch {
                                article_id: *article_id,
                                method: MatchMethod::Url,
                            });
                        }
                    }
                }
                Err(error) => tracing::warn!(
                    error = ?error,
                    "GDELT URL matching failed; trying semantic matching"
                ),
            }
        }

        let unmatched: Vec<usize> = matches
            .iter()
            .enumerate()
            .filter_map(|(index, matched)| {
                (matched.is_none() && !records[index].document_identifier.is_empty())
                    .then_some(index)
            })
            .collect();
        if unmatched.is_empty() {
            return matches;
        }

        let collection = match self.chroma.get_collection().await {
            Ok(collection) => collection,
            Err(error) => {
                tracing::warn!(error = ?error, "GDELT semantic matching unavailable");
                return matches;
            }
        };
        for indices in unmatched.chunks(MAX_EMBEDDING_BATCH_SIZE) {
            let titles: Vec<String> = indices
                .iter()
                .map(|index| records[*index].document_identifier.clone())
                .collect();
            let embeddings = match self.embedding.embed(&titles, titles.len()).await {
                Ok(response) => response.embeddings,
                Err(error) => {
                    tracing::warn!(error = ?error, "GDELT title embedding failed");
                    continue;
                }
            };
            let response = match collection
                .query(ChromaQueryRequest {
                    query_embeddings: embeddings,
                    n_results: 10,
                    where_filter: None,
                    where_document: None,
                    include: vec![ChromaInclude::Distances],
                })
                .await
            {
                Ok(response) => response,
                Err(error) => {
                    tracing::warn!(error = ?error, "GDELT Chroma query failed");
                    continue;
                }
            };
            for (position, index) in indices.iter().copied().enumerate() {
                let ids = response
                    .ids
                    .get(position)
                    .map(Vec::as_slice)
                    .unwrap_or_default();
                let distances = response
                    .distances
                    .as_ref()
                    .and_then(|rows| rows.get(position))
                    .map(Vec::as_slice)
                    .unwrap_or_default();
                if let Some(article_id) = best_embedding_match(ids, distances) {
                    matches[index] = Some(ArticleMatch {
                        article_id,
                        method: MatchMethod::Embedding,
                    });
                }
            }
        }
        matches
    }
}

impl GdeltSyncProvider for GdeltHttpSyncProvider {
    fn sync(&self, _minutes: i64, limit: i64) -> GdeltSyncFuture<GdeltSyncResult> {
        let provider = self.clone();
        Box::pin(async move { provider.sync_inner(limit).await })
    }
}
fn append_limited_body(
    body: &mut Vec<u8>,
    chunk: &[u8],
    max_bytes: usize,
    resource: &str,
) -> Result<(), GdeltSyncError> {
    if body
        .len()
        .checked_add(chunk.len())
        .filter(|length| *length <= max_bytes)
        .is_none()
    {
        return Err(GdeltSyncError::Failed(format!(
            "{resource} exceeds the {max_bytes}-byte limit"
        )));
    }
    body.extend_from_slice(chunk);
    Ok(())
}

async fn read_limited_body(
    mut response: Response,
    max_bytes: usize,
    resource: &str,
) -> Result<Vec<u8>, GdeltSyncError> {
    if response
        .content_length()
        .is_some_and(|length| length > max_bytes as u64)
    {
        return Err(GdeltSyncError::Failed(format!(
            "{resource} exceeds the {max_bytes}-byte limit"
        )));
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|error| {
        GdeltSyncError::Failed(format!("could not read {resource}: {error}"))
    })? {
        append_limited_body(&mut body, &chunk, max_bytes, resource)?;
    }
    Ok(body)
}

#[derive(Clone, Copy)]
struct ArticleMatch {
    article_id: i64,
    method: MatchMethod,
}

#[derive(Clone, Copy)]
enum MatchMethod {
    Url,
    Embedding,
}

impl MatchMethod {
    fn as_str(self) -> &'static str {
        match self {
            Self::Url => "url",
            Self::Embedding => "embedding",
        }
    }
}

fn export_urls(lastupdate: &str) -> Result<Vec<String>, String> {
    let urls: Vec<String> = lastupdate
        .trim()
        .lines()
        .take(3)
        .filter_map(|line| line.split_whitespace().nth(2))
        .filter(|url| url.starts_with("http") && url.ends_with(".export.CSV.zip"))
        .take(2)
        .map(str::to_owned)
        .collect();
    if urls.is_empty() {
        Err("GDELT lastupdate feed contains no event export URLs".to_owned())
    } else {
        Ok(urls)
    }
}

fn is_gdelt_url(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https")
        && url.host_str() == Some(GDELT_HOST)
        && url.username().is_empty()
        && url.password().is_none()
}


fn best_embedding_match(ids: &[String], distances: &[f64]) -> Option<i64> {
    let mut best: Option<(i64, f64)> = None;
    for (id, distance) in ids.iter().zip(distances) {
        let Some(article_id) = id
            .strip_prefix("article_")
            .and_then(|id| id.parse::<i64>().ok())
        else {
            continue;
        };
        let similarity = 1.0 - distance;
        if similarity > 0.0
            && similarity >= SEMANTIC_MATCH_THRESHOLD
            && best.is_none_or(|(_, best_similarity)| similarity > best_similarity)
        {
            best = Some((article_id, similarity));
        }
    }
    best.map(|(article_id, _)| article_id)
}

fn event_upsert(
    record: GdeltRecord,
    article_match: Option<ArticleMatch>,
    matched_at: NaiveDateTime,
) -> GdeltEventUpsert {
    let published_at = NaiveDate::parse_from_str(&record.sql_date, "%Y%m%d")
        .unwrap_or_else(|_| epoch_date())
        .and_time(NaiveTime::MIN);
    let raw_data: Value = json!({
        "GlobalEventID": &record.global_event_id,
        "SQLDATE": &record.sql_date,
        "SOURCEURL": &record.source_url,
        "DocumentIdentifier": &record.document_identifier,
        "EventCode": &record.event_code,
        "EventRootCode": &record.event_root_code,
        "Actor1Name": &record.actor1_name,
        "Actor1CountryCode": &record.actor1_country_code,
        "Actor2Name": &record.actor2_name,
        "Actor2CountryCode": &record.actor2_country_code,
        "AvgTone": &record.avg_tone,
        "GoldsteinScale": &record.goldstein_scale,
    });
    let title = truncate_title(record.document_identifier);
    let (article_id, match_method, similarity_score) = match_values(article_match);

    GdeltEventUpsert {
        gdelt_id: record.global_event_id,
        url: Some(record.source_url.clone()),
        title: Some(title),
        source: Some(extract_domain(&record.source_url).to_owned()),
        published_at: Some(published_at),
        event_code: Some(record.event_code),
        event_root_code: Some(record.event_root_code),
        actor1_name: Some(record.actor1_name),
        actor1_country: Some(record.actor1_country_code),
        actor2_name: Some(record.actor2_name),
        actor2_country: Some(record.actor2_country_code),
        tone: Some(record.avg_tone.parse().unwrap_or(0.0)),
        goldstein_scale: Some(record.goldstein_scale.parse().unwrap_or(0.0)),
        article_id,
        matched_at: article_match.map(|_| matched_at),
        match_method,
        similarity_score,
        raw_data,
    }
}

fn epoch_date() -> NaiveDate {
    NaiveDate::from_ymd_opt(1970, 1, 1).expect("1970-01-01 is a valid date")
}

fn truncate_title(title: String) -> String {
    let mut chars = title.char_indices();
    match chars.nth(500) {
        Some((byte_offset, _)) => title[..byte_offset].to_owned(),
        None => title,
    }
}

fn match_values(article_match: Option<ArticleMatch>) -> (Option<i64>, Option<String>, Option<f64>) {
    match article_match {
        Some(article_match) => {
            let score = matches!(article_match.method, MatchMethod::Embedding).then_some(0.0);
            (
                Some(article_match.article_id),
                Some(article_match.method.as_str().to_owned()),
                score,
            )
        }
        None => (None, None, None),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        append_limited_body, best_embedding_match, event_upsert, export_urls, ArticleMatch,
        MatchMethod, SEMANTIC_MATCH_THRESHOLD,
    };
    use chrono::NaiveDate;
    use thesis_api::gdelt::GdeltRecord;


    fn sample_record() -> GdeltRecord {
        GdeltRecord {
            global_event_id: "event-1".to_owned(),
            sql_date: "20240923".to_owned(),
            source_url: "https://www.example.org/news/story".to_owned(),
            document_identifier: "A headline".to_owned(),
            event_code: "010".to_owned(),
            event_root_code: "01".to_owned(),
            actor1_name: "Actor One".to_owned(),
            actor1_country_code: "US".to_owned(),
            actor2_name: "Actor Two".to_owned(),
            actor2_country_code: "GB".to_owned(),
            avg_tone: "-1.25".to_owned(),
            goldstein_scale: "2.0".to_owned(),
        }
    }


    #[test]
    fn extracts_only_export_urls_from_the_first_three_lines_and_caps_at_two() {
        let feed = concat!(
            "10 checksum http://data.gdeltproject.org/one.export.CSV.zip\n",
            "20 checksum http://data.gdeltproject.org/two.mentions.CSV.zip\n",
            "30 checksum http://data.gdeltproject.org/two.export.CSV.zip\n",
            "40 checksum http://data.gdeltproject.org/three.export.CSV.zip\n",
        );

        assert_eq!(
            export_urls(feed).expect("feed contains export URLs"),
            vec![
                "http://data.gdeltproject.org/one.export.CSV.zip",
                "http://data.gdeltproject.org/two.export.CSV.zip",
            ]
        );
    }

    #[test]
    fn rejects_lastupdate_feed_without_event_exports() {
        assert!(export_urls("Please limit requests").is_err());
        assert!(export_urls("").is_err());
    }

    #[test]
    fn limited_body_accepts_exact_limit_and_rejects_the_next_byte() {
        let mut body = Vec::new();
        append_limited_body(&mut body, b"abc", 3, "export").expect("exact limit is accepted");
        assert_eq!(body, b"abc");
        assert!(append_limited_body(&mut body, b"d", 3, "export").is_err());
        assert_eq!(body, b"abc");
    }
    #[test]
    fn event_mapping_preserves_fields_and_uses_epoch_for_invalid_dates() {
        let mut record = sample_record();
        record.sql_date = "not-a-date".to_owned();
        record.avg_tone = "invalid".to_owned();
        let now = NaiveDate::from_ymd_opt(2024, 9, 23)
            .expect("test date is valid")
            .and_hms_opt(1, 2, 3)
            .expect("test time is valid");
        let event = event_upsert(
            record,
            Some(ArticleMatch {
                article_id: 42,
                method: MatchMethod::Embedding,
            }),
            now,
        );

        assert_eq!(event.gdelt_id, "event-1");
        assert_eq!(event.source.as_deref(), Some("example.org"));
        assert_eq!(
            event.published_at,
            Some(
                NaiveDate::from_ymd_opt(1970, 1, 1)
                    .unwrap()
                    .and_hms_opt(0, 0, 0)
                    .unwrap()
            )
        );
        assert_eq!(event.tone, Some(0.0));
        assert_eq!(event.article_id, Some(42));
        assert_eq!(event.matched_at, Some(now));
        assert_eq!(event.match_method.as_deref(), Some("embedding"));
        assert_eq!(event.similarity_score, Some(0.0));
        assert_eq!(event.raw_data["SQLDATE"], "not-a-date");
    }

    #[test]
    fn truncates_titles_at_500_unicode_characters() {
        let mut record = sample_record();
        record.document_identifier = "é".repeat(501);
        let now = NaiveDate::from_ymd_opt(1970, 1, 1)
            .expect("test date is valid")
            .and_hms_opt(0, 0, 0)
            .expect("test time is valid");

        let title = event_upsert(record, None, now)
            .title
            .expect("GDELT title is stored");

        assert_eq!(title.chars().count(), 500);
        assert_eq!(title, "é".repeat(500));
    }

    #[test]
    fn embedding_match_requires_article_id_and_similarity_threshold() {
        let ids = vec![
            "not-an-article-7".to_owned(),
            "article_10".to_owned(),
            "article_11".to_owned(),
            "article_bad".to_owned(),
        ];
        let distances = vec![0.0, 0.4, 1.0 - SEMANTIC_MATCH_THRESHOLD, 0.0];

        assert_eq!(best_embedding_match(&ids, &distances), Some(11));
        assert_eq!(best_embedding_match(&ids, &[0.0]), None);
    }
}
