//! Typed HTTP access to the configured Chroma collection.
//!
//! This adapter targets the `/api/v2` contract used by the repository's pinned
//! Chroma 0.5.23 client. It deliberately accepts a shared `reqwest::Client`; the
//! server composition layer owns TLS, connection timeouts, and client policy.

use std::fmt;
use std::num::NonZeroUsize;
use std::time::Duration;

use reqwest::{StatusCode, Url};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

const CHROMA_API_PREFIX: [&str; 2] = ["api", "v2"];
const DEFAULT_MAX_RESPONSE_BYTES: usize = 16 * 1024 * 1024;
const MAX_GET_PAGE_SIZE: usize = 1_000;
const COLLECTION_ID_LENGTH: usize = 36;

/// The configured endpoint and bounded request/response policy for one collection.
#[derive(Clone, Debug)]
pub struct ChromaConfig {
    base_url: Url,
    tenant: String,
    database: String,
    collection: String,
    request_timeout: Duration,
    max_response_bytes: usize,
}

impl ChromaConfig {
    /// Validate a root Chroma base URL and explicit collection coordinates.
    pub fn new(
        base_url: &str,
        tenant: impl Into<String>,
        database: impl Into<String>,
        collection: impl Into<String>,
        request_timeout: Duration,
    ) -> Result<Self, ChromaError> {
        let base_url = validated_base_url(base_url)?;
        let tenant = tenant.into();
        let database = database.into();
        let collection = collection.into();
        validate_path_name(&tenant, "tenant")?;
        validate_path_name(&database, "database")?;
        validate_collection_name(&collection)?;
        validate_timeout(request_timeout)?;

        Ok(Self {
            base_url,
            tenant,
            database,
            collection,
            request_timeout,
            max_response_bytes: DEFAULT_MAX_RESPONSE_BYTES,
        })
    }

    /// Set the maximum bytes retained from any Chroma response body.
    pub fn with_max_response_bytes(
        mut self,
        max_response_bytes: usize,
    ) -> Result<Self, ChromaError> {
        if max_response_bytes == 0 {
            return Err(ChromaError::InvalidConfig(
                "maximum response body size must be greater than zero",
            ));
        }
        self.max_response_bytes = max_response_bytes;
        Ok(self)
    }
}

/// A cloneable Chroma HTTP client for one explicitly configured collection.
#[derive(Clone, Debug)]
pub struct ChromaClient {
    http: reqwest::Client,
    config: ChromaConfig,
}

impl ChromaClient {
    /// Bind a shared HTTP client to a validated Chroma configuration.
    pub fn new(http: reqwest::Client, config: ChromaConfig) -> Self {
        Self { http, config }
    }

    /// Check Chroma reachability using its versioned heartbeat endpoint.
    pub async fn heartbeat(&self) -> Result<u64, ChromaError> {
        let url = self.endpoint(&["heartbeat"])?;
        let response: HeartbeatResponse = self
            .send(self.http.get(url).timeout(self.config.request_timeout))
            .await?;
        Ok(response.nanosecond_heartbeat)
    }

    /// Retrieve the configured collection by its name.
    pub async fn get_collection(&self) -> Result<ChromaCollection, ChromaError> {
        let url = self.endpoint(&[
            "tenants",
            &self.config.tenant,
            "databases",
            &self.config.database,
            "collections",
            &self.config.collection,
        ])?;
        let info: ChromaCollectionInfo = self
            .send(self.http.get(url).timeout(self.config.request_timeout))
            .await?;
        self.collection(info)
    }

    /// Create the configured collection with the supplied metadata.
    pub async fn create_collection(
        &self,
        metadata: Option<Map<String, Value>>,
    ) -> Result<ChromaCollection, ChromaError> {
        self.create_collection_request(metadata, false).await
    }

    /// Atomically get or create the configured collection with the supplied metadata.
    pub async fn get_or_create_collection(
        &self,
        metadata: Option<Map<String, Value>>,
    ) -> Result<ChromaCollection, ChromaError> {
        self.create_collection_request(metadata, true).await
    }

    fn collection(&self, info: ChromaCollectionInfo) -> Result<ChromaCollection, ChromaError> {
        if info.name != self.config.collection {
            return Err(ChromaError::InvalidResponse {
                message: "collection response name does not match configured collection".into(),
                body: String::new(),
            });
        }
        if info
            .tenant
            .as_deref()
            .is_some_and(|tenant| tenant != self.config.tenant)
            || info
                .database
                .as_deref()
                .is_some_and(|database| database != self.config.database)
        {
            return Err(ChromaError::InvalidResponse {
                message: "collection response tenant/database does not match configuration".into(),
                body: String::new(),
            });
        }
        if !is_collection_id(&info.id) {
            return Err(ChromaError::InvalidResponse {
                message: "collection response contains an invalid collection id".into(),
                body: String::new(),
            });
        }
        Ok(ChromaCollection {
            client: self.clone(),
            info,
        })
    }

    async fn create_collection_request(
        &self,
        metadata: Option<Map<String, Value>>,
        get_or_create: bool,
    ) -> Result<ChromaCollection, ChromaError> {
        let url = self.collection_root()?;
        let body = CreateCollectionBody {
            name: &self.config.collection,
            metadata,
            configuration: None,
            get_or_create,
        };
        let info: ChromaCollectionInfo = self
            .send_json(
                self.http.post(url).timeout(self.config.request_timeout),
                &body,
            )
            .await?;
        self.collection(info)
    }

    fn collection_root(&self) -> Result<Url, ChromaError> {
        self.endpoint(&[
            "tenants",
            &self.config.tenant,
            "databases",
            &self.config.database,
            "collections",
        ])
    }

    fn endpoint(&self, suffix: &[&str]) -> Result<Url, ChromaError> {
        let mut url = self.config.base_url.clone();
        let mut segments = url
            .path_segments_mut()
            .map_err(|_| ChromaError::InvalidConfig("base URL cannot accept path segments"))?;
        segments.pop_if_empty();
        segments.extend(CHROMA_API_PREFIX);
        for segment in suffix {
            segments.push(segment);
        }
        drop(segments);
        Ok(url)
    }

