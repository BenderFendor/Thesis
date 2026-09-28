use serde_json::{json, Value};
use thesis_api::entity_research::{
    EntityResearchCache, EntityResearchError, EntityResearchFuture, OrganizationResearchResponse,
    ReporterProfileResponse, SourceResearchResponse,
};
use thesis_db::{
    Database, WikiOrganizationResearchRecord, WikiOrganizationWriteRecord,
    WikiReporterProfileWriteRecord, WikiReporterResearchRecord,
};

use super::source_cache::SourceProfileFileCache;

pub(super) struct DatabaseEntityResearchCache {
    database: Database,
    source_cache: SourceProfileFileCache,
}

impl DatabaseEntityResearchCache {
    pub(super) fn new(database: Database) -> Self {
        Self {
            database,
            source_cache: SourceProfileFileCache::from_env(),
        }
    }
}

impl EntityResearchCache for DatabaseEntityResearchCache {
    fn reporter_by_resolver_key(
        &self,
        resolver_key: String,
    ) -> EntityResearchFuture<Option<ReporterProfileResponse>> {
        let database = self.database.clone();
        Box::pin(async move {
            database
                .reporter_by_resolver_key(&resolver_key)
                .await
                .map(|record| record.map(reporter_response))
                .map_err(|error| database_error("reporter lookup", error))
        })
    }

    fn reporter_by_id(
        &self,
        reporter_id: i64,
    ) -> EntityResearchFuture<Option<ReporterProfileResponse>> {
        let database = self.database.clone();
        Box::pin(async move {
            database
                .reporter_by_id(reporter_id)
                .await
                .map(|record| record.map(reporter_response))
                .map_err(|error| database_error("reporter lookup by id", error))
        })
    }

    fn list_reporters(
        &self,
        limit: i64,
        offset: i64,
    ) -> EntityResearchFuture<Vec<ReporterProfileResponse>> {
        let database = self.database.clone();
        Box::pin(async move {
            database
                .list_reporters(limit, offset)
                .await
                .map(|records| records.into_iter().map(reporter_response).collect())
                .map_err(|error| database_error("reporter listing", error))
        })
    }

    fn save_reporter(
        &self,
        resolver_key: String,
        mut response: ReporterProfileResponse,
    ) -> EntityResearchFuture<ReporterProfileResponse> {
        let database = self.database.clone();
        Box::pin(async move {
            let input = reporter_write_record(resolver_key, &response);
            let reporter_id = database
                .save_reporter(&input)
                .await
                .map_err(|error| database_error("reporter save", error))?;
            response.id = Some(reporter_id);
            response.cached = false;
            Ok(response)
        })
    }

    fn organization_by_normalized_name(
        &self,
        normalized_name: String,
    ) -> EntityResearchFuture<Option<OrganizationResearchResponse>> {
        let database = self.database.clone();
        Box::pin(async move {
            database
                .organization_by_normalized_name(&normalized_name)
                .await
                .map(|record| record.map(organization_response))
                .map_err(|error| database_error("organization lookup", error))
        })
    }

    fn organization_by_id(
        &self,
        organization_id: i64,
    ) -> EntityResearchFuture<Option<OrganizationResearchResponse>> {
        let database = self.database.clone();
        Box::pin(async move {
            database
                .organization_by_id(organization_id)
                .await
                .map(|record| record.map(organization_response))
                .map_err(|error| database_error("organization lookup by id", error))
        })
    }

    fn list_organizations(
        &self,
        limit: i64,
        offset: i64,
    ) -> EntityResearchFuture<Vec<OrganizationResearchResponse>> {
        let database = self.database.clone();
        Box::pin(async move {
            database
                .list_organizations(limit, offset)
                .await
                .map(|records| records.into_iter().map(organization_response).collect())
                .map_err(|error| database_error("organization listing", error))
        })
    }

    fn save_organization(
        &self,
        normalized_name: String,
        mut response: OrganizationResearchResponse,
    ) -> EntityResearchFuture<OrganizationResearchResponse> {
        let database = self.database.clone();
        Box::pin(async move {
            let input = organization_write_record(normalized_name, &response);
            response.id = database
                .save_organization(&input)
                .await
                .map_err(|error| database_error("organization save", error))?;
            response.cached = false;
            Ok(response)
        })
    }

    fn source_by_name(
        &self,
        source_name: String,
    ) -> EntityResearchFuture<Option<SourceResearchResponse>> {
        let cache = self.source_cache.clone();
        Box::pin(async move { Ok(cache.load(&source_name)) })
    }

    fn save_source(&self, response: SourceResearchResponse) -> EntityResearchFuture<()> {
        let cache = self.source_cache.clone();
        Box::pin(async move {
            cache.save(&response);
            Ok(())
        })
    }
}

