use std::cmp::Reverse;
use std::collections::{BTreeMap, BTreeSet};

use axum::extract::State;
use axum::http::{StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::Json;
use chrono::NaiveDateTime;

use crate::models::HttpValidationError;
use crate::{wiki, AppState};

use super::graph::{build_response, casefold, project};
use super::{
    AtlasConfidenceTier, AtlasEntityType, AtlasGraphFiltersInput, AtlasIndexQuery,
    AtlasIndexQueryParameters, AtlasIndexResponse, AtlasIndexSort, AtlasNodeResponse,
};

#[derive(PartialEq, Eq, PartialOrd, Ord)]
enum IndexSortKey {
    Name(String),
    Connections(Reverse<i64>, String),
    Articles(Reverse<i64>, String),
    RecentlyIndexed(Reverse<NaiveDateTime>, String),
    Confidence(i8, String),
}

fn confidence_order(tier: Option<AtlasConfidenceTier>) -> i8 {
    match tier {
        None => -1,
        Some(AtlasConfidenceTier::Unresolved) => 0,
        Some(AtlasConfidenceTier::Likely) => 1,
        Some(AtlasConfidenceTier::Strong) => 2,
        Some(AtlasConfidenceTier::Verified) => 3,
        Some(AtlasConfidenceTier::Conflicting | AtlasConfidenceTier::Stale) => 0,
    }
}

fn sort_index_items(items: &mut [AtlasNodeResponse], sort: AtlasIndexSort) {
    let epoch = chrono::DateTime::<chrono::Utc>::from_timestamp(0, 0)
        .expect("Unix epoch is valid")
        .naive_utc();
    items.sort_by_cached_key(|node| {
        let label = casefold(&node.label);
        match sort {
            AtlasIndexSort::Name => IndexSortKey::Name(label),
            AtlasIndexSort::MostConnected => {
                IndexSortKey::Connections(Reverse(node.connection_count), label)
            }
            AtlasIndexSort::MostArticles => {
                IndexSortKey::Articles(Reverse(node.article_count), label)
            }
            AtlasIndexSort::RecentlyIndexed => {
                IndexSortKey::RecentlyIndexed(Reverse(node.updated_at.unwrap_or(epoch)), label)
            }
            AtlasIndexSort::LowestConfidence => {
                IndexSortKey::Confidence(confidence_order(node.confidence_tier), label)
            }
        }
    });
}

fn entity_type_name(entity_type: AtlasEntityType) -> &'static str {
    match entity_type {
        AtlasEntityType::Outlet => "outlet",
        AtlasEntityType::Organization => "organization",
        AtlasEntityType::Person => "person",
        AtlasEntityType::Reporter => "reporter",
    }
}

fn increment_facet(facets: &mut BTreeMap<String, i64>, value: Option<&str>) {
    if let Some(value) = value.filter(|value| !value.is_empty()) {
        *facets.entry(value.to_owned()).or_default() += 1;
    }
}

fn confidence_tier_name(tier: AtlasConfidenceTier) -> &'static str {
    match tier {
        AtlasConfidenceTier::Verified => "verified",
        AtlasConfidenceTier::Strong => "strong",
        AtlasConfidenceTier::Likely => "likely",
        AtlasConfidenceTier::Unresolved => "unresolved",
        AtlasConfidenceTier::Conflicting => "conflicting",
        AtlasConfidenceTier::Stale => "stale",
    }
}

fn build_index_facets(
    items: &[AtlasNodeResponse],
    kind_facet: BTreeMap<String, i64>,
) -> BTreeMap<String, BTreeMap<String, i64>> {
    let mut entity_type = BTreeMap::new();
    let mut country = BTreeMap::new();
    let mut funding = BTreeMap::new();
    let mut bias = BTreeMap::new();
    let mut status = BTreeMap::new();
    let mut confidence = BTreeMap::new();

    for item in items {
        *entity_type
            .entry(entity_type_name(item.entity_type).to_owned())
            .or_default() += 1;
        increment_facet(&mut country, item.country_code.as_deref());
        increment_facet(&mut funding, item.funding_type.as_deref());
        increment_facet(&mut bias, item.bias_rating.as_deref());
        increment_facet(&mut status, item.status.as_deref());
        if let Some(tier) = item.confidence_tier {
            increment_facet(&mut confidence, Some(confidence_tier_name(tier)));
        }
    }

    BTreeMap::from([
        ("entity_type".to_owned(), entity_type),
        ("country".to_owned(), country),
        ("funding".to_owned(), funding),
        ("bias".to_owned(), bias),
        ("status".to_owned(), status),
        ("confidence".to_owned(), confidence),
        ("kind".to_owned(), kind_facet),
    ])
}