    async fn send<T: DeserializeOwned>(
        &self,
        request: reqwest::RequestBuilder,
    ) -> Result<T, ChromaError> {
        read_json_response(
            request.send().await.map_err(ChromaError::Http)?,
            self.config.max_response_bytes,
        )
        .await
    }

    async fn send_json<T: DeserializeOwned, B: Serialize>(
        &self,
        request: reqwest::RequestBuilder,
        body: &B,
    ) -> Result<T, ChromaError> {
        self.send(request.json(body)).await
    }
    async fn send_unit_json<B: Serialize>(
        &self,
        request: reqwest::RequestBuilder,
        body: &B,
    ) -> Result<(), ChromaError> {
        let mut response = request.json(body).send().await.map_err(ChromaError::Http)?;
        let status = response.status();
        let body = read_bounded_body(&mut response, self.config.max_response_bytes, status).await?;
        if !status.is_success() {
            return Err(ChromaError::HttpStatus {
                status,
                body: String::from_utf8_lossy(&body).into_owned(),
            });
        }
        if body.is_empty()
            || serde_json::from_slice::<Value>(&body).is_ok_and(|value| value.is_null())
        {
            return Ok(());
        }
        Err(ChromaError::InvalidResponse {
            message: "Chroma write response must be empty or JSON null".into(),
            body: String::from_utf8_lossy(&body).into_owned(),
        })
    }
}

/// A resolved Chroma collection. Operations address it by the server-issued UUID.
#[derive(Clone, Debug)]
pub struct ChromaCollection {
    client: ChromaClient,
    /// Server-reported collection identity and metadata.
    pub info: ChromaCollectionInfo,
}

impl ChromaCollection {
    /// Count collection records without downloading IDs or metadata.
    pub async fn count(&self) -> Result<u64, ChromaError> {
        let url = self.client.endpoint(&[
            "tenants",
            &self.client.config.tenant,
            "databases",
            &self.client.config.database,
            "collections",
            &self.info.id,
            "count",
        ])?;
        self.client
            .send(
                self.client
                    .http
                    .get(url)
                    .timeout(self.client.config.request_timeout),
            )
            .await
    }

    /// Retrieve one Chroma `get` page with optional IDs/filters and included fields.
    pub async fn get(&self, request: ChromaGetRequest) -> Result<ChromaGetResponse, ChromaError> {
        if request.include.contains(&ChromaInclude::Distances) {
            return Err(ChromaError::InvalidRequest(
                "Chroma get does not support distances; use query instead",
            ));
        }
        if request.limit.is_some_and(|limit| limit > MAX_GET_PAGE_SIZE) {
            return Err(ChromaError::InvalidRequest(
                "get limit exceeds the per-request cap",
            ));
        }
        let url = self.client.endpoint(&[
            "tenants",
            &self.client.config.tenant,
            "databases",
            &self.client.config.database,
            "collections",
            &self.info.id,
            "get",
        ])?;
        let body = GetBody {
            ids: request.ids,
            where_filter: request.where_filter,
            sort: None,
            limit: request.limit,
            offset: request.offset,
            where_document: request.where_document,
            include: request.include,
        };
        let response: ChromaGetResponse = self
            .client
            .send_json(
                self.client
                    .http
                    .post(url)
                    .timeout(self.client.config.request_timeout),
                &body,
            )
            .await?;
        response.validate_alignment()?;
        Ok(response)
    }

    /// Query nearest records using caller-supplied embeddings and preserve Chroma order.
    pub async fn query(
        &self,
        request: ChromaQueryRequest,
    ) -> Result<ChromaQueryResponse, ChromaError> {
        let Some(first_embedding) = request.query_embeddings.first() else {
            return Err(ChromaError::InvalidRequest(
                "query embeddings must be non-empty finite vectors",
            ));
        };
        let embedding_dimension = first_embedding.len();
        if embedding_dimension == 0
            || request.query_embeddings.iter().any(|row| {
                row.len() != embedding_dimension || row.iter().any(|value| !value.is_finite())
            })
        {
            return Err(ChromaError::InvalidRequest(
                "query embeddings must be non-empty finite vectors of equal dimension",
            ));
        }
        if request.n_results == 0 {
            return Err(ChromaError::InvalidRequest(
                "query result count must be greater than zero",
            ));
        }
        let query_count = request.query_embeddings.len();
        let url = self.client.endpoint(&[
            "tenants",
            &self.client.config.tenant,
            "databases",
            &self.client.config.database,
            "collections",
            &self.info.id,
            "query",
        ])?;
        let body = QueryBody {
            query_embeddings: request.query_embeddings,
            n_results: request.n_results,
            where_filter: request.where_filter,
            where_document: request.where_document,
            include: request.include,
        };
        let response: ChromaQueryResponse = self
            .client
            .send_json(
                self.client
                    .http
                    .post(url)
                    .timeout(self.client.config.request_timeout),
                &body,
            )
            .await?;
        response.validate_alignment(query_count)?;
        Ok(response)
    }
    /// Upsert records using caller-generated embeddings.
    pub async fn upsert(&self, request: ChromaUpsertRequest) -> Result<(), ChromaError> {
        request.validate()?;
        let url = self.client.endpoint(&[
            "tenants",
            &self.client.config.tenant,
            "databases",
            &self.client.config.database,
            "collections",
            &self.info.id,
            "upsert",
        ])?;
        let body = UpsertBody {
            ids: request.ids,
            embeddings: Some(request.embeddings),
            metadatas: request.metadatas,
            documents: request.documents,
            uris: None,
        };
        self.client
            .send_unit_json(
                self.client
                    .http
                    .post(url)
                    .timeout(self.client.config.request_timeout),
                &body,
            )
            .await
    }

    /// Delete records by their Chroma IDs.
    pub async fn delete(&self, request: ChromaDeleteRequest) -> Result<(), ChromaError> {
        if request.ids.is_empty() || request.ids.iter().any(|id| id.is_empty()) {
            return Err(ChromaError::InvalidRequest(
                "delete requires at least one non-empty ID",
            ));
        }
        let url = self.client.endpoint(&[
            "tenants",
            &self.client.config.tenant,
            "databases",
            &self.client.config.database,
            "collections",
            &self.info.id,
            "delete",
        ])?;
        let body = DeleteBody {
            ids: request.ids,
            where_filter: None,
            where_document: None,
        };
        self.client
            .send_unit_json(
                self.client
                    .http
                    .post(url)
                    .timeout(self.client.config.request_timeout),
                &body,
            )
            .await
    }

