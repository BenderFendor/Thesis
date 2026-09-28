use std::collections::BTreeMap;
use std::sync::LazyLock;

use axum::extract::{Path, Query, State};
use axum::http::{StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::Json;
use chrono::{DateTime, Duration, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use thesis_db::{
    CountryArticlePage, CountryArticleRecord, CountryCountSnapshot, CountryMatchKind,
    CountrySummary, CountryView,
};
use utoipa::openapi::schema::{
    AdditionalProperties, AnyOfBuilder, ArrayBuilder, ObjectBuilder, Type,
};
use utoipa::openapi::{RefOr, Schema};
use utoipa::{IntoParams, PartialSchema, ToSchema};

use crate::models::{HttpValidationError, ValidationError, ValidationLocation};
use crate::AppState;

const COUNTRY_GEO_JSON: &str = include_str!("../../../app/data/countries.json");

/// OpenAPI marker matching FastAPI's anonymous `dict[str, Any]` responses.
#[derive(Debug)]
pub(crate) struct FreeFormObjectSchema;

impl PartialSchema for FreeFormObjectSchema {
    fn schema() -> RefOr<Schema> {
        ObjectBuilder::new()
            .schema_type(Type::Object)
            .additional_properties(Some(AdditionalProperties::FreeForm(true)))
            .build()
            .into()
    }
}

impl ToSchema for FreeFormObjectSchema {}

fn country_geo_schema() -> RefOr<Schema> {
    ObjectBuilder::new()
        .schema_type(Type::Object)
        .additional_properties(Some(
            ObjectBuilder::new()
                .schema_type(Type::Object)
                .additional_properties(Some(AdditionalProperties::FreeForm(true))),
        ))
        .build()
        .into()
}

fn json_articles_schema() -> RefOr<Schema> {
    ArrayBuilder::new()
        .items(
            ObjectBuilder::new()
                .additional_properties(Some(AdditionalProperties::FreeForm(true)))
                .build(),
        )
        .build()
        .into()
}

fn country_geo_data() -> &'static BTreeMap<String, Value> {
    static DATA: LazyLock<BTreeMap<String, Value>> = LazyLock::new(|| {
        serde_json::from_str(COUNTRY_GEO_JSON)
            .expect("the checked-in country geo data must be valid JSON")
    });
    &DATA
}

#[derive(Clone, Debug, Serialize, ToSchema)]
pub(crate) struct CountryGeoData {
    #[schema(schema_with = country_geo_schema)]
    pub(crate) countries: BTreeMap<String, Value>,
    pub(crate) total: i64,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
struct GeoSignal {
    id: String,
    label: String,
    country_counts: BTreeMap<String, i64>,
    country_count: i64,
    article_count: i64,
    total_mentions: i64,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
struct CountryCountsResponse {
    counts: BTreeMap<String, i64>,
    source_counts: BTreeMap<String, i64>,
    #[schema(schema_with = json_geo_signals_schema)]
    geo_signals: Vec<GeoSignal>,
    total_articles: i64,
    articles_with_country: i64,
    articles_without_country: i64,
    country_count: i64,
    window_hours: i64,
}

fn json_geo_signals_schema() -> RefOr<Schema> {
    ArrayBuilder::new()
        .items(ObjectBuilder::new().build())
        .build()
        .into()
}

#[derive(Clone, Debug, Serialize, ToSchema)]
struct CountryLensSignal {
    id: String,
    label: String,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
struct CountryLensResponse {
    country_code: String,
    country_name: String,
    view: String,
    view_description: String,
    matching_strategy: String,
    total: i64,
    limit: i64,
    offset: i64,
    returned: i64,
    has_more: bool,
    source_count: i64,
    window_hours: Option<i64>,
    geo_signal: CountryLensSignal,
    #[schema(schema_with = json_articles_schema)]
    articles: Vec<Value>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
struct CountryListItem {
    code: String,
    article_count: i64,
    latest_article: Option<String>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
struct CountryListResponse {
    countries: Vec<CountryListItem>,
    total_countries: i64,
}

fn default_hours() -> i64 {
    24
}

fn default_view() -> String {
    "internal".to_owned()
}

fn default_limit() -> i64 {
    50
}

fn country_hours_schema() -> RefOr<Schema> {
    Schema::from(
        AnyOfBuilder::new()
            .item(
                ObjectBuilder::new()
                    .schema_type(Type::Integer)
                    .maximum(Some(720))
                    .minimum(Some(1))
                    .build(),
            )
            .item(ObjectBuilder::new().schema_type(Type::Null).build())
            .build(),
    )
    .into()
}

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
struct CountryCountsQuery {
    #[serde(default = "default_hours")]
    #[param(required = false, minimum = 1, maximum = 720, default = 24)]
    hours: i64,
}

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
struct CountryLensQuery {
    #[serde(default = "default_view")]
    #[param(
        required = false,
        pattern = "^(internal|external)$",
        default = "internal"
    )]
    view: String,
    #[serde(default = "default_limit")]
    #[param(required = false, minimum = 1, maximum = 200, default = 50)]
    limit: i64,
    #[serde(default)]
    #[param(required = false, minimum = 0, default = 0)]
    offset: i64,
    #[param(required = false, schema_with = country_hours_schema)]
    hours: Option<i64>,
}

fn validation_error(
    field: Option<&str>,
    input: Value,
    error_type: &str,
    message: &str,
) -> HttpValidationError {
    let mut location = vec![ValidationLocation::Text("query".to_owned())];
    if let Some(field) = field {
        location.push(ValidationLocation::Text(field.to_owned()));
    }
    HttpValidationError {
        detail: vec![ValidationError {
            loc: location,
            msg: message.to_owned(),
            error_type: error_type.to_owned(),
            input,
            ctx: None,
        }],
    }
}

fn query_parsing_error(uri: &Uri) -> HttpValidationError {
    validation_error(
        None,
        Value::String(uri.query().unwrap_or_default().to_owned()),
        "query_parsing",
        "Invalid query string",
    )
}

fn range_error(field: &str, value: i64, minimum: i64, maximum: Option<i64>) -> HttpValidationError {
    let (error_type, message) = if value < minimum {
        (
            "greater_than_equal",
            format!("Input should be greater than or equal to {minimum}"),
        )
    } else if let Some(maximum) = maximum.filter(|maximum| value > *maximum) {
        (
            "less_than_equal",
            format!("Input should be less than or equal to {maximum}"),
        )
    } else {
        (
            "value_error",
            "Input is outside the allowed range".to_owned(),
        )
    };
    validation_error(Some(field), Value::from(value), error_type, &message)
}

fn parse_counts_query(uri: &Uri) -> Result<i64, HttpValidationError> {
    let Query(values) =
        Query::<CountryCountsQuery>::try_from_uri(uri).map_err(|_| query_parsing_error(uri))?;
    let hours = values.hours;
    if !(1..=720).contains(&hours) {
        return Err(range_error("hours", hours, 1, Some(720)));
    }
    Ok(hours)
}

fn parse_lens_query(uri: &Uri) -> Result<(String, i64, i64, Option<i64>), HttpValidationError> {
    let Query(values) =
        Query::<CountryLensQuery>::try_from_uri(uri).map_err(|_| query_parsing_error(uri))?;
    let view = values.view;
    if view != "internal" && view != "external" {
        return Err(validation_error(
            Some("view"),
            Value::String(view),
            "string_pattern_mismatch",
            "String should match pattern '^(internal|external)$'",
        ));
    }

    let limit = values.limit;
    if !(1..=200).contains(&limit) {
        return Err(range_error("limit", limit, 1, Some(200)));
    }

    let offset = values.offset;
    if offset < 0 {
        return Err(range_error("offset", offset, 0, None));
    }

    if let Some(hours) = values.hours {
        if !(1..=720).contains(&hours) {
            return Err(range_error("hours", hours, 1, Some(720)));
        }
    }

    Ok((view, limit, offset, values.hours))
}

fn country_code_name(code: &str) -> String {
    country_geo_data()
        .get(code)
        .and_then(Value::as_object)
        .and_then(|country| country.get("name"))
        .and_then(Value::as_str)
        .filter(|name| !name.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| code.to_owned())
}

fn utc_isoformat(value: &DateTime<Utc>) -> String {
    // Canonical UTC RFC3339 avoids ambiguous database/session timezone output.
    value.to_rfc3339_opts(SecondsFormat::AutoSi, true)
}

fn optional_utc_isoformat(value: Option<&DateTime<Utc>>) -> Option<String> {
    value.map(utc_isoformat)
}

fn geo_signal(
    id: &str,
    label: &str,
    country_counts: &BTreeMap<String, i64>,
    article_count: i64,
) -> GeoSignal {
    GeoSignal {
        id: id.to_owned(),
        label: label.to_owned(),
        country_counts: country_counts.clone(),
        country_count: country_counts.len() as i64,
        article_count,
        total_mentions: country_counts.values().copied().sum(),
    }
}

fn serialize_article(article: CountryArticleRecord, signal_id: &str, signal_label: &str) -> Value {
    let title = article
        .title
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "Untitled article".to_owned());
    let source = article
        .source
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "Unknown".to_owned());
    let summary = article.summary.clone();
    let content = article.content.clone();
    let description = summary
        .clone()
        .filter(|value| !value.is_empty())
        .or_else(|| content.clone());
    let category = article
        .category
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "general".to_owned());
    let authors = article.authors.unwrap_or_default();
    let tags = article.tags.unwrap_or_default();
    let mentioned_countries = article.mentioned_countries.unwrap_or_default();
    let image_url = article.image_url.clone();

    let mut payload = Map::new();
    payload.insert("id".to_owned(), Value::from(article.id));
    payload.insert("title".to_owned(), Value::String(title));
    payload.insert("source".to_owned(), Value::String(source));
    payload.insert("source_id".to_owned(), Value::from(article.source_id));
    payload.insert("country".to_owned(), Value::from(article.country.clone()));
    payload.insert("credibility".to_owned(), Value::from(article.credibility));
    payload.insert("bias".to_owned(), Value::from(article.bias));
    payload.insert("summary".to_owned(), Value::from(summary));
    payload.insert("content".to_owned(), Value::from(content));
    payload.insert("description".to_owned(), Value::from(description));
    payload.insert("image".to_owned(), Value::from(image_url.clone()));
    payload.insert("image_url".to_owned(), Value::from(image_url));
    let published = utc_isoformat(&article.published_at);
    payload.insert("published".to_owned(), Value::String(published.clone()));
    payload.insert("published_at".to_owned(), Value::String(published));
    payload.insert("category".to_owned(), Value::String(category));
    payload.insert("url".to_owned(), Value::from(article.url.clone()));
    payload.insert("link".to_owned(), Value::from(article.url));
    payload.insert("author".to_owned(), Value::from(article.author));
    payload.insert("authors".to_owned(), Value::from(authors));
    payload.insert("tags".to_owned(), Value::from(tags));
    payload.insert(
        "original_language".to_owned(),
        Value::from(article.original_language),
    );
    payload.insert(
        "translated".to_owned(),
        Value::from(article.translated.unwrap_or(false)),
    );
    payload.insert("chroma_id".to_owned(), Value::from(article.chroma_id));
    payload.insert(
        "embedding_generated".to_owned(),
        Value::from(article.embedding_generated.unwrap_or(false)),
    );
    payload.insert(
        "created_at".to_owned(),
        Value::from(optional_utc_isoformat(article.created_at.as_ref())),
    );
    payload.insert(
        "updated_at".to_owned(),
        Value::from(optional_utc_isoformat(article.updated_at.as_ref())),
    );
    payload.insert("source_country".to_owned(), Value::from(article.country));
    payload.insert(
        "mentioned_countries".to_owned(),
        Value::from(mentioned_countries),
    );
    payload.insert(
        "geo_signal".to_owned(),
        serde_json::json!({"id": signal_id, "label": signal_label}),
    );
    Value::Object(payload)
}

fn matching_strategy(kind: CountryMatchKind) -> (&'static str, &'static str, &'static str) {
    match kind {
        CountryMatchKind::CountryMentions => {
            ("country_mentions", "Country mentions", "country_mentions")
        }
        CountryMatchKind::SourceOriginFallback => {
            ("source_origin", "Source origin", "source_origin_fallback")
        }
    }
}

fn country_counts_response(snapshot: CountryCountSnapshot, hours: i64) -> CountryCountsResponse {
    // A valid query cannot produce a negative coverage count. Saturation keeps
    // a corrupted legacy row from violating the non-negative API invariant.
    CountryCountsResponse {
        counts: snapshot.counts.clone(),
        source_counts: snapshot.source_counts.clone(),
        geo_signals: vec![
            geo_signal(
                "country_mentions",
                "Country mentions",
                &snapshot.counts,
                snapshot.articles_with_country,
            ),
            geo_signal(
                "source_origin",
                "Source origin",
                &snapshot.source_counts,
                snapshot.source_counts.values().copied().sum(),
            ),
        ],
        total_articles: snapshot.total_articles,
        articles_with_country: snapshot.articles_with_country,
        articles_without_country: snapshot
            .total_articles
            .saturating_sub(snapshot.articles_with_country),
        country_count: snapshot.counts.len() as i64,
        window_hours: hours,
    }
}

fn country_lens_response(
    code: String,
    view: String,
    limit: i64,
    offset: i64,
    hours: Option<i64>,
    page: CountryArticlePage,
) -> CountryLensResponse {
    let country_name = country_code_name(&code);
    let (signal_id, signal_label, strategy) = matching_strategy(page.matching_strategy);
    let view_description = match page.matching_strategy {
        CountryMatchKind::CountryMentions if view == "internal" => {
            format!("How sources in {country_name} cover {country_name}")
        }
        CountryMatchKind::CountryMentions => {
            format!("How outside sources cover {country_name}")
        }
        CountryMatchKind::SourceOriginFallback => {
            format!("Recent reporting from sources based in {country_name}")
        }
    };
    let returned = page.articles.len() as i64;
    let articles = page
        .articles
        .into_iter()
        .map(|article| serialize_article(article, signal_id, signal_label))
        .collect::<Vec<_>>();

    CountryLensResponse {
        country_code: code,
        country_name,
        view,
        view_description,
        matching_strategy: strategy.to_owned(),
        total: page.total,
        limit,
        offset,
        returned,
        has_more: offset.saturating_add(returned) < page.total,
        source_count: page.source_count,
        window_hours: hours,
        geo_signal: CountryLensSignal {
            id: signal_id.to_owned(),
            label: signal_label.to_owned(),
        },
        articles,
    }
}

#[utoipa::path(
    get,
    path = "/news/countries/geo",
    operation_id = "get_countries_geo_data_route_news_countries_geo_get",
    tag = "news-by-country",
    responses((status = 200, description = "Successful Response", body = CountryGeoData))
)]
pub(crate) async fn get_countries_geo_data_route() -> Json<CountryGeoData> {
    let countries = country_geo_data().clone();
    Json(CountryGeoData {
        total: countries.len() as i64,
        countries,
    })
}

