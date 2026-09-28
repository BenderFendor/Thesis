use std::collections::BTreeMap;

use serde_json::Value;
use sqlx::types::Json;
use sqlx::{FromRow, PgPool};

use crate::{empty_json_array, Database};
#[derive(Debug)]
pub struct WikiMaterialInterestSnapshot {
    pub gdelt_context: Result<WikiMaterialGdeltContext, sqlx::Error>,
    pub country_resources: Result<Vec<WikiMaterialCountryResource>, sqlx::Error>,
    pub trade_relationships: Vec<WikiMaterialTradePair>,
    pub commodity_context: Result<Vec<WikiMaterialCommodityContext>, sqlx::Error>,
    pub source_owner_interests: Result<WikiMaterialSourceOwnerInterests, sqlx::Error>,
}

#[derive(Clone, Debug)]
pub struct WikiMaterialGdeltContext {
    pub cooperation_events: i64,
    pub conflict_events: i64,
    pub economic_events: i64,
    pub avg_tone: Option<f64>,
    pub avg_goldstein: Option<f64>,
    pub total_events: i64,
}

#[derive(Clone, Debug)]
pub struct WikiMaterialCountryResource {
    pub country_code: String,
    pub natural_resources: Json<Value>,
    pub top_exports: Json<Value>,
    pub top_imports: Json<Value>,
    pub economic_sectors: Json<Value>,
}

#[derive(Debug)]
pub struct WikiMaterialTradePair {
    pub exporter: String,
    pub importer: String,
    pub data: Result<WikiMaterialTradeFlow, sqlx::Error>,
}

#[derive(Clone, Debug)]
pub struct WikiMaterialTradeFlow {
    pub total_trade_value_usd: Option<f64>,
    pub product_count: i64,
    pub top_products: Vec<WikiMaterialTradeProduct>,
}

#[derive(Clone, Debug)]
pub struct WikiMaterialTradeProduct {
    pub product_code: String,
    pub product_name: String,
    pub trade_value_usd: Option<f64>,
}

#[derive(Clone, Debug)]
pub struct WikiMaterialCommodityContext {
    pub commodity_name: String,
    pub latest_price_usd: Option<f64>,
    pub trend_pct_6mo: Option<f64>,
    pub data_points: i64,
}

#[derive(Clone, Debug)]
pub struct WikiMaterialSourceOwnerInterests {
    pub source_name: String,
    pub organization: Option<WikiMaterialOrganization>,
    pub analysis_scores: Vec<WikiMaterialAnalysisScore>,
}

#[derive(Clone, Debug)]
pub struct WikiMaterialOrganization {
    pub name: String,
    pub org_type: Option<String>,
    pub funding_type: Option<String>,
    pub parent_org_id: Option<i64>,
    pub funding_sources: Json<Value>,
    pub major_advertisers: Json<Value>,
    pub media_bias_rating: Option<String>,
    pub factual_reporting: Option<String>,
}

#[derive(Clone, Debug)]
pub struct WikiMaterialAnalysisScore {
    pub axis: String,
    pub score: i32,
    pub explanation: Option<String>,
}

#[derive(Debug, FromRow)]
struct WikiMaterialCountryResourceRow {
    country_code: String,
    natural_resources: Option<Json<Value>>,
    top_exports: Option<Json<Value>>,
    top_imports: Option<Json<Value>>,
    economic_sectors: Option<Json<Value>>,
}

#[derive(Debug, FromRow)]
struct WikiMaterialGdeltRow {
    cooperation_events: i64,
    conflict_events: i64,
    economic_events: i64,
    avg_tone: Option<f64>,
    avg_goldstein: Option<f64>,
    total_events: i64,
}

#[derive(Debug, FromRow)]
struct WikiMaterialTradeRow {
    total_trade_value_usd: Option<f64>,
    product_count: i64,
    product_code: Option<String>,
    product_name: Option<String>,
    trade_value_usd: Option<f64>,
}

#[derive(Debug, FromRow)]
struct WikiMaterialCommodityPriceRow {
    commodity_name: String,
    price_usd: Option<f64>,
}