fn reporter_response(record: WikiReporterResearchRecord) -> ReporterProfileResponse {
    ReporterProfileResponse {
        id: Some(record.id),
        redirected_from_id: record.redirected_from_id,
        name: record.name,
        normalized_name: record.normalized_name,
        bio: record.bio,
        career_history: json_value(record.career_history.map(|value| value.0)),
        topics: record.topics,
        education: json_value(record.education.map(|value| value.0)),
        political_leaning: record.political_leaning,
        leaning_confidence: record.leaning_confidence,
        twitter_handle: record.twitter_handle,
        leaning_sources: json_value(record.leaning_sources.map(|value| value.0)),
        linkedin_url: record.linkedin_url,
        wikipedia_url: record.wikipedia_url,
        wikidata_qid: record.wikidata_qid,
        wikidata_url: record.wikidata_url,
        canonical_name: record.canonical_name,
        match_status: record.match_status,
        overview: record.overview,
        dossier_sections: json_value(record.dossier_sections.map(|value| value.0)),
        citations: json_value(record.citations.map(|value| value.0)),
        search_links: json_value(record.search_links.map(|value| value.0)),
        match_explanation: record.match_explanation,
        research_sources: json_value(record.research_sources.map(|value| value.0)),
        research_confidence: record.research_confidence,
        cached: true,
    }
}

fn reporter_write_record(
    resolver_key: String,
    response: &ReporterProfileResponse,
) -> WikiReporterProfileWriteRecord {
    WikiReporterProfileWriteRecord {
        name: response.name.clone(),
        normalized_name: response.normalized_name.clone(),
        resolver_key: Some(resolver_key),
        raw_name: Some(response.name.clone()),
        bio: response.bio.clone(),
        career_history: json_option(&response.career_history),
        topics: response.topics.clone().unwrap_or_default(),
        education: json_option(&response.education),
        political_leaning: response.political_leaning.clone(),
        leaning_confidence: response.leaning_confidence.clone(),
        leaning_sources: json_option(&response.leaning_sources),
        twitter_handle: response.twitter_handle.clone(),
        linkedin_url: response.linkedin_url.clone(),
        wikipedia_url: response.wikipedia_url.clone(),
        wikidata_qid: response.wikidata_qid.clone(),
        wikidata_url: response.wikidata_url.clone(),
        canonical_name: response.canonical_name.clone(),
        match_status: response.match_status.clone(),
        overview: response.overview.clone(),
        dossier_sections: json_option(&response.dossier_sections),
        citations: json_option(&response.citations),
        search_links: json_option(&response.search_links),
        match_explanation: response.match_explanation.clone(),
        research_sources: json_option(&response.research_sources),
        research_confidence: response.research_confidence.clone(),
        littlesis_url: None,
        article_count: None,
        last_article_at: None,
        canonical_author_url: None,
        author_page_url: None,
        confidence_tier: None,
        confidence_score: None,
        claims_count: None,
        institutional_affiliations: None,
    }
}

fn organization_response(record: WikiOrganizationResearchRecord) -> OrganizationResearchResponse {
    let parent_orgs: Vec<String> =
        json_value(record.parent_orgs.map(|value| value.0)).unwrap_or_default();
    OrganizationResearchResponse {
        id: Some(record.id),
        name: record.name,
        normalized_name: record.normalized_name,
        org_type: record.org_type,
        parent_org: record.parent_org.or_else(|| parent_orgs.first().cloned()),
        ownership_percentage: record.ownership_percentage,
        funding_type: record.funding_type,
        funding_sources: json_value(record.funding_sources.map(|value| value.0))
            .unwrap_or_default(),
        major_advertisers: json_value(record.major_advertisers.map(|value| value.0))
            .unwrap_or_default(),
        ein: record.ein,
        annual_revenue: record.annual_revenue,
        top_donors: json_value(record.top_donors.map(|value| value.0)).unwrap_or_default(),
        media_bias_rating: record.media_bias_rating,
        factual_reporting: record.factual_reporting,
        wikipedia_url: record.wikipedia_url,
        website: record.website,
        owned_by: json_value(record.owned_by.map(|value| value.0)).unwrap_or_default(),
        parent_orgs,
        part_of: json_value(record.part_of.map(|value| value.0)).unwrap_or_default(),
        subsidiaries: json_value(record.subsidiaries.map(|value| value.0)).unwrap_or_default(),
        headquarters: json_value(record.headquarters.map(|value| value.0)).unwrap_or_default(),
        inception: record.inception,
        official_website: record.official_website,
        cik: record.cik,
        conflict_flags: json_value(record.conflict_flags.map(|value| value.0)).unwrap_or_default(),
        research_sources: json_value(record.research_sources.map(|value| value.0)),
        research_confidence: record.research_confidence,
        cached: true,
    }
}