#[utoipa::path(
    get,
    path = "/news/by-country",
    operation_id = "get_article_counts_by_country_news_by_country_get",
    tag = "news-by-country",
    params(CountryCountsQuery),
    responses((status = 200, description = "Successful Response", body = inline(FreeFormObjectSchema)),
        (status = 422, description = "Validation Error", body = crate::models::HttpValidationError))
)]
pub(crate) async fn get_article_counts_by_country(
    State(state): State<AppState>,
    uri: Uri,
) -> Response {
    let hours = match parse_counts_query(&uri) {
        Ok(hours) => hours,
        Err(error) => return error.into_response(),
    };
    let since = Utc::now() - Duration::hours(hours);
    match state.database.load_country_counts(since).await {
        Ok(snapshot) => Json(country_counts_response(snapshot, hours)).into_response(),
        Err(error) => {
            tracing::error!(%error, "country coverage count query failed");
            (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error").into_response()
        }
    }
}

#[utoipa::path(
    get,
    path = "/news/country/{code}",
    operation_id = "get_news_for_country_news_country__code__get",
    tag = "news-by-country",
    params(("code" = String, Path), CountryLensQuery),
    responses((status = 200, description = "Successful Response", body = inline(FreeFormObjectSchema)),
        (status = 422, description = "Validation Error", body = crate::models::HttpValidationError))
)]
pub(crate) async fn get_news_for_country(
    State(state): State<AppState>,
    Path(code): Path<String>,
    uri: Uri,
) -> Response {
    let (view, limit, offset, hours) = match parse_lens_query(&uri) {
        Ok(values) => values,
        Err(error) => return error.into_response(),
    };
    let code = code.to_uppercase();
    let since = hours.map(|hours| Utc::now() - Duration::hours(hours));
    let country_view = if view == "internal" {
        CountryView::Internal
    } else {
        CountryView::External
    };
    match state
        .database
        .load_country_articles(&code, country_view, since, limit, offset)
        .await
    {
        Ok(page) => Json(country_lens_response(
            code, view, limit, offset, hours, page,
        ))
        .into_response(),
        Err(error) => {
            tracing::error!(%error, "country article query failed");
            (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error").into_response()
        }
    }
}

#[utoipa::path(
    get,
    path = "/news/countries/list",
    operation_id = "list_available_countries_news_countries_list_get",
    tag = "news-by-country",
    responses((status = 200, description = "Successful Response", body = inline(FreeFormObjectSchema)))
)]
pub(crate) async fn list_available_countries(State(state): State<AppState>) -> Response {
    match state.database.load_available_countries().await {
        Ok(rows) => {
            let countries = rows.into_iter().map(country_list_item).collect::<Vec<_>>();
            Json(CountryListResponse {
                total_countries: countries.len() as i64,
                countries,
            })
            .into_response()
        }
        Err(error) => {
            tracing::error!(%error, "available country query failed");
            (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error").into_response()
        }
    }
}

fn country_list_item(row: CountrySummary) -> CountryListItem {
    CountryListItem {
        code: row.code,
        article_count: row.article_count,
        latest_article: optional_utc_isoformat(row.latest_article.as_ref()),
    }
}