#[derive(Debug, FromRow)]
struct WikiMaterialOrganizationRow {
    name: String,
    org_type: Option<String>,
    funding_type: Option<String>,
    parent_org_id: Option<i64>,
    funding_sources: Option<Json<Value>>,
    major_advertisers: Option<Json<Value>>,
    media_bias_rating: Option<String>,
    factual_reporting: Option<String>,
}

#[derive(Debug, FromRow)]
struct WikiMaterialAnalysisScoreRow {
    axis: String,
    score: i32,
    explanation: Option<String>,
}

fn json_value_is_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(value) => *value,
        Value::Number(value) => value.as_f64().is_some_and(|number| number != 0.0),
        Value::String(value) => !value.is_empty(),
        Value::Array(value) => !value.is_empty(),
        Value::Object(value) => !value.is_empty(),
    }
}

fn material_array_or_empty(value: Option<Json<Value>>) -> Json<Value> {
    value
        .filter(|value| json_value_is_truthy(&value.0))
        .unwrap_or_else(empty_json_array)
}

fn material_round(value: Option<f64>, decimal_places: i32) -> Option<f64> {
    value.map(|value| {
        let factor = 10_f64.powi(decimal_places);
        (value * factor).round_ties_even() / factor
    })
}

async fn query_material_country_resources(
    pool: &PgPool,
    country_codes: &[String],
) -> Result<Vec<WikiMaterialCountryResource>, sqlx::Error> {
    if country_codes.is_empty() {
        return Ok(Vec::new());
    }
    let codes = country_codes
        .iter()
        .map(|code| code.to_uppercase())
        .collect::<Vec<_>>();
    let rows = sqlx::query_as::<_, WikiMaterialCountryResourceRow>(
        "SELECT country_code, natural_resources, top_exports, top_imports, economic_sectors \
         FROM country_resources WHERE country_code = ANY($1) ORDER BY country_code",
    )
    .bind(codes)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| WikiMaterialCountryResource {
            country_code: row.country_code.to_uppercase(),
            natural_resources: material_array_or_empty(row.natural_resources),
            top_exports: material_array_or_empty(row.top_exports),
            top_imports: material_array_or_empty(row.top_imports),
            economic_sectors: material_array_or_empty(row.economic_sectors),
        })
        .collect())
}

async fn query_material_gdelt_context(
    pool: &PgPool,
    country_codes: &[String],
    cutoff: chrono::NaiveDateTime,
) -> Result<WikiMaterialGdeltContext, sqlx::Error> {
    if country_codes.is_empty() {
        return Ok(WikiMaterialGdeltContext {
            cooperation_events: 0,
            conflict_events: 0,
            economic_events: 0,
            avg_tone: None,
            avg_goldstein: None,
            total_events: 0,
        });
    }
    let codes = country_codes
        .iter()
        .map(|code| code.to_uppercase())
        .collect::<Vec<_>>();
    let row = sqlx::query_as::<_, WikiMaterialGdeltRow>(
        "SELECT \
             COUNT(*) FILTER (WHERE CAST(event_root_code AS FLOAT) BETWEEN 1 AND 6) \
                 AS cooperation_events, \
             COUNT(*) FILTER (WHERE CAST(event_root_code AS FLOAT) BETWEEN 7 AND 13) \
                 AS conflict_events, \
             COUNT(*) FILTER (WHERE CAST(event_root_code AS FLOAT) BETWEEN 14 AND 20) \
                 AS economic_events, \
             AVG(tone) AS avg_tone, AVG(goldstein_scale) AS avg_goldstein, \
             COUNT(*) AS total_events \
         FROM gdelt_events \
         WHERE published_at >= $1 \
           AND (actor1_country = ANY($2) OR actor2_country = ANY($2))",
    )
    .bind(cutoff)
    .bind(codes)
    .fetch_one(pool)
    .await?;
    Ok(WikiMaterialGdeltContext {
        cooperation_events: row.cooperation_events,
        conflict_events: row.conflict_events,
        economic_events: row.economic_events,
        avg_tone: material_round(row.avg_tone, 3),
        avg_goldstein: material_round(row.avg_goldstein, 3),
        total_events: row.total_events,
    })
}