fn organization_write_record(
    normalized_name: String,
    response: &OrganizationResearchResponse,
) -> WikiOrganizationWriteRecord {
    WikiOrganizationWriteRecord {
        name: response.name.clone(),
        normalized_name,
        org_type: response.org_type.clone(),
        ownership_percentage: response.ownership_percentage.clone(),
        funding_type: response.funding_type.clone(),
        funding_sources: Some(json!(response.funding_sources)),
        major_advertisers: Some(json!(response.major_advertisers)),
        ein: response.ein.clone(),
        annual_revenue: response.annual_revenue.clone(),
        top_donors: Some(json!(response.top_donors)),
        media_bias_rating: response.media_bias_rating.clone(),
        factual_reporting: response.factual_reporting.clone(),
        website: response.website.clone(),
        wikipedia_url: response.wikipedia_url.clone(),
        research_sources: json_option(&response.research_sources),
        research_confidence: response.research_confidence.clone(),
        owned_by: Some(json!(response.owned_by)),
        parent_orgs: Some(json!(response.parent_orgs)),
        part_of: Some(json!(response.part_of)),
        subsidiaries: Some(json!(response.subsidiaries)),
        headquarters: Some(json!(response.headquarters)),
        inception: response.inception.clone(),
        official_website: response.official_website.clone(),
        cik: response.cik.clone(),
        opensecrets_data: None,
        conflict_flags: Some(json!(response.conflict_flags)),
        parent_org: response.parent_org.clone(),
        parent_org_id: None,
    }
}

fn json_option<T: serde::Serialize>(value: &Option<T>) -> Option<Value> {
    value
        .as_ref()
        .and_then(|value| serde_json::to_value(value).ok())
}

fn json_value<T: serde::de::DeserializeOwned>(value: Option<Value>) -> Option<T> {
    value.and_then(|value| serde_json::from_value(value).ok())
}

fn database_error(operation: &'static str, error: sqlx::Error) -> EntityResearchError {
    tracing::error!(operation, error = %error, "entity research database operation failed");
    EntityResearchError::Failed("Entity research cache operation failed".to_owned())
}

#[cfg(test)]
mod tests {
    use super::{organization_response, reporter_response};
    use serde_json::json;
    use sqlx::types::Json;
    use thesis_db::{WikiOrganizationResearchRecord, WikiReporterResearchRecord};

    #[test]
    fn cache_projections_preserve_database_identity_and_json_values() {
        let reporter = reporter_response(WikiReporterResearchRecord {
            id: 17,
            redirected_from_id: Some(11),
            name: "Jane Doe".to_owned(),
            normalized_name: Some("jane doe".to_owned()),
            bio: Some("Reporter bio".to_owned()),
            career_history: Some(Json(json!([{"organization":"Reuters"}]))),
            topics: Some(vec!["politics".to_owned()]),
            education: None,
            political_leaning: None,
            leaning_confidence: None,
            leaning_sources: None,
            twitter_handle: None,
            linkedin_url: None,
            wikipedia_url: None,
            wikidata_qid: None,
            wikidata_url: None,
            canonical_name: None,
            resolver_key: None,
            match_status: Some("matched".to_owned()),
            overview: None,
            dossier_sections: None,
            citations: None,
            search_links: None,
            match_explanation: None,
            research_sources: None,
            research_confidence: None,
        });
        assert_eq!(reporter.id, Some(17));
        assert_eq!(reporter.redirected_from_id, Some(11));
        assert_eq!(
            reporter.career_history.unwrap()[0]["organization"],
            "Reuters"
        );
        assert!(reporter.cached);

        let organization = organization_response(WikiOrganizationResearchRecord {
            id: 23,
            name: "Reuters".to_owned(),
            normalized_name: Some("reuters".to_owned()),
            org_type: None,
            parent_org_id: None,
            parent_org: None,
            ownership_percentage: None,
            funding_type: Some("commercial".to_owned()),
            funding_sources: Some(Json(json!(["advertising"]))),
            major_advertisers: None,
            ein: None,
            annual_revenue: None,
            top_donors: None,
            media_bias_rating: None,
            factual_reporting: None,
            website: None,
            wikipedia_url: None,
            owned_by: None,
            parent_orgs: Some(Json(json!(["Thomson Reuters"]))),
            part_of: None,
            subsidiaries: None,
            headquarters: None,
            inception: None,
            official_website: None,
            cik: None,
            opensecrets_data: None,
            conflict_flags: None,
            research_sources: None,
            research_confidence: None,
        });
        assert_eq!(organization.id, Some(23));
        assert_eq!(organization.parent_org.as_deref(), Some("Thomson Reuters"));
        assert_eq!(organization.funding_sources, ["advertising"]);
        assert!(organization.cached);
    }
}