    /// Enumerate all IDs using bounded Chroma `get` requests.
    ///
    /// Chroma 0.5.23 applies each page's offset/limit independently and provides
    /// no cross-request snapshot cursor; concurrent writes can shift later pages.
    /// `page_size` is capped at 1,000. The full result still occupies O(collection
    /// size) memory because drift analysis compares the complete ID set. Python
    /// currently fetches every ID in one unbounded `get` request.
    pub async fn list_all_ids(&self, page_size: NonZeroUsize) -> Result<Vec<String>, ChromaError> {
        if page_size.get() > MAX_GET_PAGE_SIZE {
            return Err(ChromaError::InvalidRequest(
                "ID page size exceeds the per-request cap",
            ));
        }

        let mut ids = Vec::new();
        let mut offset = 0usize;
        loop {
            let page = self
                .get(ChromaGetRequest {
                    limit: Some(page_size.get()),
                    offset: Some(offset),
                    ..ChromaGetRequest::default()
                })
                .await?;
            let page_len = page.ids.len();
            if page_len > page_size.get() {
                return Err(ChromaError::InvalidResponse {
                    message: "Chroma returned more IDs than the requested page size".into(),
                    body: String::new(),
                });
            }
            ids.extend(page.ids);
            if page_len == 0 || page_len < page_size.get() {
                break;
            }
            offset = offset
                .checked_add(page_len)
                .ok_or(ChromaError::InvalidRequest(
                    "ID pagination offset overflowed",
                ))?;
        }
        Ok(ids)
    }
}

/// Fields to include in a Chroma `get` or `query` response.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ChromaInclude {
    Documents,
    Embeddings,
    Metadatas,
    Distances,
}

/// Optional filters and projection for one Chroma `get` operation.
#[derive(Clone, Debug, Default)]
pub struct ChromaGetRequest {
    pub ids: Option<Vec<String>>,
    pub where_filter: Option<Value>,
    pub where_document: Option<Value>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
    pub include: Vec<ChromaInclude>,
}

/// Query vectors, result bound, filters, and projection for Chroma nearest-neighbor search.
#[derive(Clone, Debug)]
pub struct ChromaQueryRequest {
    pub query_embeddings: Vec<Vec<f64>>,
    pub n_results: usize,
    pub where_filter: Option<Value>,
    pub where_document: Option<Value>,
    pub include: Vec<ChromaInclude>,
}
/// Batch records for Chroma's `/upsert` operation.
#[derive(Clone, Debug)]
pub struct ChromaUpsertRequest {
    pub ids: Vec<String>,
    pub embeddings: Vec<Vec<f64>>,
    pub metadatas: Option<Vec<Option<Map<String, Value>>>>,
    pub documents: Option<Vec<Option<String>>>,
}

impl ChromaUpsertRequest {
    fn validate(&self) -> Result<(), ChromaError> {
        let count = self.ids.len();
        let dimension = self.embeddings.first().map(Vec::len).unwrap_or(0);
        if count == 0
            || self.ids.iter().any(String::is_empty)
            || self.embeddings.len() != count
            || dimension == 0
            || self
                .embeddings
                .iter()
                .any(|row| row.len() != dimension || row.iter().any(|value| !value.is_finite()))
            || self
                .metadatas
                .as_ref()
                .is_some_and(|rows| rows.len() != count)
            || self
                .documents
                .as_ref()
                .is_some_and(|rows| rows.len() != count)
        {
            return Err(ChromaError::InvalidRequest(
                "upsert IDs, embeddings, metadata, and documents must be non-empty and aligned",
            ));
        }
        Ok(())
    }
}

/// IDs to remove from the configured Chroma collection.
#[derive(Clone, Debug)]
pub struct ChromaDeleteRequest {
    pub ids: Vec<String>,
}

/// Collection metadata returned by Chroma.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct ChromaCollectionInfo {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub metadata: Option<Map<String, Value>>,
    #[serde(default)]
    pub tenant: Option<String>,
    #[serde(default)]
    pub database: Option<String>,
    #[serde(default)]
    pub dimension: Option<usize>,
}

/// Column-oriented Chroma `get` response.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct ChromaGetResponse {
    pub ids: Vec<String>,
    #[serde(default)]
    pub embeddings: Option<Vec<Vec<f64>>>,
    #[serde(default)]
    pub metadatas: Option<Vec<Option<Map<String, Value>>>>,
    #[serde(default)]
    pub documents: Option<Vec<Option<String>>>,
}

impl ChromaGetResponse {
    fn validate_alignment(&self) -> Result<(), ChromaError> {
        let ids_len = self.ids.len();
        if self
            .embeddings
            .as_ref()
            .is_some_and(|rows| rows.len() != ids_len)
            || self
                .metadatas
                .as_ref()
                .is_some_and(|rows| rows.len() != ids_len)
            || self
                .documents
                .as_ref()
                .is_some_and(|rows| rows.len() != ids_len)
        {
            return Err(ChromaError::InvalidResponse {
                message: "Chroma get columns are not aligned with IDs".into(),
                body: String::new(),
            });
        }
        Ok(())
    }
}

/// Nested, query-major Chroma nearest-neighbor response.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct ChromaQueryResponse {
    pub ids: Vec<Vec<String>>,
    #[serde(default)]
    pub distances: Option<Vec<Vec<f64>>>,
    #[serde(default)]
    pub embeddings: Option<Vec<Vec<Vec<f64>>>>,
    #[serde(default)]
    pub metadatas: Option<QueryMetadatas>,
    #[serde(default)]
    pub documents: Option<Vec<Vec<Option<String>>>>,
}

/// Per-query metadata rows; Chroma returns `null` for rows without metadata.
pub type QueryMetadatas = Vec<Vec<Option<Map<String, Value>>>>;