async fn query_material_trade_flow(
    pool: &PgPool,
    exporter: &str,
    importer: &str,
) -> Result<WikiMaterialTradeFlow, sqlx::Error> {
    let rows = sqlx::query_as::<_, WikiMaterialTradeRow>(
        "SELECT aggregate.total_trade_value_usd, aggregate.product_count, \
                product.product_code, product.product_name, product.trade_value_usd \
         FROM ( \
             SELECT SUM(trade_value_usd) AS total_trade_value_usd, COUNT(*)::bigint AS product_count \
             FROM trade_flows WHERE exporter_country = $1 AND importer_country = $2 \
         ) AS aggregate \
         LEFT JOIN LATERAL ( \
             SELECT product_code, product_name, trade_value_usd \
             FROM trade_flows WHERE exporter_country = $1 AND importer_country = $2 \
             ORDER BY trade_value_usd DESC LIMIT 5 \
         ) AS product ON TRUE",
    )
    .bind(exporter)
    .bind(importer)
    .fetch_all(pool)
    .await?;
    let Some(first) = rows.first() else {
        return Err(sqlx::Error::RowNotFound);
    };
    let total_trade_value_usd = first.total_trade_value_usd;
    let product_count = first.product_count;
    let mut top_products = Vec::new();
    for row in rows {
        if let (Some(product_code), Some(product_name)) = (row.product_code, row.product_name) {
            top_products.push(WikiMaterialTradeProduct {
                product_code,
                product_name,
                trade_value_usd: row.trade_value_usd,
            });
        }
    }
    Ok(WikiMaterialTradeFlow {
        total_trade_value_usd,
        product_count,
        top_products,
    })
}

async fn query_material_commodity_context(
    pool: &PgPool,
    commodity_names: &[String],
    cutoff: chrono::NaiveDateTime,
) -> Result<Vec<WikiMaterialCommodityContext>, sqlx::Error> {
    if commodity_names.is_empty() {
        return Ok(Vec::new());
    }
    let rows = sqlx::query_as::<_, WikiMaterialCommodityPriceRow>(
        "SELECT commodity_name, price_usd FROM commodity_prices \
         WHERE commodity_name = ANY($1) AND date >= $2 \
         ORDER BY commodity_name, date DESC",
    )
    .bind(commodity_names)
    .bind(cutoff)
    .fetch_all(pool)
    .await?;
    let mut prices_by_name = BTreeMap::<String, Vec<Option<f64>>>::new();
    for row in rows {
        prices_by_name
            .entry(row.commodity_name)
            .or_default()
            .push(row.price_usd);
    }
    Ok(prices_by_name
        .into_iter()
        .map(|(commodity_name, prices)| {
            let latest = prices.first().copied().flatten();
            let oldest = prices.last().copied().flatten();
            let trend_pct_6mo = match (latest, oldest) {
                (Some(latest), Some(oldest)) if oldest != 0.0 => {
                    material_round(Some((latest - oldest) / oldest * 100.0), 1)
                }
                _ => None,
            };
            WikiMaterialCommodityContext {
                commodity_name,
                latest_price_usd: latest,
                trend_pct_6mo,
                data_points: prices.len() as i64,
            }
        })
        .collect())
}

async fn query_material_source_owner_interests(
    pool: &PgPool,
    source_name: &str,
) -> Result<WikiMaterialSourceOwnerInterests, sqlx::Error> {
    let normalized_name = source_name.trim().to_lowercase();
    let organization = sqlx::query_as::<_, WikiMaterialOrganizationRow>(
        "SELECT name, org_type, funding_type, parent_org_id::bigint AS parent_org_id, \
                funding_sources, major_advertisers, media_bias_rating, factual_reporting \
         FROM organizations WHERE LOWER(normalized_name) = $1 LIMIT 1",
    )
    .bind(&normalized_name)
    .fetch_optional(pool)
    .await?
    .map(|row| WikiMaterialOrganization {
        name: row.name,
        org_type: row.org_type,
        funding_type: row.funding_type,
        parent_org_id: row.parent_org_id,
        funding_sources: material_array_or_empty(row.funding_sources),
        major_advertisers: material_array_or_empty(row.major_advertisers),
        media_bias_rating: row.media_bias_rating,
        factual_reporting: row.factual_reporting,
    });
    let analysis_scores = sqlx::query_as::<_, WikiMaterialAnalysisScoreRow>(
        "SELECT axis_name AS axis, score, prose_explanation AS explanation \
         FROM source_analysis_scores WHERE LOWER(source_name) = $1",
    )
    .bind(&normalized_name)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|row| WikiMaterialAnalysisScore {
        axis: row.axis,
        score: row.score,
        explanation: row.explanation,
    })
    .collect();
    Ok(WikiMaterialSourceOwnerInterests {
        source_name: source_name.to_owned(),
        organization,
        analysis_scores,
    })
}

