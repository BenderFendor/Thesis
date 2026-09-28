use std::collections::{HashMap, HashSet};

use axum::body::Bytes;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::Value;
use thesis_search::ranking::{rank_articles, ArticleInput, RankedResult};

use crate::models::{
    HttpValidationError, JsonArticle, RankRequest, RankResponse, ValidationLocation,
};

fn indexed_field_error(
    input: Value,
    field: &str,
    index: usize,
    error_type: &str,
    message: &str,
) -> HttpValidationError {
    let mut error = HttpValidationError::field(input, field, error_type, message);
    error.detail[0]
        .loc
        .push(ValidationLocation::Index(index as i64));
    error
}

fn parse_rank_id(value: &Value) -> Result<i64, (&'static str, &'static str)> {
    let invalid_integer = (
        "int_parsing",
        "Input should be a valid integer, unable to parse string as an integer",
    );
    match value {
        Value::Bool(value) => Ok(i64::from(*value)),
        Value::Number(number) => {
            if let Some(value) = number.as_i64() {
                return Ok(value);
            }
            if let Some(value) = number.as_u64() {
                return i64::try_from(value).map_err(|_| invalid_integer);
            }
            let Some(value) = number.as_f64() else {
                return Err(("int_type", "Input should be a valid integer"));
            };
            if value.fract() != 0.0 {
                return Err((
                    "int_from_float",
                    "Input should be a valid integer, got a number with a fractional part",
                ));
            }
            if !(i64::MIN as f64..i64::MAX as f64).contains(&value) {
                return Err(invalid_integer);
            }
            Ok(value as i64)
        }
        Value::String(value) => value.trim().parse().map_err(|_| invalid_integer),
        _ => Err(("int_type", "Input should be a valid integer")),
    }
}

fn parse_rank_ids(value: Option<&Value>, field: &str) -> Result<Vec<i64>, HttpValidationError> {
    let Some(value) = value else {
        return Ok(Vec::new());
    };
    let Some(values) = value.as_array() else {
        return Err(HttpValidationError::field(
            value.clone(),
            field,
            "list_type",
            "Input should be a valid list",
        ));
    };
    values
        .iter()
        .enumerate()
        .map(|(index, value)| {
            parse_rank_id(value).map_err(|(error_type, message)| {
                indexed_field_error(value.clone(), field, index, error_type, message)
            })
        })
        .collect()
}

fn parse_favorite_sources(value: Option<&Value>) -> Result<Vec<String>, HttpValidationError> {
    let Some(value) = value else {
        return Ok(Vec::new());
    };
    let Some(values) = value.as_array() else {
        return Err(HttpValidationError::field(
            value.clone(),
            "favorite_source_ids",
            "list_type",
            "Input should be a valid list",
        ));
    };
    values
        .iter()
        .enumerate()
        .map(|(index, value)| {
            value.as_str().map(str::to_owned).ok_or_else(|| {
                indexed_field_error(
                    value.clone(),
                    "favorite_source_ids",
                    index,
                    "string_type",
                    "Input should be a valid string",
                )
            })
        })
        .collect()
}

fn parse_rank_request(body: &[u8]) -> Result<RankRequest, HttpValidationError> {
    let value: Value = serde_json::from_slice(body)
        .map_err(|_| HttpValidationError::body(Value::Null, "json_invalid", "JSON decode error"))?;
    let Some(fields) = value.as_object() else {
        return Err(HttpValidationError::body(
            value,
            "model_type",
            "Input should be a valid dictionary or object to extract fields from",
        ));
    };
    let Some(article_values) = fields.get("articles") else {
        return Err(HttpValidationError::field(
            value.clone(),
            "articles",
            "missing",
            "Field required",
        ));
    };
    let Some(article_values) = article_values.as_array() else {
        return Err(HttpValidationError::field(
            article_values.clone(),
            "articles",
            "list_type",
            "Input should be a valid list",
        ));
    };
    let mut articles = Vec::with_capacity(article_values.len());
    for (index, article) in article_values.iter().enumerate() {
        let Some(article) = article.as_object() else {
            return Err(indexed_field_error(
                article.clone(),
                "articles",
                index,
                "dict_type",
                "Input should be a valid dictionary",
            ));
        };
        articles.push(article.clone().into_iter().collect());
    }
    Ok(RankRequest {
        articles,
        liked_article_ids: parse_rank_ids(fields.get("liked_article_ids"), "liked_article_ids")?,
        bookmarked_article_ids: parse_rank_ids(
            fields.get("bookmarked_article_ids"),
            "bookmarked_article_ids",
        )?,
        favorite_source_ids: parse_favorite_sources(fields.get("favorite_source_ids"))?,
    })
}