fn index_response(
    mut items: Vec<AtlasNodeResponse>,
    kind: &[String],
    sort: AtlasIndexSort,
    cursor: Option<&str>,
    limit: i64,
) -> AtlasIndexResponse {
    let mut kind_facet = BTreeMap::new();
    for item in &items {
        increment_facet(&mut kind_facet, item.subtitle.as_deref());
    }

    if !kind.is_empty() {
        let wanted = kind
            .iter()
            .map(|value| casefold(value))
            .collect::<BTreeSet<_>>();
        items.retain(|item| {
            item.subtitle
                .as_deref()
                .is_some_and(|subtitle| wanted.contains(&casefold(subtitle)))
        });
    }
    sort_index_items(&mut items, sort);

    let offset = decode_cursor(cursor);
    let facets = build_index_facets(&items, kind_facet);
    let total = items.len();
    let limit = usize::try_from(limit).expect("query_index validates the Atlas index limit");
    let page = items
        .into_iter()
        .skip(offset)
        .take(limit)
        .collect::<Vec<_>>();
    let next_offset = offset.saturating_add(page.len());
    let next_cursor = (next_offset < total).then(|| encode_cursor(next_offset));

    AtlasIndexResponse {
        items: page,
        total: i64::try_from(total).expect("Atlas index item count fits in i64"),
        next_cursor,
        facets,
    }
}

fn encode_cursor(offset: usize) -> String {
    let mut decimal = [0_u8; std::mem::size_of::<usize>() * 3];
    let mut start = decimal.len();
    let mut remaining = offset;
    loop {
        start -= 1;
        decimal[start] = b'0' + u8::try_from(remaining % 10).expect("decimal digit fits in u8");
        remaining /= 10;
        if remaining == 0 {
            break;
        }
    }
    encode_url_safe_no_pad(&decimal[start..])
}

fn encode_url_safe_no_pad(input: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut output = String::with_capacity(input.len().saturating_mul(4).div_ceil(3));
    for chunk in input.chunks(3) {
        let first = chunk[0];
        let second = chunk.get(1).copied();
        let third = chunk.get(2).copied();
        output.push(char::from(ALPHABET[usize::from(first >> 2)]));
        output.push(char::from(
            ALPHABET[usize::from((first & 0b11) << 4 | second.unwrap_or_default() >> 4)],
        ));
        if let Some(second) = second {
            output.push(char::from(
                ALPHABET[usize::from((second & 0b1111) << 2 | third.unwrap_or_default() >> 6)],
            ));
        }
        if let Some(third) = third {
            output.push(char::from(ALPHABET[usize::from(third & 0b0011_1111)]));
        }
    }
    output
}

fn decode_cursor(cursor: Option<&str>) -> usize {
    let Some(cursor) = cursor.filter(|cursor| !cursor.is_empty()) else {
        return 0;
    };
    if !cursor.is_ascii() {
        return 0;
    }
    let mut decoded = [0_u8; 75];
    let Some(decoded_len) = decode_url_safe_nonvalidating(cursor.as_bytes(), &mut decoded) else {
        return 0;
    };
    let Ok(decoded) = std::str::from_utf8(&decoded[..decoded_len]) else {
        return 0;
    };
    parse_decimal_offset(decoded).unwrap_or_default()
}

fn decode_url_safe_nonvalidating(input: &[u8], output: &mut [u8]) -> Option<usize> {
    if input.len() > 100 {
        return None;
    }
    let mut sextet_count = 0;
    let mut decoded_len = 0;
    let mut buffer = 0_u32;
    let mut bit_count = 0_u32;
    for &byte in input {
        let value = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'-' | b'+' => 62,
            b'_' | b'/' => 63,
            b'=' => continue,
            _ => continue,
        };
        sextet_count += 1;
        buffer = (buffer << 6) | u32::from(value);
        bit_count += 6;
        if bit_count >= 8 {
            bit_count -= 8;
            let byte = u8::try_from(buffer >> bit_count).ok()?;
            *output.get_mut(decoded_len)? = byte;
            decoded_len += 1;
            buffer &= (1 << bit_count) - 1;
        }
    }
    (sextet_count % 4 != 1).then_some(decoded_len)
}