impl ChromaQueryResponse {
    fn validate_alignment(&self, expected_query_count: usize) -> Result<(), ChromaError> {
        let query_count = self.ids.len();
        if query_count != expected_query_count {
            return Err(ChromaError::InvalidResponse {
                message: "Chroma query rows do not match submitted embeddings".into(),
                body: String::new(),
            });
        }
        if self
            .distances
            .as_ref()
            .is_some_and(|rows| rows.len() != query_count)
            || self
                .embeddings
                .as_ref()
                .is_some_and(|rows| rows.len() != query_count)
            || self
                .metadatas
                .as_ref()
                .is_some_and(|rows| rows.len() != query_count)
            || self
                .documents
                .as_ref()
                .is_some_and(|rows| rows.len() != query_count)
        {
            return Err(ChromaError::InvalidResponse {
                message: "Chroma query columns do not match query count".into(),
                body: String::new(),
            });
        }
        for query_index in 0..query_count {
            let result_count = self.ids[query_index].len();
            if self
                .distances
                .as_ref()
                .is_some_and(|rows| rows[query_index].len() != result_count)
                || self
                    .embeddings
                    .as_ref()
                    .is_some_and(|rows| rows[query_index].len() != result_count)
                || self
                    .metadatas
                    .as_ref()
                    .is_some_and(|rows| rows[query_index].len() != result_count)
                || self
                    .documents
                    .as_ref()
                    .is_some_and(|rows| rows[query_index].len() != result_count)
            {
                return Err(ChromaError::InvalidResponse {
                    message: "Chroma query columns are not aligned with IDs".into(),
                    body: String::new(),
                });
            }
        }
        Ok(())
    }
}

#[derive(Serialize)]
struct CreateCollectionBody<'a> {
    name: &'a str,
    metadata: Option<Map<String, Value>>,
    configuration: Option<Value>,
    get_or_create: bool,
}

#[derive(Serialize)]
struct GetBody {
    ids: Option<Vec<String>>,
    #[serde(rename = "where")]
    where_filter: Option<Value>,
    sort: Option<String>,
    limit: Option<usize>,
    offset: Option<usize>,
    where_document: Option<Value>,
    include: Vec<ChromaInclude>,
}

#[derive(Serialize)]
struct QueryBody {
    query_embeddings: Vec<Vec<f64>>,
    n_results: usize,
    #[serde(rename = "where")]
    where_filter: Option<Value>,
    where_document: Option<Value>,
    include: Vec<ChromaInclude>,
}
#[derive(Serialize)]
struct UpsertBody {
    ids: Vec<String>,
    embeddings: Option<Vec<Vec<f64>>>,
    metadatas: Option<Vec<Option<Map<String, Value>>>>,
    documents: Option<Vec<Option<String>>>,
    uris: Option<Vec<Option<String>>>,
}

#[derive(Serialize)]
struct DeleteBody {
    ids: Vec<String>,
    #[serde(rename = "where")]
    where_filter: Option<Value>,
    where_document: Option<Value>,
}

#[derive(Deserialize)]
struct HeartbeatResponse {
    #[serde(rename = "nanosecond heartbeat")]
    nanosecond_heartbeat: u64,
}

/// Errors returned by the Chroma adapter, including bounded server error bodies.
pub enum ChromaError {
    InvalidConfig(&'static str),
    InvalidRequest(&'static str),
    Http(reqwest::Error),
    HttpStatus { status: StatusCode, body: String },
    BodyTooLarge { status: StatusCode, limit: usize },
    InvalidResponse { message: String, body: String },
}

impl fmt::Debug for ChromaError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidConfig(message) => formatter
                .debug_tuple("InvalidConfig")
                .field(message)
                .finish(),
            Self::InvalidRequest(message) => formatter
                .debug_tuple("InvalidRequest")
                .field(message)
                .finish(),
            Self::Http(error) => formatter.debug_tuple("Http").field(error).finish(),
            Self::HttpStatus { status, body } => formatter
                .debug_struct("HttpStatus")
                .field("status", status)
                .field("body_bytes", &body.len())
                .finish(),
            Self::BodyTooLarge { status, limit } => formatter
                .debug_struct("BodyTooLarge")
                .field("status", status)
                .field("limit", limit)
                .finish(),
            Self::InvalidResponse { message, body } => formatter
                .debug_struct("InvalidResponse")
                .field("message", message)
                .field("body_bytes", &body.len())
                .finish(),
        }
    }
}

impl ChromaError {
    /// Whether the underlying HTTP request exceeded its configured deadline.
    pub fn is_timeout(&self) -> bool {
        matches!(self, Self::Http(error) if error.is_timeout())
    }
}

impl fmt::Display for ChromaError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidConfig(message) => write!(formatter, "invalid Chroma config: {message}"),
            Self::InvalidRequest(message) => write!(formatter, "invalid Chroma request: {message}"),
            Self::Http(error) => write!(formatter, "Chroma HTTP request failed: {error}"),
            Self::HttpStatus { status, .. } => write!(formatter, "Chroma returned HTTP {status}"),
            Self::BodyTooLarge { status, limit } => write!(
                formatter,
                "Chroma HTTP {status} response exceeded the {limit}-byte limit"
            ),
            Self::InvalidResponse { message, .. } => {
                write!(formatter, "invalid Chroma response: {message}")
            }
        }
    }
}

impl std::error::Error for ChromaError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Http(error) => Some(error),
            _ => None,
        }
    }
}

async fn read_json_response<T: DeserializeOwned>(
    mut response: reqwest::Response,
    max_response_bytes: usize,
) -> Result<T, ChromaError> {
    let status = response.status();
    let body = read_bounded_body(&mut response, max_response_bytes, status).await?;
    if !status.is_success() {
        return Err(ChromaError::HttpStatus {
            status,
            body: String::from_utf8_lossy(&body).into_owned(),
        });
    }
    serde_json::from_slice(&body).map_err(|error| ChromaError::InvalidResponse {
        message: error.to_string(),
        body: String::from_utf8_lossy(&body).into_owned(),
    })
}