fn article_text(article: &JsonArticle, field: &str) -> String {
    article
        .get(field)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

fn article_tags(article: &JsonArticle) -> Vec<String> {
    article
        .get("tags")
        .and_then(Value::as_array)
        .and_then(|tags| {
            tags.iter()
                .map(Value::as_str)
                .map(|tag| tag.map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

fn article_input(article: &JsonArticle) -> Option<ArticleInput> {
    let id = article
        .get("id")
        .and_then(|value| value.as_i64().or_else(|| value.as_bool().map(i64::from)))?;
    Some(ArticleInput {
        id,
        title: article_text(article, "title"),
        summary: article_text(article, "summary"),
        category: article_text(article, "category"),
        source: article_text(article, "source"),
        source_id: article_text(article, "source_id"),
        tags: article_tags(article),
        image: article_text(article, "image"),
    })
}

fn rank_for_article(article: &JsonArticle, ranks: &HashMap<i64, RankedResult>) -> (i64, f64) {
    article
        .get("id")
        .and_then(|value| value.as_i64().or_else(|| value.as_bool().map(i64::from)))
        .and_then(|id| ranks.get(&id))
        .map(|rank| (rank.bucket_rank, rank.total_score))
        .unwrap_or_default()
}

fn rank_request(request: RankRequest) -> RankResponse {
    let liked_ids: HashSet<i64> = request.liked_article_ids.into_iter().collect();
    let bookmarked_ids: HashSet<i64> = request.bookmarked_article_ids.into_iter().collect();
    let favorite_source_ids: HashSet<String> = request.favorite_source_ids.into_iter().collect();
    let inputs: Vec<ArticleInput> = request.articles.iter().filter_map(article_input).collect();
    let ranks: HashMap<i64, RankedResult> =
        rank_articles(&inputs, &liked_ids, &bookmarked_ids, &favorite_source_ids)
            .into_iter()
            .map(|rank| (rank.article_id, rank))
            .collect();

    let mut articles = request.articles;
    articles.sort_by(|left, right| {
        let (left_bucket, left_score) = rank_for_article(left, &ranks);
        let (right_bucket, right_score) = rank_for_article(right, &ranks);
        right_bucket.cmp(&left_bucket).then_with(|| {
            right_score
                .partial_cmp(&left_score)
                .unwrap_or(std::cmp::Ordering::Equal)
        })
    });
    for article in &mut articles {
        if let Some(rank) = article
            .get("id")
            .and_then(|value| value.as_i64().or_else(|| value.as_bool().map(i64::from)))
            .and_then(|id| ranks.get(&id))
        {
            article.insert(
                "ranking".to_owned(),
                serde_json::to_value(rank).expect("ranking result serializes to JSON"),
            );
        }
    }

    RankResponse {
        total: articles.len(),
        articles,
    }
}

#[utoipa::path(
    post,
    path = "/news/ranked",
    operation_id = "post_ranked_articles_news_ranked_post",
    request_body = RankRequest,
    responses(
        (status = 200, description = "Successful Response", body = RankResponse),
        (status = 422, description = "Validation Error", body = crate::models::HttpValidationError)
    )
)]
pub(crate) async fn post_ranked_articles(body: Bytes) -> Response {
    let request = match parse_rank_request(&body) {
        Ok(request) => request,
        Err(error) => return error.into_response(),
    };
    Json(rank_request(request)).into_response()
}