impl Database {
    pub async fn wiki_country_resources(
        &self,
        country_codes: &[String],
    ) -> Result<Vec<WikiMaterialCountryResource>, sqlx::Error> {
        query_material_country_resources(&self.pool, country_codes).await
    }

    pub async fn wiki_material_interest_snapshot(
        &self,
        countries: &[String],
        source_name: &str,
        resource_limit: usize,
        commodity_cutoff: chrono::NaiveDateTime,
        gdelt_cutoff: chrono::NaiveDateTime,
    ) -> Result<WikiMaterialInterestSnapshot, sqlx::Error> {
        let connection = self.pool.acquire().await?;
        drop(connection);
        let country_resources = query_material_country_resources(&self.pool, countries).await;
        let commodity_names = country_resources
            .as_ref()
            .ok()
            .into_iter()
            .flatten()
            .flat_map(|country| {
                country
                    .natural_resources
                    .0
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|resource| {
                        resource
                            .as_str()
                            .map(str::to_owned)
                            .unwrap_or_else(|| resource.to_string())
                    })
            })
            .take(resource_limit)
            .collect::<Vec<_>>();
        let commodity_context = if commodity_names.is_empty() {
            Ok(Vec::new())
        } else {
            query_material_commodity_context(&self.pool, &commodity_names, commodity_cutoff).await
        };
        let gdelt_context = query_material_gdelt_context(&self.pool, countries, gdelt_cutoff).await;
        let mut trade_relationships = Vec::new();
        for (index, exporter) in countries.iter().enumerate() {
            for importer in countries.iter().skip(index + 1) {
                let exporter_code = exporter.to_uppercase();
                let importer_code = importer.to_uppercase();
                trade_relationships.push(WikiMaterialTradePair {
                    exporter: exporter.clone(),
                    importer: importer.clone(),
                    data: query_material_trade_flow(&self.pool, &exporter_code, &importer_code)
                        .await,
                });
            }
        }
        let source_owner_interests =
            query_material_source_owner_interests(&self.pool, source_name).await;
        Ok(WikiMaterialInterestSnapshot {
            gdelt_context,
            country_resources,
            trade_relationships,
            commodity_context,
            source_owner_interests,
        })
    }

    pub async fn wiki_save_material_interest_analysis(
        &self,
        article_url: &str,
        source_name: &str,
        analysis_json: Value,
        created_at: chrono::NaiveDateTime,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO material_interest_analyses \
             (article_url, source_name, analysis_json, created_at) VALUES ($1, $2, $3, $4)",
        )
        .bind(article_url)
        .bind(source_name)
        .bind(Json(analysis_json))
        .bind(created_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

#[cfg(test)]
mod material_interest_tests {
    use super::Database;
    use chrono::{NaiveDate, NaiveDateTime};
    use serde_json::{json, Value};
    use sqlx::types::Json;
    use sqlx::{PgPool, Row};

    fn date(year: i32, month: u32, day: u32) -> NaiveDateTime {
        NaiveDate::from_ymd_opt(year, month, day)
            .expect("valid date")
            .and_hms_opt(0, 0, 0)
            .expect("valid time")
    }

    async fn create_material_interest_tables(pool: &PgPool) {
        for statement in [
            "CREATE TABLE gdelt_events (id BIGSERIAL PRIMARY KEY, event_root_code TEXT, \
                actor1_country TEXT, actor2_country TEXT, tone DOUBLE PRECISION, \
                goldstein_scale DOUBLE PRECISION, published_at TIMESTAMP)",
            "CREATE TABLE country_resources (country_code TEXT PRIMARY KEY, natural_resources JSON, \
                top_exports JSON, top_imports JSON, economic_sectors JSON)",
            "CREATE TABLE trade_flows (id BIGSERIAL PRIMARY KEY, exporter_country TEXT NOT NULL, \
                importer_country TEXT NOT NULL, product_code TEXT NOT NULL, product_name TEXT NOT NULL, \
                trade_value_usd DOUBLE PRECISION)",
            "CREATE TABLE commodity_prices (id BIGSERIAL PRIMARY KEY, commodity_name TEXT NOT NULL, \
                price_usd DOUBLE PRECISION, date TIMESTAMP, source TEXT)",
            "CREATE TABLE organizations (id SERIAL PRIMARY KEY, name TEXT NOT NULL, \
                normalized_name TEXT, org_type TEXT, parent_org_id INTEGER, funding_type TEXT, \
                funding_sources JSON, major_advertisers JSON, media_bias_rating TEXT, \
                factual_reporting TEXT)",
            "CREATE TABLE source_analysis_scores (id SERIAL PRIMARY KEY, source_name TEXT NOT NULL, \
                axis_name TEXT NOT NULL, score INTEGER NOT NULL, prose_explanation TEXT)",
            "CREATE TABLE material_interest_analyses (id SERIAL PRIMARY KEY, article_url TEXT NOT NULL, \
                source_name TEXT NOT NULL, analysis_json JSON NOT NULL, created_at TIMESTAMP)",
        ] {
            sqlx::query(statement)
                .execute(pool)
                .await
                .expect("create isolated material-interest table");
        }
    }

    async fn insert_trade_product(
        pool: &PgPool,
        exporter: &str,
        importer: &str,
        code: &str,
        value: f64,
    ) {
        sqlx::query(
            "INSERT INTO trade_flows \
             (exporter_country, importer_country, product_code, product_name, trade_value_usd) \
             VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(exporter)
        .bind(importer)
        .bind(code)
        .bind(format!("Product {code}"))
        .bind(value)
        .execute(pool)
        .await
        .expect("insert isolated trade flow");
    }

    async fn seed_material_interest_tables(pool: &PgPool) {
        sqlx::query(
            "INSERT INTO country_resources \
             (country_code, natural_resources, top_exports, top_imports, economic_sectors) \
             VALUES ('CA', '[\"Oil\", \"Copper\", \"Oil\"]', NULL, '[]', NULL), \
                    ('US', '[\"Gold\"]', '[\"Wheat\"]', NULL, '[\"services\"]')",
        )
        .execute(pool)
        .await
        .expect("insert country resources");

        for (code, actor1, actor2, tone, goldstein, published_at) in [
            ("1", Some("US"), None, 1.2345, 2.0, date(2025, 1, 2)),
            ("7", None, Some("CA"), 2.1234, 4.0, date(2025, 1, 3)),
            ("20", Some("MX"), Some("CA"), 3.5678, 6.0, date(2025, 1, 4)),
            ("99", Some("US"), None, 9.0, 9.0, date(2025, 1, 5)),
            ("14", Some("US"), None, 90.0, 90.0, date(2024, 12, 31)),
        ] {
            sqlx::query(
                "INSERT INTO gdelt_events \
                 (event_root_code, actor1_country, actor2_country, tone, goldstein_scale, published_at) \
                 VALUES ($1, $2, $3, $4, $5, $6)",
            )
            .bind(code)
            .bind(actor1)
            .bind(actor2)
            .bind(tone)
            .bind(goldstein)
            .bind(published_at)
            .execute(pool)
            .await
            .expect("insert GDELT event");
        }

        for (index, value) in [10.0, 20.0, 30.0, 40.0, 50.0, 60.0].into_iter().enumerate() {
            insert_trade_product(pool, "US", "CA", &format!("P{}", index + 1), value).await;
        }
        insert_trade_product(pool, "CA", "US", "REVERSE", 999.0).await;

        // The 180-day fixture includes the cutoff and excludes the prior date.
        for (name, price, published_at) in [
            ("Oil", 5.0, date(2024, 12, 31)),
            ("Oil", 10.0, date(2025, 1, 1)),
            ("Oil", 20.0, date(2025, 6, 30)),
            ("Copper", 8.0, date(2025, 2, 1)),
            ("Gold", 100.0, date(2025, 2, 1)),
        ] {
            sqlx::query(
                "INSERT INTO commodity_prices (commodity_name, price_usd, date, source) \
                 VALUES ($1, $2, $3, 'test')",
            )
            .bind(name)
            .bind(price)
            .bind(published_at)
            .execute(pool)
            .await
            .expect("insert commodity price");
        }

        sqlx::query(
            "INSERT INTO organizations \
             (name, normalized_name, org_type, parent_org_id, funding_type, funding_sources, \
              major_advertisers, media_bias_rating, factual_reporting) \
             VALUES ('Example News', 'example news', 'publisher', 42, 'commercial', NULL, \
                     '[\"Sponsor\"]', 'center', 'high')",
        )
        .execute(pool)
        .await
        .expect("insert source organization");
        for (source, axis, score) in [
            ("example news", "funding", 4),
            ("EXAMPLE NEWS", "credibility", 3),
        ] {
            sqlx::query(
                "INSERT INTO source_analysis_scores (source_name, axis_name, score, prose_explanation) \
                 VALUES ($1, $2, $3, $4)",
            )
            .bind(source)
            .bind(axis)
            .bind(score)
            .bind(format!("{axis} score"))
            .execute(pool)
            .await
            .expect("insert source analysis score");
        }
    }

    #[sqlx::test(migrations = false)]
    async fn material_interest_snapshot_reads_real_tables_and_preserves_section_failures(
        pool: PgPool,
    ) {
        create_material_interest_tables(&pool).await;
        seed_material_interest_tables(&pool).await;
        let database = Database { pool: pool.clone() };
        let countries = vec!["us".to_owned(), "ca".to_owned(), "mx".to_owned()];
        let commodity_cutoff = date(2025, 1, 1);
        let gdelt_cutoff = date(2025, 1, 1);
        let snapshot = database
            .wiki_material_interest_snapshot(
                &countries,
                " Example News ",
                3,
                commodity_cutoff,
                gdelt_cutoff,
            )
            .await
            .expect("acquire material-interest snapshot connection");

        let gdelt = snapshot.gdelt_context.expect("GDELT aggregates");
        assert_eq!(gdelt.cooperation_events, 1);
        assert_eq!(gdelt.conflict_events, 1);
        assert_eq!(gdelt.economic_events, 1);
        assert_eq!(gdelt.total_events, 4);
        assert_eq!(gdelt.avg_tone, Some(3.981));
        assert_eq!(gdelt.avg_goldstein, Some(5.25));

        let resources = snapshot.country_resources.expect("country resources");
        assert_eq!(
            resources
                .iter()
                .map(|resource| resource.country_code.as_str())
                .collect::<Vec<_>>(),
            ["CA", "US"]
        );
        assert_eq!(
            resources[0].natural_resources.0,
            json!(["Oil", "Copper", "Oil"])
        );
        assert_eq!(resources[0].top_exports.0, json!([]));
        assert_eq!(resources[0].economic_sectors.0, json!([]));

        assert_eq!(snapshot.trade_relationships.len(), 3);
        assert_eq!(
            snapshot
                .trade_relationships
                .iter()
                .map(|pair| (pair.exporter.as_str(), pair.importer.as_str()))
                .collect::<Vec<_>>(),
            [("us", "ca"), ("us", "mx"), ("ca", "mx")]
        );
        let us_to_ca = snapshot.trade_relationships[0]
            .data
            .as_ref()
            .expect("US-to-Canada trade");
        assert_eq!(us_to_ca.total_trade_value_usd, Some(210.0));
        assert_eq!(us_to_ca.product_count, 6);
        assert_eq!(us_to_ca.top_products.len(), 5);
        assert_eq!(us_to_ca.top_products[0].product_code, "P6");
        let empty_pair = snapshot.trade_relationships[1]
            .data
            .as_ref()
            .expect("empty US-to-Mexico trade");
        assert_eq!(empty_pair.total_trade_value_usd, None);
        assert_eq!(empty_pair.product_count, 0);
        assert!(empty_pair.top_products.is_empty());

        let commodity_context = snapshot.commodity_context.expect("commodity price context");
        assert_eq!(
            commodity_context
                .iter()
                .map(|commodity| commodity.commodity_name.as_str())
                .collect::<Vec<_>>(),
            ["Copper", "Oil"]
        );
        let oil = commodity_context
            .iter()
            .find(|commodity| commodity.commodity_name == "Oil")
            .expect("Oil trend");
        assert_eq!(oil.latest_price_usd, Some(20.0));
        assert_eq!(oil.trend_pct_6mo, Some(100.0));
        assert_eq!(oil.data_points, 2);

        let owner = snapshot
            .source_owner_interests
            .expect("source owner interests");
        let organization = owner.organization.expect("source organization");
        assert_eq!(organization.name, "Example News");
        assert_eq!(organization.parent_org_id, Some(42));
        assert_eq!(organization.funding_sources.0, json!([]));
        assert_eq!(organization.major_advertisers.0, json!(["Sponsor"]));
        assert_eq!(owner.analysis_scores.len(), 2);

        let country_only = database
            .wiki_country_resources(&["ca".to_owned()])
            .await
            .expect("country-only resource query");
        assert_eq!(country_only.len(), 1);
        assert_eq!(country_only[0].country_code, "CA");

        let payload = json!({"analysis_summary": "first"});
        let first_created_at = date(2025, 7, 1);
        let second_payload = json!({"analysis_summary": "second"});
        let second_created_at = date(2025, 7, 2);
        database
            .wiki_save_material_interest_analysis(
                "material_example_1",
                "Example News",
                payload.clone(),
                first_created_at,
            )
            .await
            .expect("persist first analysis");
        database
            .wiki_save_material_interest_analysis(
                "material_example_1",
                "Example News",
                second_payload.clone(),
                second_created_at,
            )
            .await
            .expect("append second analysis for same URL");
        let persisted = sqlx::query(
            "SELECT article_url, source_name, analysis_json, created_at \
             FROM material_interest_analyses ORDER BY id",
        )
        .fetch_all(&pool)
        .await
        .expect("read material-interest history");
        assert_eq!(persisted.len(), 2);
        assert_eq!(
            persisted[0].get::<String, _>("article_url"),
            "material_example_1"
        );
        assert_eq!(persisted[0].get::<String, _>("source_name"), "Example News");
        assert_eq!(
            persisted[0].get::<Json<Value>, _>("analysis_json").0,
            payload
        );
        assert_eq!(
            persisted[0].get::<NaiveDateTime, _>("created_at"),
            first_created_at
        );
        assert_eq!(
            persisted[1].get::<String, _>("article_url"),
            "material_example_1"
        );
        assert_eq!(persisted[1].get::<String, _>("source_name"), "Example News");
        assert_eq!(
            persisted[1].get::<Json<Value>, _>("analysis_json").0,
            second_payload
        );
        assert_eq!(
            persisted[1].get::<NaiveDateTime, _>("created_at"),
            second_created_at
        );

        sqlx::query("DROP TABLE trade_flows")
            .execute(&pool)
            .await
            .expect("drop only trade source");
        let partial = database
            .wiki_material_interest_snapshot(
                &countries,
                "Example News",
                3,
                commodity_cutoff,
                gdelt_cutoff,
            )
            .await
            .expect("acquire material-interest snapshot connection");
        assert!(partial.gdelt_context.is_ok());
        assert!(partial.country_resources.is_ok());
        assert!(partial.commodity_context.is_ok());
        assert!(partial.source_owner_interests.is_ok());
        assert!(partial
            .trade_relationships
            .iter()
            .all(|pair| pair.data.is_err()));

        sqlx::query("DROP TABLE commodity_prices")
            .execute(&pool)
            .await
            .expect("drop only commodity source");
        let partial = database
            .wiki_material_interest_snapshot(
                &countries,
                "Example News",
                3,
                commodity_cutoff,
                gdelt_cutoff,
            )
            .await
            .expect("acquire material-interest snapshot connection");
        assert!(partial.gdelt_context.is_ok());
        assert!(partial.country_resources.is_ok());
        assert!(partial.commodity_context.is_err());
        assert!(partial.source_owner_interests.is_ok());
    }

    #[sqlx::test(migrations = false)]
    async fn material_interest_snapshot_propagates_pool_acquisition_failure(pool: PgPool) {
        pool.close().await;
        let database = Database { pool };
        let result = database
            .wiki_material_interest_snapshot(
                &[],
                "Example News",
                10,
                date(2025, 1, 1),
                date(2025, 1, 1),
            )
            .await;
        assert!(matches!(result, Err(sqlx::Error::PoolClosed)));
    }
}