async fn read_bounded_body(
    response: &mut reqwest::Response,
    limit: usize,
    status: StatusCode,
) -> Result<Vec<u8>, ChromaError> {
    if response
        .content_length()
        .is_some_and(|content_length| content_length > limit as u64)
    {
        return Err(ChromaError::BodyTooLarge { status, limit });
    }

    let mut body = Vec::new();
    if let Some(content_length) = response.content_length() {
        body.reserve(content_length as usize);
    }
    while let Some(chunk) = response.chunk().await.map_err(ChromaError::Http)? {
        if body.len().saturating_add(chunk.len()) > limit {
            return Err(ChromaError::BodyTooLarge { status, limit });
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn validated_base_url(raw: &str) -> Result<Url, ChromaError> {
    let mut url = Url::parse(raw).map_err(|_| ChromaError::InvalidConfig("base URL is invalid"))?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !matches!(url.path(), "" | "/")
    {
        return Err(ChromaError::InvalidConfig(
            "base URL must be an HTTP(S) origin without credentials, path, query, or fragment",
        ));
    }
    url.set_path("");
    Ok(url)
}

fn validate_timeout(timeout: Duration) -> Result<(), ChromaError> {
    if timeout.is_zero() {
        return Err(ChromaError::InvalidConfig(
            "request timeout must be greater than zero",
        ));
    }
    Ok(())
}

fn validate_path_name(value: &str, field: &'static str) -> Result<(), ChromaError> {
    if value.len() < 3
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.'))
        || value == "."
        || value == ".."
    {
        return Err(ChromaError::InvalidConfig(match field {
            "tenant" => "tenant must be a safe 3-128 character path name",
            _ => "database must be a safe 3-128 character path name",
        }));
    }
    Ok(())
}

fn validate_collection_name(value: &str) -> Result<(), ChromaError> {
    let bytes = value.as_bytes();
    let valid = (3..=63).contains(&bytes.len())
        && bytes.first().is_some_and(u8::is_ascii_alphanumeric)
        && bytes.last().is_some_and(u8::is_ascii_alphanumeric)
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.'))
        && !value.contains("..")
        && value.parse::<std::net::Ipv4Addr>().is_err();
    if !valid {
        return Err(ChromaError::InvalidConfig(
            "collection name does not satisfy Chroma's 0.5.23 naming rules",
        ));
    }
    Ok(())
}

fn is_collection_id(value: &str) -> bool {
    if value.len() != COLLECTION_ID_LENGTH {
        return false;
    }
    value.bytes().enumerate().all(|(index, byte)| {
        if matches!(index, 8 | 13 | 18 | 23) {
            byte == b'-'
        } else {
            byte.is_ascii_hexdigit()
        }
    })
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::num::NonZeroUsize;
    use std::thread;
    use std::time::Duration;

    use serde_json::{json, Map, Value};

    use super::{
        ChromaClient, ChromaConfig, ChromaError, ChromaGetRequest, ChromaInclude,
        ChromaQueryRequest,
    };

    const COLLECTION_ID: &str = "00000000-0000-0000-0000-000000000001";

    struct FixtureResponse {
        status: u16,
        reason: &'static str,
        body: Vec<u8>,
        delay: Duration,
    }

    impl FixtureResponse {
        fn json(status: u16, reason: &'static str, body: &str) -> Self {
            Self {
                status,
                reason,
                body: body.as_bytes().to_vec(),
                delay: Duration::ZERO,
            }
        }
    }

    #[derive(Debug)]
    struct CapturedRequest {
        method: String,
        path: String,
        headers: std::collections::HashMap<String, String>,
        body: Vec<u8>,
    }

    fn fixture(
        responses: Vec<FixtureResponse>,
    ) -> (String, thread::JoinHandle<Vec<CapturedRequest>>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("fixture listener binds");
        let address = listener.local_addr().expect("fixture address is available");
        let handle = thread::spawn(move || {
            let mut captured = Vec::with_capacity(responses.len());
            for response in responses {
                let (mut stream, _) = listener.accept().expect("fixture accepts request");
                stream
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .expect("fixture read timeout sets");
                let request = read_request(&mut stream);
                thread::sleep(response.delay);
                let head = format!(
                    "HTTP/1.1 {} {}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
                    response.status,
                    response.reason,
                    response.body.len(),
                );
                let _ = stream.write_all(head.as_bytes());
                let _ = stream.write_all(&response.body);
                captured.push(request);
            }
            captured
        });
        (format!("http://{address}"), handle)
    }

    fn read_request(stream: &mut TcpStream) -> CapturedRequest {
        let mut bytes = Vec::new();
        let mut chunk = [0u8; 4096];
        let header_end = loop {
            let count = stream.read(&mut chunk).expect("fixture reads request");
            assert_ne!(count, 0, "request closes before headers finish");
            bytes.extend_from_slice(&chunk[..count]);
            if let Some(position) = bytes.windows(4).position(|window| window == b"\r\n\r\n") {
                break position + 4;
            }
        };
        let header_text = String::from_utf8_lossy(&bytes[..header_end]);
        let mut lines = header_text.split("\r\n");
        let mut request_line = lines
            .next()
            .expect("request line exists")
            .split_whitespace();
        let method = request_line.next().expect("method exists").to_owned();
        let path = request_line.next().expect("path exists").to_owned();
        let headers = lines
            .filter_map(|line| line.split_once(':'))
            .map(|(name, value)| (name.to_ascii_lowercase(), value.trim().to_owned()))
            .collect::<std::collections::HashMap<_, _>>();
        let content_length = headers
            .get("content-length")
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(0);
        while bytes.len() < header_end + content_length {
            let count = stream.read(&mut chunk).expect("fixture reads request body");
            assert_ne!(count, 0, "request closes before body finishes");
            bytes.extend_from_slice(&chunk[..count]);
        }
        CapturedRequest {
            method,
            path,
            headers,
            body: bytes[header_end..header_end + content_length].to_vec(),
        }
    }

    fn config(base_url: &str) -> ChromaConfig {
        ChromaConfig::new(
            base_url,
            "default_tenant",
            "default_database",
            "news_articles",
            Duration::from_secs(2),
        )
        .expect("fixture Chroma config validates")
    }

    fn collection_response() -> String {
        format!(
            "{{\"id\":\"{COLLECTION_ID}\",\"name\":\"news_articles\",\"metadata\":{{\"hnsw:space\":\"cosine\"}},\"tenant\":\"default_tenant\",\"database\":\"default_database\",\"dimension\":384}}"
        )
    }

    #[tokio::test]
    async fn create_collection_sends_explicit_non_idempotent_create_flag() {
        let (base_url, server) = fixture(vec![FixtureResponse::json(
            200,
            "OK",
            &collection_response(),
        )]);
        let client = ChromaClient::new(reqwest::Client::new(), config(&base_url));
        client
            .create_collection(None)
            .await
            .expect("collection creation succeeds");
        let requests = server.join().expect("fixture completes");
        assert_eq!(requests[0].method, "POST");
        assert_eq!(
            requests[0].path,
            "/api/v2/tenants/default_tenant/databases/default_database/collections"
        );
        assert_eq!(
            serde_json::from_slice::<Value>(&requests[0].body).expect("create body is JSON"),
            json!({
                "name":"news_articles",
                "metadata":null,
                "configuration":null,
                "get_or_create":false
            })
        );
    }

    #[tokio::test]
    async fn upsert_and_delete_send_versioned_payloads() {
        let (base_url, server) = fixture(vec![
            FixtureResponse::json(200, "OK", &collection_response()),
            FixtureResponse::json(200, "OK", "null"),
            FixtureResponse::json(200, "OK", "null"),
        ]);
        let client = ChromaClient::new(reqwest::Client::new(), config(&base_url));
        let collection = client
            .get_collection()
            .await
            .expect("collection lookup succeeds");
        let mut metadata = Map::new();
        metadata.insert("source_id".into(), Value::String("wire".into()));
        collection
            .upsert(super::ChromaUpsertRequest {
                ids: vec!["article_7".into()],
                embeddings: vec![vec![0.25, 0.75]],
                metadatas: Some(vec![Some(metadata)]),
                documents: Some(vec![Some("article text".into())]),
            })
            .await
            .expect("upsert response is accepted");
        collection
            .delete(super::ChromaDeleteRequest {
                ids: vec!["article_7".into()],
            })
            .await
            .expect("delete response is accepted");

        let requests = server.join().expect("fixture completes");
        assert_eq!(requests[1].method, "POST");
        assert_eq!(
            requests[1].path,
            format!(
                "/api/v2/tenants/default_tenant/databases/default_database/collections/{COLLECTION_ID}/upsert"
            )
        );
        assert_eq!(
            requests[1].headers.get("content-type").map(String::as_str),
            Some("application/json")
        );
        assert_eq!(
            serde_json::from_slice::<Value>(&requests[1].body).expect("upsert body is JSON"),
            json!({
                "ids":["article_7"],
                "embeddings":[[0.25,0.75]],
                "metadatas":[{"source_id":"wire"}],
                "documents":["article text"],
                "uris":null
            })
        );
        assert_eq!(requests[2].method, "POST");
        assert_eq!(
            requests[2].path,
            format!(
                "/api/v2/tenants/default_tenant/databases/default_database/collections/{COLLECTION_ID}/delete"
            )
        );
        assert_eq!(
            serde_json::from_slice::<Value>(&requests[2].body).expect("delete body is JSON"),
            json!({"ids":["article_7"],"where":null,"where_document":null})
        );
    }

    #[test]
    fn upsert_request_rejects_misaligned_rows() {
        let request = super::ChromaUpsertRequest {
            ids: vec!["article_1".into()],
            embeddings: Vec::new(),
            metadatas: None,
            documents: None,
        };
        assert!(request.validate().is_err());
    }

    #[tokio::test]
    async fn create_and_query_use_v2_paths_json_headers_and_typed_results() {
        let (base_url, server) = fixture(vec![
            FixtureResponse::json(200, "OK", &collection_response()),
            FixtureResponse::json(
                200,
                "OK",
                r#"{"ids":[["article_17","article_8"]],"distances":[[0.1,0.3]],"metadatas":[[{"category":"science"},{"category":"science"}]],"documents":[["first document","second document"]],"embeddings":null}"#,
            ),
        ]);
        let mut metadata = Map::new();
        metadata.insert("hnsw:space".into(), Value::String("cosine".into()));
        let client = ChromaClient::new(reqwest::Client::new(), config(&base_url));
        let collection = client
            .get_or_create_collection(Some(metadata))
            .await
            .expect("configured collection is returned");
        assert_eq!(collection.info.dimension, Some(384));
        let response = collection
            .query(ChromaQueryRequest {
                query_embeddings: vec![vec![0.1, 0.2]],
                n_results: 2,
                where_filter: Some(json!({"category":"science"})),
                where_document: None,
                include: vec![
                    ChromaInclude::Metadatas,
                    ChromaInclude::Documents,
                    ChromaInclude::Distances,
                ],
            })
            .await
            .expect("query response is typed and aligned");
        assert_eq!(response.ids[0], ["article_17", "article_8"]);
        assert_eq!(
            response.distances.as_ref().expect("distances returned")[0],
            [0.1, 0.3]
        );
        assert_eq!(
            response.documents.as_ref().expect("documents returned")[0][0].as_deref(),
            Some("first document")
        );

        let requests = server.join().expect("fixture completes");
        assert_eq!(requests.len(), 2);
        assert_eq!(requests[0].method, "POST");
        assert_eq!(
            requests[0].path,
            "/api/v2/tenants/default_tenant/databases/default_database/collections"
        );
        assert_eq!(
            requests[0].headers.get("content-type").map(String::as_str),
            Some("application/json")
        );
        assert_eq!(
            serde_json::from_slice::<Value>(&requests[0].body).expect("create body is JSON"),
            json!({"name":"news_articles","metadata":{"hnsw:space":"cosine"},"configuration":null,"get_or_create":true})
        );
        assert_eq!(requests[1].method, "POST");
        assert_eq!(requests[1].path, format!("/api/v2/tenants/default_tenant/databases/default_database/collections/{COLLECTION_ID}/query"));
        assert_eq!(
            requests[1].headers.get("content-type").map(String::as_str),
            Some("application/json")
        );
        assert_eq!(
            serde_json::from_slice::<Value>(&requests[1].body).expect("query body is JSON"),
            json!({"query_embeddings":[[0.1,0.2]],"n_results":2,"where":{"category":"science"},"where_document":null,"include":["metadatas","documents","distances"]})
        );
    }

    #[tokio::test]
    async fn get_and_count_use_pinned_contract_and_preserve_optional_fields() {
        let (base_url, server) = fixture(vec![
            FixtureResponse::json(200, "OK", &collection_response()),
            FixtureResponse::json(200, "OK", "2"),
            FixtureResponse::json(
                200,
                "OK",
                r#"{"ids":["article_3"],"embeddings":[[0.25,0.75]],"metadatas":[{"source_id":"wire"}],"documents":null}"#,
            ),
        ]);
        let client = ChromaClient::new(reqwest::Client::new(), config(&base_url));
        let collection = client
            .get_collection()
            .await
            .expect("collection lookup succeeds");
        assert_eq!(collection.count().await.expect("count succeeds"), 2);
        let result = collection
            .get(ChromaGetRequest {
                ids: Some(vec!["article_3".into()]),
                include: vec![ChromaInclude::Embeddings, ChromaInclude::Metadatas],
                ..ChromaGetRequest::default()
            })
            .await
            .expect("get response parses");
        assert_eq!(result.ids, ["article_3"]);
        assert_eq!(
            result.embeddings.as_ref().expect("embeddings returned")[0],
            [0.25, 0.75]
        );
        assert_eq!(result.documents, None);

        let requests = server.join().expect("fixture completes");
        assert_eq!(requests[0].method, "GET");
        assert_eq!(
            requests[0].path,
            "/api/v2/tenants/default_tenant/databases/default_database/collections/news_articles"
        );
        assert_eq!(requests[1].method, "GET");
        assert_eq!(requests[1].path, format!("/api/v2/tenants/default_tenant/databases/default_database/collections/{COLLECTION_ID}/count"));
        assert_eq!(requests[2].method, "POST");
        assert_eq!(requests[2].path, format!("/api/v2/tenants/default_tenant/databases/default_database/collections/{COLLECTION_ID}/get"));
        assert_eq!(
            serde_json::from_slice::<Value>(&requests[2].body).expect("get body is JSON"),
            json!({"ids":["article_3"],"where":null,"sort":null,"limit":null,"offset":null,"where_document":null,"include":["embeddings","metadatas"]})
        );
    }

    #[tokio::test]
    async fn list_all_ids_pages_with_offsets_and_stops_on_a_short_page() {
        let (base_url, server) = fixture(vec![
            FixtureResponse::json(200, "OK", &collection_response()),
            FixtureResponse::json(200, "OK", r#"{"ids":["article_1","article_2"]}"#),
            FixtureResponse::json(200, "OK", r#"{"ids":["article_3"]}"#),
        ]);
        let client = ChromaClient::new(reqwest::Client::new(), config(&base_url));
        let collection = client
            .get_collection()
            .await
            .expect("collection lookup succeeds");
        assert!(matches!(
            collection
                .list_all_ids(NonZeroUsize::new(1_001).expect("nonzero oversized page"))
                .await,
            Err(ChromaError::InvalidRequest(_))
        ));
        assert!(matches!(
            collection
                .get(ChromaGetRequest {
                    limit: Some(1_001),
                    ..ChromaGetRequest::default()
                })
                .await,
            Err(ChromaError::InvalidRequest(_))
        ));
        assert!(matches!(
            collection
                .get(ChromaGetRequest {
                    include: vec![ChromaInclude::Distances],
                    ..ChromaGetRequest::default()
                })
                .await,
            Err(ChromaError::InvalidRequest(_))
        ));
        let ids = collection
            .list_all_ids(NonZeroUsize::new(2).expect("nonzero page size"))
            .await
            .expect("paged ID scan succeeds");
        assert_eq!(ids, ["article_1", "article_2", "article_3"]);

        let requests = server.join().expect("fixture completes");
        assert_eq!(requests.len(), 3);
        let first = serde_json::from_slice::<Value>(&requests[1].body).expect("first page is JSON");
        let second =
            serde_json::from_slice::<Value>(&requests[2].body).expect("second page is JSON");
        assert_eq!(first["offset"], 0);
        assert_eq!(first["limit"], 2);
        assert_eq!(first["include"], json!([]));
        assert_eq!(second["offset"], 2);
        assert_eq!(second["limit"], 2);
    }

    #[tokio::test]
    async fn list_all_ids_stops_when_an_exact_multiple_reaches_empty_page() {
        let (base_url, server) = fixture(vec![
            FixtureResponse::json(200, "OK", &collection_response()),
            FixtureResponse::json(200, "OK", r#"{"ids":["article_1","article_2"]}"#),
            FixtureResponse::json(200, "OK", r#"{"ids":["article_3","article_4"]}"#),
            FixtureResponse::json(200, "OK", r#"{"ids":[]}"#),
        ]);
        let client = ChromaClient::new(reqwest::Client::new(), config(&base_url));
        let collection = client
            .get_collection()
            .await
            .expect("collection lookup succeeds");
        let ids = collection
            .list_all_ids(NonZeroUsize::new(2).expect("nonzero page size"))
            .await
            .expect("paged ID scan succeeds");
        assert_eq!(ids.len(), 4);
        let requests = server.join().expect("fixture completes");
        assert_eq!(requests.len(), 4);
        assert_eq!(
            serde_json::from_slice::<Value>(&requests[3].body).expect("empty page is JSON")
                ["offset"],
            4
        );
    }

    #[tokio::test]
    async fn errors_preserve_status_and_bounded_server_body() {
        let (base_url, server) = fixture(vec![
            FixtureResponse::json(200, "OK", r#"{"nanosecond heartbeat":123}"#),
            FixtureResponse::json(
                503,
                "Service Unavailable",
                r#"{"error":"ServiceUnavailableError","message":"index unavailable"}"#,
            ),
        ]);
        let client = ChromaClient::new(reqwest::Client::new(), config(&base_url));
        assert_eq!(client.heartbeat().await.expect("heartbeat succeeds"), 123);
        let error = client.heartbeat().await.expect_err("503 is not successful");
        assert!(!error.to_string().contains("index unavailable"));
        assert!(!format!("{error:?}").contains("index unavailable"));
        match error {
            ChromaError::HttpStatus { status, body } => {
                assert_eq!(status.as_u16(), 503);
                assert!(body.contains("index unavailable"));
            }
            other => panic!("unexpected error: {other}"),
        }
        let requests = server.join().expect("fixture completes");
        assert_eq!(requests.len(), 2);
        assert_eq!(requests[0].method, "GET");
        assert_eq!(requests[0].path, "/api/v2/heartbeat");
        assert_eq!(requests[1].path, "/api/v2/heartbeat");
    }
    #[tokio::test]
    async fn upsert_status_error_keeps_bounded_server_body() {
        let (base_url, server) = fixture(vec![
            FixtureResponse::json(200, "OK", &collection_response()),
            FixtureResponse::json(
                503,
                "Service Unavailable",
                r#"{"error":"InvalidDimensionException","message":"wrong vector dimension"}"#,
            ),
        ]);
        let client = ChromaClient::new(reqwest::Client::new(), config(&base_url));
        let collection = client
            .get_collection()
            .await
            .expect("collection lookup succeeds");
        let error = collection
            .upsert(super::ChromaUpsertRequest {
                ids: vec!["article_1".into()],
                embeddings: vec![vec![0.1]],
                metadatas: None,
                documents: None,
            })
            .await
            .expect_err("failed write must not be reported as success");
        assert!(!format!("{error:?}").contains("wrong vector dimension"));
        match error {
            ChromaError::HttpStatus { status, body } => {
                assert_eq!(status.as_u16(), 503);
                assert!(body.contains("wrong vector dimension"));
            }
            other => panic!("unexpected error: {other}"),
        }
        let requests = server.join().expect("fixture completes");
        assert_eq!(requests[1].method, "POST");
        assert_eq!(
            requests[1].path,
            format!(
                "/api/v2/tenants/default_tenant/databases/default_database/collections/{COLLECTION_ID}/upsert"
            )
        );
    }

    #[tokio::test]
    async fn oversized_response_and_query_alignment_mismatches_are_rejected() {
        let (base_url, server) = fixture(vec![FixtureResponse::json(
            200,
            "OK",
            &collection_response(),
        )]);
        let bounded_config = config(&base_url)
            .with_max_response_bytes(8)
            .expect("positive response bound");
        let client = ChromaClient::new(reqwest::Client::new(), bounded_config);
        assert!(matches!(
            client.get_collection().await,
            Err(ChromaError::BodyTooLarge { limit: 8, .. })
        ));
        let _ = server.join().expect("fixture completes");

        let (base_url, server) = fixture(vec![
            FixtureResponse::json(200, "OK", &collection_response()),
            FixtureResponse::json(200, "OK", r#"{"ids":[["article_1"]],"distances":[[]]}"#),
            FixtureResponse::json(200, "OK", r#"{"ids":[[]],"distances":[[]]}"#),
        ]);
        let client = ChromaClient::new(reqwest::Client::new(), config(&base_url));
        let collection = client
            .get_collection()
            .await
            .expect("collection lookup succeeds");
        let error = collection
            .query(ChromaQueryRequest {
                query_embeddings: vec![vec![0.1]],
                n_results: 1,
                where_filter: None,
                where_document: None,
                include: vec![ChromaInclude::Distances],
            })
            .await
            .expect_err("misaligned response columns are rejected");
        assert!(matches!(error, ChromaError::InvalidResponse { .. }));
        let row_count_error = collection
            .query(ChromaQueryRequest {
                query_embeddings: vec![vec![0.1], vec![0.2]],
                n_results: 1,
                where_filter: None,
                where_document: None,
                include: vec![ChromaInclude::Distances],
            })
            .await
            .expect_err("response query rows must match submitted query count");
        assert!(matches!(
            row_count_error,
            ChromaError::InvalidResponse { .. }
        ));
        assert_eq!(server.join().expect("fixture completes").len(), 3);
    }

    #[tokio::test]
    async fn configured_deadline_is_enforced() {
        let mut delayed = FixtureResponse::json(200, "OK", r#"{"nanosecond heartbeat":123}"#);
        delayed.delay = Duration::from_millis(400);
        let (base_url, server) = fixture(vec![delayed]);
        let config = ChromaConfig::new(
            &base_url,
            "default_tenant",
            "default_database",
            "news_articles",
            Duration::from_millis(100),
        )
        .expect("short timeout config validates");
        let client = ChromaClient::new(reqwest::Client::new(), config);
        let error = client
            .heartbeat()
            .await
            .expect_err("slow endpoint times out");
        assert!(error.is_timeout(), "expected a timeout, got {error}");
        let _ = server.join().expect("fixture completes after delay");
    }

    #[tokio::test]
    async fn collection_lookup_rejects_mismatched_server_identity() {
        let response = json!({
            "id": COLLECTION_ID,
            "name": "other_collection",
            "tenant": "default_tenant",
            "database": "default_database",
        })
        .to_string();
        let (base_url, server) = fixture(vec![FixtureResponse::json(200, "OK", &response)]);
        let client = ChromaClient::new(reqwest::Client::new(), config(&base_url));
        let error = client
            .get_collection()
            .await
            .expect_err("server must return the configured collection");
        assert!(matches!(error, ChromaError::InvalidResponse { .. }));
        assert!(error.to_string().contains("name does not match"));
        let requests = server.join().expect("fixture completes");
        assert_eq!(
            requests[0].path,
            "/api/v2/tenants/default_tenant/databases/default_database/collections/news_articles"
        );
    }

    #[test]
    fn invalid_configuration_and_unbounded_page_sizes_are_rejected() {
        assert!(ChromaConfig::new(
            "http://localhost:8001/api/v2",
            "default_tenant",
            "default_database",
            "news_articles",
            Duration::from_secs(1),
        )
        .is_err());
        assert!(ChromaConfig::new(
            "http://u:p@localhost:8001",
            "default_tenant",
            "default_database",
            "news_articles",
            Duration::from_secs(1),
        )
        .is_err());
        assert!(ChromaConfig::new(
            "http://localhost:8001",
            "default_tenant/../../other",
            "default_database",
            "news_articles",
            Duration::from_secs(1),
        )
        .is_err());
        assert!(ChromaConfig::new(
            "http://localhost:8001",
            "default_tenant",
            "default_database",
            "../bad",
            Duration::from_secs(1),
        )
        .is_err());
    }
}