fn parse_decimal_offset(value: &str) -> Option<usize> {
    let value = value.trim_matches(|character: char| character.is_ascii_whitespace());
    let (negative, digits) = match value.as_bytes().first() {
        Some(b'-') => (true, &value.as_bytes()[1..]),
        Some(b'+') => (false, &value.as_bytes()[1..]),
        _ => (false, value.as_bytes()),
    };
    let mut offset = 0_usize;
    let mut saw_digit = false;
    let mut previous_was_digit = false;
    for (index, byte) in digits.iter().copied().enumerate() {
        if byte.is_ascii_digit() {
            offset = offset
                .saturating_mul(10)
                .saturating_add(usize::from(byte - b'0'));
            saw_digit = true;
            previous_was_digit = true;
        } else if byte == b'_' {
            if !previous_was_digit || !digits.get(index + 1).is_some_and(u8::is_ascii_digit) {
                return None;
            }
            previous_was_digit = false;
        } else {
            return None;
        }
    }
    if !saw_digit || !previous_was_digit {
        return None;
    }
    Some(if negative { 0 } else { offset })
}

#[utoipa::path(
    get,
    path = "/api/wiki/atlas/index",
    operation_id = "get_atlas_index_api_wiki_atlas_index_get",
    params(AtlasIndexQueryParameters),
    responses(
        (status = 200, description = "Successful Response", body = AtlasIndexResponse),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    ),
    tag = "wiki-atlas",
    summary = "Get Atlas Index",
    description = "Return a filtered, sorted, faceted Atlas entity index page."
)]
pub(crate) async fn get_atlas_index(State(state): State<AppState>, uri: Uri) -> Response {
    let values = match wiki::query_values(&uri) {
        Ok(values) => values,
        Err(error) => return error.into_response(),
    };
    let AtlasIndexQuery {
        entity_types,
        query,
        country,
        funding,
        bias,
        kind,
        sort,
        cursor,
        limit,
    } = match super::query_index(&values) {
        Ok(query) => query,
        Err(response) => return response,
    };

    let generated_at = chrono::Utc::now();
    let as_of = generated_at.naive_utc();
    let mut filters = AtlasGraphFiltersInput::default();
    filters.entity_types = entity_types;
    filters.q = query;
    filters.country = country;
    filters.funding = funding;
    filters.bias = bias;
    filters.limit_nodes = None;
    filters.limit_edges = 2500;
    filters.include_evidence_preview = false;

    let projection = match state
        .database
        .load_atlas_projection_data(as_of, as_of, None)
        .await
    {
        Ok(data) => data,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let graph = build_response(
        project(&projection, &filters, as_of, as_of),
        filters,
        generated_at,
    );
    let items = graph.nodes;
    Json(index_response(items, &kind, sort, cursor.as_deref(), limit)).into_response()
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use axum::http::StatusCode;
    use chrono::NaiveDate;

    use super::super::graph::{build_response, GraphData};
    use super::super::AtlasGraphFiltersInput;
    use super::{
        decode_cursor, encode_url_safe_no_pad, index_response, sort_index_items,
        AtlasConfidenceTier, AtlasEntityType, AtlasIndexQuery, AtlasIndexSort, AtlasNodeResponse,
    };

    fn node(
        id: &str,
        label: &str,
        connection_count: i64,
        article_count: i64,
        updated_at: Option<chrono::NaiveDateTime>,
        confidence_tier: Option<AtlasConfidenceTier>,
        subtitle: Option<&str>,
    ) -> AtlasNodeResponse {
        AtlasNodeResponse {
            id: id.to_owned(),
            entity_type: AtlasEntityType::Outlet,
            label: label.to_owned(),
            subtitle: subtitle.map(str::to_owned),
            country_code: Some("US".to_owned()),
            funding_type: Some("commercial".to_owned()),
            bias_rating: Some("center".to_owned()),
            factual_reporting: None,
            credibility_score: None,
            analysis_scores: Default::default(),
            article_count,
            connection_count,
            ownership_connection_count: 0,
            status: Some("active".to_owned()),
            confidence_tier,
            profile_path: None,
            updated_at,
            flags: Vec::new(),
            current_parent: None,
            pending_change: None,
            evidence_coverage: "unknown".to_owned(),
            freshness: "unknown".to_owned(),
            unresolved_gap: None,
        }
    }

    fn query(
        sort: AtlasIndexSort,
        kind: &[&str],
        cursor: Option<&str>,
        limit: i64,
        query: Option<&str>,
    ) -> AtlasIndexQuery {
        AtlasIndexQuery {
            entity_types: Vec::new(),
            query: query.map(str::to_owned),
            country: Vec::new(),
            funding: Vec::new(),
            bias: Vec::new(),
            kind: kind.iter().map(|value| (*value).to_owned()).collect(),
            sort,
            cursor: cursor.map(str::to_owned),
            limit,
        }
    }

    fn timestamp(seconds: i64) -> chrono::NaiveDateTime {
        NaiveDate::from_ymd_opt(1970, 1, 1)
            .expect("valid date")
            .and_hms_opt(0, 0, 0)
            .expect("valid time")
            + chrono::Duration::seconds(seconds)
    }

    #[test]
    fn name_sort_uses_casefolded_labels_and_stable_ties() {
        let mut nodes = vec![
            node("b", "beta", 0, 0, None, None, None),
            node("a1", "Alpha", 0, 0, None, None, None),
            node("a2", "alpha", 0, 0, None, None, None),
        ];
        sort_index_items(&mut nodes, AtlasIndexSort::Name);
        assert_eq!(
            nodes
                .iter()
                .map(|node| node.id.as_str())
                .collect::<Vec<_>>(),
            ["a1", "a2", "b"]
        );
    }

    #[test]
    fn connection_sort_descends_then_casefolds_and_stably_keeps_ties() {
        let mut nodes = vec![
            node("a1", "Alpha", 3, 0, None, None, None),
            node("b", "beta", 5, 0, None, None, None),
            node("a2", "alpha", 3, 0, None, None, None),
        ];
        sort_index_items(&mut nodes, AtlasIndexSort::MostConnected);
        assert_eq!(
            nodes
                .iter()
                .map(|node| node.id.as_str())
                .collect::<Vec<_>>(),
            ["b", "a1", "a2"]
        );
    }

    #[test]
    fn article_sort_descends_then_casefolds_and_stably_keeps_ties() {
        let mut nodes = vec![
            node("a1", "Alpha", 0, 3, None, None, None),
            node("b", "beta", 0, 5, None, None, None),
            node("a2", "alpha", 0, 3, None, None, None),
        ];
        sort_index_items(&mut nodes, AtlasIndexSort::MostArticles);
        assert_eq!(
            nodes
                .iter()
                .map(|node| node.id.as_str())
                .collect::<Vec<_>>(),
            ["b", "a1", "a2"]
        );
    }

    #[test]
    fn recently_indexed_sort_descends_and_keeps_none_epoch_ties_stable() {
        let mut nodes = vec![
            node("none", "Alpha", 0, 0, None, None, None),
            node("epoch", "alpha", 0, 0, Some(timestamp(0)), None, None),
            node("newer", "Newer", 0, 0, Some(timestamp(2)), None, None),
            node("older", "Older", 0, 0, Some(timestamp(1)), None, None),
        ];
        sort_index_items(&mut nodes, AtlasIndexSort::RecentlyIndexed);
        assert_eq!(
            nodes
                .iter()
                .map(|node| node.id.as_str())
                .collect::<Vec<_>>(),
            ["newer", "older", "none", "epoch"]
        );
    }

    #[test]
    fn lowest_confidence_orders_none_then_python_tiers_and_unknown_tiers() {
        let mut nodes = vec![
            node(
                "verified",
                "Verified",
                0,
                0,
                None,
                Some(AtlasConfidenceTier::Verified),
                None,
            ),
            node("none", "No tier", 0, 0, None, None, None),
            node(
                "stale",
                "Stale",
                0,
                0,
                None,
                Some(AtlasConfidenceTier::Stale),
                None,
            ),
            node(
                "strong",
                "Strong",
                0,
                0,
                None,
                Some(AtlasConfidenceTier::Strong),
                None,
            ),
            node(
                "likely",
                "Likely",
                0,
                0,
                None,
                Some(AtlasConfidenceTier::Likely),
                None,
            ),
            node(
                "unresolved1",
                "Unresolved",
                0,
                0,
                None,
                Some(AtlasConfidenceTier::Unresolved),
                None,
            ),
            node(
                "unresolved2",
                "unresolved",
                0,
                0,
                None,
                Some(AtlasConfidenceTier::Unresolved),
                None,
            ),
            node(
                "conflicting",
                "Conflicting",
                0,
                0,
                None,
                Some(AtlasConfidenceTier::Conflicting),
                None,
            ),
        ];
        sort_index_items(&mut nodes, AtlasIndexSort::LowestConfidence);
        assert_eq!(
            nodes
                .iter()
                .map(|node| node.id.as_str())
                .collect::<Vec<_>>(),
            [
                "none",
                "conflicting",
                "stale",
                "unresolved1",
                "unresolved2",
                "likely",
                "strong",
                "verified"
            ]
        );
    }

    #[test]
    fn kind_filter_casefolds_and_preserves_pre_filter_kind_facet() {
        let query = query(AtlasIndexSort::Name, &["LEGAL ENTITY"], None, 1, None);
        let mut one = node("one", "One", 0, 0, None, None, Some("Legal Entity"));
        one.confidence_tier = Some(AtlasConfidenceTier::Likely);
        let items = vec![
            one,
            node("two", "Two", 0, 0, None, None, Some("legal entity")),
            node("other", "Other", 0, 0, None, None, Some("Person")),
        ];
        let response = index_response(
            items,
            &query.kind,
            query.sort,
            query.cursor.as_deref(),
            query.limit,
        );
        assert_eq!(response.total, 2);
        assert_eq!(response.items.len(), 1);
        assert_eq!(response.facets["kind"]["Legal Entity"], 1);
        assert_eq!(response.facets["kind"]["legal entity"], 1);
        assert_eq!(response.facets["kind"]["Person"], 1);
        assert_eq!(response.facets["entity_type"]["outlet"], 2);
        assert_eq!(response.facets["country"]["US"], 2);
        assert_eq!(response.facets["funding"]["commercial"], 2);
        assert_eq!(response.facets["bias"]["center"], 2);
        assert_eq!(response.facets["status"]["active"], 2);
        assert_eq!(response.facets["confidence"]["likely"], 1);
    }
    #[test]
    fn graph_query_casefolds_substrings_across_index_search_fields() {
        let mut filters = AtlasGraphFiltersInput::default();
        filters.q = Some(" ACME ".to_owned());
        filters.limit_nodes = None;

        let mut subtitle = node("subtitle", "Subtitle result", 0, 0, None, None, None);
        subtitle.subtitle = Some("aCmE group".to_owned());
        let mut country = node("country", "Country result", 0, 0, None, None, None);
        country.country_code = Some("aCmE".to_owned());
        let mut funding = node("funding", "Funding result", 0, 0, None, None, None);
        funding.funding_type = Some("aCmE".to_owned());
        let mut bias = node("bias", "Bias result", 0, 0, None, None, None);
        bias.bias_rating = Some("aCmE".to_owned());

        let response = build_response(
            GraphData {
                nodes: vec![
                    node("label", "aCmE outlet", 0, 0, None, None, None),
                    subtitle,
                    country,
                    funding,
                    bias,
                    node("unmatched", "Other outlet", 0, 0, None, None, None),
                ],
                edges: Vec::new(),
            },
            filters,
            chrono::DateTime::<chrono::Utc>::from_timestamp(0, 0).expect("Unix epoch is valid"),
        );
        let mut ids = response
            .nodes
            .into_iter()
            .map(|node| node.id)
            .collect::<Vec<_>>();
        ids.sort();
        assert_eq!(ids, ["bias", "country", "funding", "label", "subtitle"]);
    }

    #[test]
    fn pagination_totals_and_next_cursor_follow_filtered_boundaries() {
        let nodes = vec![
            node("c", "C", 0, 0, None, None, None),
            node("a", "A", 0, 0, None, None, None),
            node("b", "B", 0, 0, None, None, None),
        ];
        let first = index_response(nodes.clone(), &[], AtlasIndexSort::Name, None, 2);
        assert_eq!(first.total, 3);
        assert_eq!(
            first
                .items
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            ["a", "b"]
        );
        assert_eq!(first.next_cursor.as_deref(), Some("Mg"));
        assert_eq!(first.facets["entity_type"]["outlet"], 3);

        let final_page = index_response(nodes.clone(), &[], AtlasIndexSort::Name, Some("Mg"), 2);
        assert_eq!(final_page.total, 3);
        assert_eq!(
            final_page
                .items
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            ["c"]
        );
        assert_eq!(final_page.next_cursor, None);

        let at_end = index_response(nodes.clone(), &[], AtlasIndexSort::Name, Some("Mw"), 2);
        assert!(at_end.items.is_empty());
        assert_eq!(at_end.next_cursor, None);

        let beyond_end = index_response(nodes, &[], AtlasIndexSort::Name, Some("NQ"), 2);
        assert!(beyond_end.items.is_empty());
        assert_eq!(beyond_end.next_cursor, None);
    }

    #[test]
    fn malformed_negative_and_unicode_cursors_start_at_zero_while_ascii_base64_matches_python() {
        assert_eq!(decode_cursor(None), 0);
        assert_eq!(decode_cursor(Some("%%%")), 0);
        assert_eq!(decode_cursor(Some("M")), 0);
        assert_eq!(decode_cursor(Some("not a cursor")), 0);
        assert_eq!(decode_cursor(Some("M!Q")), 1);
        assert_eq!(decode_cursor(Some("M=Q")), 1);
        assert_eq!(decode_cursor(Some("MQ===ignored")), 0);
        assert_eq!(decode_cursor(Some(&encode_url_safe_no_pad(b"-12"))), 0);
        assert_eq!(decode_cursor(Some("é")), 0);
        assert_eq!(
            decode_cursor(Some(&encode_url_safe_no_pad("١".as_bytes()))),
            0
        );
        assert_eq!(
            decode_cursor(Some(&encode_url_safe_no_pad(
                "\u{2003}1\u{2003}".as_bytes()
            ))),
            0
        );
    }

    #[test]
    fn shared_index_query_enforces_defaults_and_bounds() {
        let defaults = match super::super::query_index(&HashMap::new()) {
            Ok(query) => query,
            Err(_) => panic!("default index query should parse"),
        };
        assert!(matches!(defaults.sort, AtlasIndexSort::Name));
        assert_eq!(defaults.limit, 60);
        assert_eq!(defaults.cursor, None);
        assert_eq!(defaults.query, None);

        let q_max = HashMap::from([("q".to_owned(), "x".repeat(200))]);
        assert!(super::super::query_index(&q_max).is_ok());
        let q_too_long = HashMap::from([("q".to_owned(), "x".repeat(201))]);
        assert!(matches!(
            super::super::query_index(&q_too_long),
            Err(response) if response.status() == StatusCode::UNPROCESSABLE_ENTITY
        ));

        let cursor_max = HashMap::from([("cursor".to_owned(), "x".repeat(100))]);
        assert!(super::super::query_index(&cursor_max).is_ok());
        let cursor_too_long = HashMap::from([("cursor".to_owned(), "x".repeat(101))]);
        assert!(matches!(
            super::super::query_index(&cursor_too_long),
            Err(response) if response.status() == StatusCode::UNPROCESSABLE_ENTITY
        ));

        for limit in ["1", "100"] {
            assert!(super::super::query_index(&HashMap::from([(
                "limit".to_owned(),
                limit.to_owned()
            )]))
            .is_ok());
        }
        for limit in ["0", "101"] {
            assert!(matches!(
                super::super::query_index(&HashMap::from([(
                    "limit".to_owned(),
                    limit.to_owned()
                )])),
                Err(response) if response.status() == StatusCode::UNPROCESSABLE_ENTITY
            ));
        }
        let invalid_sort = HashMap::from([("sort".to_owned(), "arbitrary".to_owned())]);
        assert!(matches!(
            super::super::query_index(&invalid_sort),
            Err(response) if response.status() == StatusCode::UNPROCESSABLE_ENTITY
        ));
    }
}
