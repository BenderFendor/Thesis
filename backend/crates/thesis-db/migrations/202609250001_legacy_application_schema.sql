-- Complete Python ORM schema baseline (2026-07-22 Alembic handoff).
SET LOCAL search_path TO public;

-- adjudication_items


CREATE TABLE IF NOT EXISTS adjudication_items (
	id VARCHAR(64) NOT NULL, 
	item_type VARCHAR(64) NOT NULL, 
	claim_ids JSON NOT NULL, 
	entity_ids JSON NOT NULL, 
	normalized_dimensions JSON NOT NULL, 
	reason TEXT NOT NULL, 
	status VARCHAR(32) NOT NULL, 
	assigned_to VARCHAR(255), 
	resolution JSON, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	resolved_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id)
);
-- article_authors


CREATE TABLE IF NOT EXISTS article_authors (
	id SERIAL NOT NULL, 
	article_id INTEGER NOT NULL, 
	reporter_id INTEGER NOT NULL, 
	author_role VARCHAR, 
	author_confidence FLOAT, 
	observation_source VARCHAR, 
	author_url_raw VARCHAR, 
	created_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id)
);
-- article_edges


CREATE TABLE IF NOT EXISTS article_edges (
	id SERIAL NOT NULL, 
	story_cluster_id INTEGER NOT NULL, 
	from_article_id INTEGER NOT NULL, 
	to_article_id INTEGER NOT NULL, 
	relation VARCHAR NOT NULL, 
	evidence JSON, 
	confidence FLOAT, 
	created_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id)
);
-- articles


CREATE TABLE IF NOT EXISTS articles (
	id SERIAL NOT NULL, 
	title TEXT NOT NULL, 
	source VARCHAR NOT NULL, 
	source_id VARCHAR, 
	country VARCHAR, 
	credibility VARCHAR, 
	bias VARCHAR, 
	summary TEXT, 
	content TEXT, 
	image_url VARCHAR, 
	published_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	category VARCHAR, 
	url VARCHAR NOT NULL, 
	author VARCHAR, 
	authors VARCHAR[], 
	author_urls VARCHAR[], 
	tags VARCHAR[], 
	mentioned_countries TEXT[], 
	original_language VARCHAR, 
	translated BOOLEAN, 
	paywall_status VARCHAR, 
	chroma_id VARCHAR, 
	embedding_generated BOOLEAN, 
	created_at TIMESTAMP WITHOUT TIME ZONE, 
	updated_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id), 
	UNIQUE (chroma_id)
);
-- bookmarks


CREATE TABLE IF NOT EXISTS bookmarks (
	id SERIAL NOT NULL, 
	article_id INTEGER NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id), 
	UNIQUE (article_id)
);
-- claim_edges


CREATE TABLE IF NOT EXISTS claim_edges (
	id SERIAL NOT NULL, 
	story_cluster_id INTEGER NOT NULL, 
	from_claim_id INTEGER NOT NULL, 
	to_claim_id INTEGER NOT NULL, 
	relation VARCHAR NOT NULL, 
	evidence JSON, 
	confidence FLOAT, 
	created_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id)
);
-- commodity_prices


CREATE TABLE IF NOT EXISTS commodity_prices (
	id SERIAL NOT NULL, 
	commodity_name VARCHAR NOT NULL, 
	price_usd FLOAT, 
	date TIMESTAMP WITHOUT TIME ZONE, 
	source VARCHAR, 
	PRIMARY KEY (id)
);
-- corpus_coverage_windows


CREATE TABLE IF NOT EXISTS corpus_coverage_windows (
	id VARCHAR(64) NOT NULL, 
	window_start TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	window_end TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	expected_sources INTEGER NOT NULL, 
	observed_sources INTEGER NOT NULL, 
	feed_uptime JSON NOT NULL, 
	paywall_losses JSON NOT NULL, 
	language_distribution JSON NOT NULL, 
	source_gaps JSON NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT ck_corpus_coverage_window CHECK (window_end >= window_start)
);
-- corrections


CREATE TABLE IF NOT EXISTS corrections (
	id SERIAL NOT NULL, 
	source VARCHAR NOT NULL, 
	article_id INTEGER, 
	correction_url VARCHAR, 
	correction_text TEXT NOT NULL, 
	corrected_claim_id INTEGER, 
	downstream_article_ids JSON, 
	published_at TIMESTAMP WITHOUT TIME ZONE, 
	created_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id)
);
-- country_resources


CREATE TABLE IF NOT EXISTS country_resources (
	country_code VARCHAR NOT NULL, 
	natural_resources JSON, 
	top_exports JSON, 
	top_imports JSON, 
	economic_sectors JSON, 
	last_updated TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (country_code)
);
-- event_clusters


CREATE TABLE IF NOT EXISTS event_clusters (
	id SERIAL NOT NULL, 
	cluster_label VARCHAR NOT NULL, 
	cluster_hash VARCHAR NOT NULL, 
	event_count INTEGER, 
	source_count INTEGER, 
	mean_tone FLOAT, 
	tone_stddev FLOAT, 
	mean_goldstein FLOAT, 
	goldstein_stddev FLOAT, 
	dominant_cameo_root VARCHAR, 
	country_count INTEGER, 
	first_seen_at TIMESTAMP WITHOUT TIME ZONE, 
	last_seen_at TIMESTAMP WITHOUT TIME ZONE, 
	created_at TIMESTAMP WITHOUT TIME ZONE, 
	updated_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id)
);
-- evidence_entities


CREATE TABLE IF NOT EXISTS evidence_entities (
	id VARCHAR(64) NOT NULL, 
	record_kind VARCHAR(64) NOT NULL, 
	entity_kind VARCHAR(64) NOT NULL, 
	canonical_name TEXT NOT NULL, 
	status VARCHAR(32) NOT NULL, 
	privacy_scope VARCHAR(32) NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT ck_evidence_entities_record_kind CHECK (record_kind IN ('person','legal_entity','organization_without_legal_identity','publication','digital_property','feed','article','raw_byline')), 
	CONSTRAINT ck_evidence_entities_status CHECK (status IN ('candidate','accepted','rejected','merged'))
);
-- evidence_ingest_runs


CREATE TABLE IF NOT EXISTS evidence_ingest_runs (
	id VARCHAR(64) NOT NULL, 
	adapter VARCHAR(64) NOT NULL, 
	adapter_version VARCHAR(64) NOT NULL, 
	scope JSON NOT NULL, 
	started_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	completed_at TIMESTAMP WITHOUT TIME ZONE, 
	status VARCHAR(32) NOT NULL, 
	network_mode VARCHAR(32) NOT NULL, 
	documents_count INTEGER NOT NULL, 
	snapshots_count INTEGER NOT NULL, 
	observations_count INTEGER NOT NULL, 
	claims_count INTEGER NOT NULL, 
	accepted_count INTEGER NOT NULL, 
	candidate_count INTEGER NOT NULL, 
	failure TEXT, 
	retryable BOOLEAN NOT NULL, 
	missing_credentials JSON NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT ck_evidence_ingest_runs_status CHECK (status IN ('running','success','partial','failed','blocked','skipped')), 
	CONSTRAINT ck_evidence_ingest_runs_network_mode CHECK (network_mode IN ('live','offline','disabled'))
);
-- extracted_claims


CREATE TABLE IF NOT EXISTS extracted_claims (
	id SERIAL NOT NULL, 
	story_cluster_id INTEGER NOT NULL, 
	article_id INTEGER NOT NULL, 
	claim_text TEXT NOT NULL, 
	normalized_claim TEXT NOT NULL, 
	claim_hash VARCHAR NOT NULL, 
	claim_type VARCHAR, 
	checkability VARCHAR, 
	evidence_span TEXT, 
	entities JSON, 
	numbers JSON, 
	extracted_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id)
);
-- gdelt_events


CREATE TABLE IF NOT EXISTS gdelt_events (
	id SERIAL NOT NULL, 
	gdelt_id VARCHAR NOT NULL, 
	url VARCHAR, 
	title VARCHAR, 
	source VARCHAR, 
	published_at TIMESTAMP WITHOUT TIME ZONE, 
	event_code VARCHAR, 
	event_root_code VARCHAR, 
	actor1_name VARCHAR, 
	actor1_country VARCHAR, 
	actor2_name VARCHAR, 
	actor2_country VARCHAR, 
	tone FLOAT, 
	goldstein_scale FLOAT, 
	article_id INTEGER, 
	matched_at TIMESTAMP WITHOUT TIME ZONE, 
	match_method VARCHAR, 
	similarity_score FLOAT, 
	gdelt_event_cluster_id INTEGER, 
	raw_data JSON, 
	created_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id)
);
-- highlights


CREATE TABLE IF NOT EXISTS highlights (
	id SERIAL NOT NULL, 
	user_id INTEGER, 
	article_url VARCHAR NOT NULL, 
	highlighted_text TEXT NOT NULL, 
	color VARCHAR, 
	note TEXT, 
	character_start INTEGER NOT NULL, 
	character_end INTEGER NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE, 
	updated_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id)
);
-- liked_articles


CREATE TABLE IF NOT EXISTS liked_articles (
	id SERIAL NOT NULL, 
	article_id INTEGER NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id), 
	UNIQUE (article_id)
);
-- material_interest_analyses


CREATE TABLE IF NOT EXISTS material_interest_analyses (
	id SERIAL NOT NULL, 
	article_url VARCHAR NOT NULL, 
	source_name VARCHAR NOT NULL, 
	analysis_json JSON NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id)
);
-- organizations


CREATE TABLE IF NOT EXISTS organizations (
	id SERIAL NOT NULL, 
	name VARCHAR NOT NULL, 
	normalized_name VARCHAR, 
	org_type VARCHAR, 
	parent_org_id INTEGER, 
	ownership_percentage VARCHAR, 
	funding_type VARCHAR, 
	funding_sources JSON, 
	major_advertisers JSON, 
	ein VARCHAR, 
	annual_revenue VARCHAR, 
	top_donors JSON, 
	media_bias_rating VARCHAR, 
	factual_reporting VARCHAR, 
	website VARCHAR, 
	wikipedia_url VARCHAR, 
	littlesis_url VARCHAR, 
	opensecrets_url VARCHAR, 
	research_sources JSON, 
	last_researched_at TIMESTAMP WITHOUT TIME ZONE, 
	research_confidence VARCHAR, 
	owned_by JSON, 
	parent_orgs JSON, 
	part_of JSON, 
	subsidiaries JSON, 
	headquarters JSON, 
	inception VARCHAR, 
	official_website VARCHAR, 
	cik VARCHAR, 
	opensecrets_data JSON, 
	conflict_flags JSON, 
	created_at TIMESTAMP WITHOUT TIME ZONE, 
	updated_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id)
);
-- preferences


CREATE TABLE IF NOT EXISTS preferences (
	id SERIAL NOT NULL, 
	key VARCHAR NOT NULL, 
	value TEXT NOT NULL, 
	updated_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id), 
	UNIQUE (key)
);
-- preregistrations


CREATE TABLE IF NOT EXISTS preregistrations (
	id VARCHAR(64) NOT NULL, 
	title TEXT NOT NULL, 
	canonical_hash VARCHAR(64) NOT NULL, 
	external_service VARCHAR(32) NOT NULL, 
	external_identifier VARCHAR(255) NOT NULL, 
	doi VARCHAR(255), 
	deposited_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	locked_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	specification JSON NOT NULL, 
	deviations JSON NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id)
);
-- proof_runs


CREATE TABLE IF NOT EXISTS proof_runs (
	id VARCHAR(64) NOT NULL, 
	case_id VARCHAR(64) NOT NULL, 
	commit_sha VARCHAR(64) NOT NULL, 
	dataset_snapshot VARCHAR(64) NOT NULL, 
	status VARCHAR(32) NOT NULL, 
	manifest JSON NOT NULL, 
	started_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	completed_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id)
);
-- reading_queue


CREATE TABLE IF NOT EXISTS reading_queue (
	id SERIAL NOT NULL, 
	user_id INTEGER, 
	article_id INTEGER NOT NULL, 
	article_title TEXT NOT NULL, 
	article_url VARCHAR NOT NULL, 
	article_source VARCHAR NOT NULL, 
	article_image VARCHAR, 
	queue_type VARCHAR, 
	position INTEGER, 
	read_status VARCHAR, 
	added_at TIMESTAMP WITHOUT TIME ZONE, 
	archived_at TIMESTAMP WITHOUT TIME ZONE, 
	created_at TIMESTAMP WITHOUT TIME ZONE, 
	updated_at TIMESTAMP WITHOUT TIME ZONE, 
	word_count INTEGER, 
	estimated_read_time_minutes INTEGER, 
	full_text TEXT, 
	why_saved TEXT, 
	unresolved_question TEXT, 
	shelf_id INTEGER, 
	PRIMARY KEY (id), 
	UNIQUE (article_url)
);
-- reading_shelves


CREATE TABLE IF NOT EXISTS reading_shelves (
	id SERIAL NOT NULL, 
	user_id INTEGER, 
	name VARCHAR NOT NULL, 
	description TEXT, 
	created_at TIMESTAMP WITHOUT TIME ZONE, 
	updated_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id)
);
-- reporters


CREATE TABLE IF NOT EXISTS reporters (
	id SERIAL NOT NULL, 
	name VARCHAR NOT NULL, 
	normalized_name VARCHAR, 
	raw_name TEXT, 
	merged_into INTEGER, 
	retirement_reason VARCHAR, 
	split_into JSON, 
	is_collective BOOLEAN NOT NULL, 
	bio TEXT, 
	career_history JSON, 
	topics VARCHAR[], 
	education JSON, 
	political_leaning VARCHAR, 
	leaning_confidence VARCHAR, 
	leaning_sources JSON, 
	twitter_handle VARCHAR, 
	linkedin_url VARCHAR, 
	wikipedia_url VARCHAR, 
	wikidata_qid VARCHAR, 
	wikidata_url VARCHAR, 
	canonical_name VARCHAR, 
	resolver_key VARCHAR, 
	match_status VARCHAR, 
	overview TEXT, 
	dossier_sections JSON, 
	citations JSON, 
	search_links JSON, 
	match_explanation TEXT, 
	source_patterns JSON, 
	topics_avoided JSON, 
	advertiser_alignment JSON, 
	revolving_door JSON, 
	controversies JSON, 
	institutional_affiliations JSON, 
	coverage_comparison JSON, 
	article_count INTEGER, 
	last_article_at TIMESTAMP WITHOUT TIME ZONE, 
	littlesis_url VARCHAR, 
	research_sources JSON, 
	last_researched_at TIMESTAMP WITHOUT TIME ZONE, 
	research_confidence VARCHAR, 
	canonical_author_url VARCHAR, 
	author_page_url VARCHAR, 
	confidence_tier VARCHAR, 
	confidence_score FLOAT, 
	claims_count INTEGER, 
	created_at TIMESTAMP WITHOUT TIME ZONE, 
	updated_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id), 
	FOREIGN KEY(merged_into) REFERENCES reporters (id) ON DELETE SET NULL
);
-- search_history


CREATE TABLE IF NOT EXISTS search_history (
	id SERIAL NOT NULL, 
	query TEXT NOT NULL, 
	search_type VARCHAR, 
	results_count INTEGER, 
	created_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id)
);
-- source_analysis_scores


CREATE TABLE IF NOT EXISTS source_analysis_scores (
	id SERIAL NOT NULL, 
	source_name VARCHAR NOT NULL, 
	axis_name VARCHAR NOT NULL, 
	score INTEGER NOT NULL, 
	confidence VARCHAR, 
	prose_explanation TEXT, 
	citations JSON, 
	empirical_basis TEXT, 
	scored_by VARCHAR, 
	last_scored_at TIMESTAMP WITHOUT TIME ZONE, 
	signals_available INTEGER, 
	signals_missing INTEGER, 
	data_confidence FLOAT, 
	created_at TIMESTAMP WITHOUT TIME ZONE, 
	updated_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id)
);
-- source_claims


CREATE TABLE IF NOT EXISTS source_claims (
	id SERIAL NOT NULL, 
	source_name VARCHAR NOT NULL, 
	claim_type VARCHAR NOT NULL, 
	claim_value JSON NOT NULL, 
	claim_kind VARCHAR NOT NULL, 
	confidence FLOAT, 
	parser_version VARCHAR NOT NULL, 
	is_current BOOLEAN, 
	valid_from TIMESTAMP WITHOUT TIME ZONE, 
	valid_to TIMESTAMP WITHOUT TIME ZONE, 
	created_at TIMESTAMP WITHOUT TIME ZONE, 
	updated_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id)
);
-- source_coverage_stats


CREATE TABLE IF NOT EXISTS source_coverage_stats (
	id SERIAL NOT NULL, 
	source_name VARCHAR NOT NULL, 
	date TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	article_count INTEGER, 
	article_count_by_category JSON, 
	topics_covered INTEGER, 
	cluster_ids JSON, 
	countries_mentioned JSON, 
	country_count INTEGER, 
	vs_avg_ratio FLOAT, 
	coverage_percentile FLOAT, 
	created_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id)
);
-- source_credibility


CREATE TABLE IF NOT EXISTS source_credibility (
	id SERIAL NOT NULL, 
	domain VARCHAR NOT NULL, 
	credibility_score FLOAT NOT NULL, 
	source_type VARCHAR, 
	is_active BOOLEAN, 
	notes TEXT, 
	created_at TIMESTAMP WITHOUT TIME ZONE, 
	updated_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id)
);
-- source_metadata


CREATE TABLE IF NOT EXISTS source_metadata (
	id SERIAL NOT NULL, 
	source_name VARCHAR NOT NULL, 
	normalized_name VARCHAR, 
	domain VARCHAR, 
	country VARCHAR, 
	language VARCHAR, 
	timezone VARCHAR, 
	source_type VARCHAR, 
	is_state_media BOOLEAN, 
	is_paywalled BOOLEAN, 
	political_bias VARCHAR, 
	bias_confidence FLOAT, 
	factual_rating VARCHAR, 
	credibility_score FLOAT, 
	parent_company VARCHAR, 
	funding_type VARCHAR, 
	coverage_breadth VARCHAR, 
	geographic_focus VARCHAR[], 
	topic_focus VARCHAR[], 
	topics_covered INTEGER, 
	topics_blind_spots JSON, 
	coverage_timeline JSON, 
	last_analyzed_at TIMESTAMP WITHOUT TIME ZONE, 
	research_sources JSON, 
	research_confidence VARCHAR, 
	credibility_dimensions JSON, 
	credibility_last_scored_at TIMESTAMP WITHOUT TIME ZONE, 
	created_at TIMESTAMP WITHOUT TIME ZONE, 
	updated_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id)
);
-- story_clusters


CREATE TABLE IF NOT EXISTS story_clusters (
	id SERIAL NOT NULL, 
	external_cluster_id INTEGER NOT NULL, 
	label VARCHAR, 
	keywords JSON, 
	first_seen_at TIMESTAMP WITHOUT TIME ZONE, 
	last_seen_at TIMESTAMP WITHOUT TIME ZONE, 
	earliest_article_id INTEGER, 
	current_summary TEXT, 
	confidence FLOAT, 
	created_at TIMESTAMP WITHOUT TIME ZONE, 
	updated_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id)
);
-- topic_blind_spots


CREATE TABLE IF NOT EXISTS topic_blind_spots (
	id SERIAL NOT NULL, 
	cluster_id INTEGER NOT NULL, 
	cluster_label VARCHAR, 
	covering_sources JSON, 
	covering_count INTEGER, 
	blind_spot_sources JSON, 
	blind_spot_count INTEGER, 
	severity VARCHAR, 
	article_count_total INTEGER, 
	date_identified TIMESTAMP WITHOUT TIME ZONE, 
	last_updated TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id)
);
-- topic_cluster_snapshots


CREATE TABLE IF NOT EXISTS topic_cluster_snapshots (
	id SERIAL NOT NULL, 
	"window" VARCHAR(10) NOT NULL, 
	clusters_json JSON NOT NULL, 
	cluster_count INTEGER NOT NULL, 
	computed_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id)
);
-- trade_flows


CREATE TABLE IF NOT EXISTS trade_flows (
	id SERIAL NOT NULL, 
	exporter_country VARCHAR NOT NULL, 
	importer_country VARCHAR NOT NULL, 
	product_code VARCHAR NOT NULL, 
	product_name VARCHAR NOT NULL, 
	trade_value_usd FLOAT, 
	year INTEGER, 
	PRIMARY KEY (id)
);
-- verification_cache


CREATE TABLE IF NOT EXISTS verification_cache (
	id SERIAL NOT NULL, 
	claim_hash VARCHAR NOT NULL, 
	claim_text TEXT NOT NULL, 
	confidence FLOAT NOT NULL, 
	confidence_level VARCHAR NOT NULL, 
	sources_json JSON, 
	verified_at TIMESTAMP WITHOUT TIME ZONE, 
	expires_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id)
);
-- wiki_index_status


CREATE TABLE IF NOT EXISTS wiki_index_status (
	id SERIAL NOT NULL, 
	entity_type VARCHAR NOT NULL, 
	entity_name VARCHAR NOT NULL, 
	status VARCHAR, 
	error_message TEXT, 
	index_duration_ms INTEGER, 
	last_indexed_at TIMESTAMP WITHOUT TIME ZONE, 
	next_index_at TIMESTAMP WITHOUT TIME ZONE, 
	created_at TIMESTAMP WITHOUT TIME ZONE, 
	updated_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id)
);
-- accepted_relationships


CREATE TABLE IF NOT EXISTS accepted_relationships (
	id VARCHAR(64) NOT NULL, 
	subject_entity_id VARCHAR(64) NOT NULL, 
	predicate VARCHAR(96) NOT NULL, 
	object_entity_id VARCHAR(64) NOT NULL, 
	qualifiers JSON NOT NULL, 
	valid_from TIMESTAMP WITHOUT TIME ZONE, 
	valid_to TIMESTAMP WITHOUT TIME ZONE, 
	recorded_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	retracted_at TIMESTAMP WITHOUT TIME ZONE, 
	materialized_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	materialized_by VARCHAR(255), 
	acceptance_policy_version VARCHAR(64) NOT NULL, 
	status VARCHAR(32) NOT NULL, 
	lifecycle_state VARCHAR(32) NOT NULL, 
	relationship_hash VARCHAR(64) NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT ck_accepted_relationship_valid_range CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from), 
	CONSTRAINT ck_accepted_relationship_lifecycle_state CHECK (lifecycle_state IN ('current','historical','proposed','pending','disputed','rejected','superseded')), 
	FOREIGN KEY(subject_entity_id) REFERENCES evidence_entities (id) ON DELETE CASCADE, 
	FOREIGN KEY(object_entity_id) REFERENCES evidence_entities (id) ON DELETE CASCADE
);
-- entity_external_ids


CREATE TABLE IF NOT EXISTS entity_external_ids (
	id SERIAL NOT NULL, 
	entity_id VARCHAR(64) NOT NULL, 
	scheme VARCHAR(64) NOT NULL, 
	value VARCHAR(255) NOT NULL, 
	source_claim_id VARCHAR(64), 
	merge_authority VARCHAR(32) NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_entity_external_ids_scheme_value UNIQUE (scheme, value), 
	FOREIGN KEY(entity_id) REFERENCES evidence_entities (id) ON DELETE CASCADE
);
-- entity_resolutions


CREATE TABLE IF NOT EXISTS entity_resolutions (
	id VARCHAR(64) NOT NULL, 
	left_entity_id VARCHAR(64) NOT NULL, 
	right_entity_id VARCHAR(64) NOT NULL, 
	decision VARCHAR(64) NOT NULL, 
	status VARCHAR(32) NOT NULL, 
	basis_claim_id VARCHAR(64), 
	decided_by VARCHAR(255), 
	decided_at TIMESTAMP WITHOUT TIME ZONE, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT ck_entity_resolution_distinct CHECK (left_entity_id <> right_entity_id), 
	CONSTRAINT uq_entity_resolution_pair_decision UNIQUE (left_entity_id, right_entity_id, decision), 
	FOREIGN KEY(left_entity_id) REFERENCES evidence_entities (id) ON DELETE CASCADE, 
	FOREIGN KEY(right_entity_id) REFERENCES evidence_entities (id) ON DELETE CASCADE
);
-- evidence_claims


CREATE TABLE IF NOT EXISTS evidence_claims (
	id VARCHAR(64) NOT NULL, 
	subject_entity_id VARCHAR(64) NOT NULL, 
	predicate VARCHAR(96) NOT NULL, 
	object_entity_id VARCHAR(64), 
	object_value JSON, 
	qualifiers JSON NOT NULL, 
	valid_from TIMESTAMP WITHOUT TIME ZONE, 
	valid_to TIMESTAMP WITHOUT TIME ZONE, 
	date_precision VARCHAR(32), 
	recorded_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	retracted_at TIMESTAMP WITHOUT TIME ZONE, 
	asserted_by VARCHAR(255) NOT NULL, 
	evidence_class VARCHAR(64) NOT NULL, 
	status VARCHAR(32) NOT NULL, 
	superseded_by VARCHAR(64), 
	method_version VARCHAR(64) NOT NULL, 
	claim_hash VARCHAR(64) NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT ck_evidence_claim_object CHECK (object_entity_id IS NOT NULL OR object_value IS NOT NULL), 
	CONSTRAINT ck_evidence_claim_valid_range CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from), 
	FOREIGN KEY(subject_entity_id) REFERENCES evidence_entities (id) ON DELETE CASCADE, 
	FOREIGN KEY(object_entity_id) REFERENCES evidence_entities (id) ON DELETE SET NULL
);
-- evidence_documents


CREATE TABLE IF NOT EXISTS evidence_documents (
	id VARCHAR(64) NOT NULL, 
	source_url TEXT NOT NULL, 
	document_type VARCHAR(64) NOT NULL, 
	title TEXT, 
	issuer_entity_id VARCHAR(64), 
	published_at TIMESTAMP WITHOUT TIME ZONE, 
	jurisdiction VARCHAR(32), 
	source_class VARCHAR(64) NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(issuer_entity_id) REFERENCES evidence_entities (id) ON DELETE SET NULL
);
-- identity_edges


CREATE TABLE IF NOT EXISTS identity_edges (
	id SERIAL NOT NULL, 
	reporter_id INTEGER NOT NULL, 
	target_url VARCHAR NOT NULL, 
	edge_type VARCHAR NOT NULL, 
	source_url VARCHAR, 
	confidence FLOAT, 
	created_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id), 
	FOREIGN KEY(reporter_id) REFERENCES reporters (id) ON DELETE CASCADE
);
-- reporter_claims


CREATE TABLE IF NOT EXISTS reporter_claims (
	id SERIAL NOT NULL, 
	reporter_id INTEGER NOT NULL, 
	claim_type VARCHAR NOT NULL, 
	claim_value TEXT NOT NULL, 
	source_url TEXT, 
	source_type VARCHAR NOT NULL, 
	confidence FLOAT, 
	is_current BOOLEAN, 
	valid_from TIMESTAMP WITHOUT TIME ZONE, 
	valid_to TIMESTAMP WITHOUT TIME ZONE, 
	created_at TIMESTAMP WITHOUT TIME ZONE, 
	updated_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id), 
	FOREIGN KEY(reporter_id) REFERENCES reporters (id) ON DELETE CASCADE
);
-- source_claim_evidence


CREATE TABLE IF NOT EXISTS source_claim_evidence (
	id SERIAL NOT NULL, 
	claim_id INTEGER NOT NULL, 
	source_type VARCHAR NOT NULL, 
	source_name VARCHAR, 
	source_url VARCHAR NOT NULL, 
	retrieved_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	raw_excerpt TEXT, 
	raw_hash VARCHAR NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id), 
	FOREIGN KEY(claim_id) REFERENCES source_claims (id) ON DELETE CASCADE
);
-- calculation_traces


CREATE TABLE IF NOT EXISTS calculation_traces (
	id VARCHAR(64) NOT NULL, 
	relationship_id VARCHAR(64), 
	measurement_name VARCHAR(96) NOT NULL, 
	input_claim_ids JSON NOT NULL, 
	subgraph JSON NOT NULL, 
	algorithm_version VARCHAR(64) NOT NULL, 
	result JSON NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(relationship_id) REFERENCES accepted_relationships (id) ON DELETE SET NULL
);
-- document_snapshots


CREATE TABLE IF NOT EXISTS document_snapshots (
	id VARCHAR(64) NOT NULL, 
	document_id VARCHAR(64) NOT NULL, 
	sha256_raw VARCHAR(64) NOT NULL, 
	storage_path TEXT NOT NULL, 
	retrieved_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	http_status INTEGER, 
	content_type VARCHAR(255), 
	charset VARCHAR(64), 
	sha256_canonical_text VARCHAR(64), 
	extracted_text_path TEXT, 
	extraction_tool VARCHAR(128), 
	extraction_version VARCHAR(64), 
	ocr_confidence FLOAT, 
	language VARCHAR(32), 
	retriever VARCHAR(128) NOT NULL, 
	retriever_version VARCHAR(64) NOT NULL, 
	response_headers JSON NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(document_id) REFERENCES evidence_documents (id) ON DELETE CASCADE
);
-- external_material_events


CREATE TABLE IF NOT EXISTS external_material_events (
	id VARCHAR(64) NOT NULL, 
	registry VARCHAR(64) NOT NULL, 
	external_id VARCHAR(255) NOT NULL, 
	event_type VARCHAR(96) NOT NULL, 
	subject_entity_id VARCHAR(64), 
	occurred_at TIMESTAMP WITHOUT TIME ZONE, 
	announced_at TIMESTAMP WITHOUT TIME ZONE, 
	completed_at TIMESTAMP WITHOUT TIME ZONE, 
	status VARCHAR(32) NOT NULL, 
	coverage_independence VARCHAR(32) NOT NULL, 
	source_claim_id VARCHAR(64), 
	event_metadata JSON NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_external_event_registry_id UNIQUE (registry, external_id), 
	FOREIGN KEY(subject_entity_id) REFERENCES evidence_entities (id) ON DELETE SET NULL, 
	FOREIGN KEY(source_claim_id) REFERENCES evidence_claims (id) ON DELETE SET NULL
);
-- relationship_claim_links


CREATE TABLE IF NOT EXISTS relationship_claim_links (
	relationship_id VARCHAR(64) NOT NULL, 
	claim_id VARCHAR(64) NOT NULL, 
	derivation_role VARCHAR(32) NOT NULL, 
	added_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (relationship_id, claim_id), 
	FOREIGN KEY(relationship_id) REFERENCES accepted_relationships (id) ON DELETE CASCADE, 
	FOREIGN KEY(claim_id) REFERENCES evidence_claims (id) ON DELETE RESTRICT
);
-- source_lineage


CREATE TABLE IF NOT EXISTS source_lineage (
	id SERIAL NOT NULL, 
	parent_document_id VARCHAR(64) NOT NULL, 
	child_document_id VARCHAR(64) NOT NULL, 
	relation VARCHAR(32) NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT ck_source_lineage_distinct CHECK (parent_document_id <> child_document_id), 
	CONSTRAINT uq_source_lineage_edge UNIQUE (parent_document_id, child_document_id, relation), 
	FOREIGN KEY(parent_document_id) REFERENCES evidence_documents (id) ON DELETE CASCADE, 
	FOREIGN KEY(child_document_id) REFERENCES evidence_documents (id) ON DELETE CASCADE
);
-- archive_requests


CREATE TABLE IF NOT EXISTS archive_requests (
	id SERIAL NOT NULL, 
	snapshot_id VARCHAR(64) NOT NULL, 
	service VARCHAR(64) NOT NULL, 
	requested_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	result_url TEXT, 
	status VARCHAR(32) NOT NULL, 
	error TEXT, 
	PRIMARY KEY (id), 
	FOREIGN KEY(snapshot_id) REFERENCES document_snapshots (id) ON DELETE CASCADE
);
-- evidence_observations


CREATE TABLE IF NOT EXISTS evidence_observations (
	id VARCHAR(64) NOT NULL, 
	snapshot_id VARCHAR(64) NOT NULL, 
	locator JSON NOT NULL, 
	quoted_text TEXT, 
	context_before TEXT, 
	context_after TEXT, 
	structured_value JSON, 
	canonical_text_hash VARCHAR(64), 
	extractor VARCHAR(128) NOT NULL, 
	extractor_version VARCHAR(64) NOT NULL, 
	ocr_confidence FLOAT, 
	entailment VARCHAR(32) NOT NULL, 
	reviewed_by VARCHAR(255), 
	reviewed_at TIMESTAMP WITHOUT TIME ZONE, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT ck_evidence_observation_content CHECK (quoted_text IS NOT NULL OR structured_value IS NOT NULL), 
	CONSTRAINT ck_evidence_observation_reviewed_yes_has_reviewer CHECK (entailment != 'reviewed_yes' OR reviewed_by IS NOT NULL), 
	FOREIGN KEY(snapshot_id) REFERENCES document_snapshots (id) ON DELETE CASCADE
);
-- measurement_validation_cards


CREATE TABLE IF NOT EXISTS measurement_validation_cards (
	id VARCHAR(64) NOT NULL, 
	measurement_name VARCHAR(96) NOT NULL, 
	version VARCHAR(64) NOT NULL, 
	annotation_guide_uri TEXT NOT NULL, 
	gold_set_snapshot_id VARCHAR(64) NOT NULL, 
	metrics JSON NOT NULL, 
	error_examples JSON NOT NULL, 
	parser_stability JSON NOT NULL, 
	extraction_sensitivity JSON NOT NULL, 
	active BOOLEAN NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_measurement_validation_name_version UNIQUE (measurement_name, version), 
	FOREIGN KEY(gold_set_snapshot_id) REFERENCES document_snapshots (id) ON DELETE RESTRICT
);
-- claim_evidence_links


CREATE TABLE IF NOT EXISTS claim_evidence_links (
	claim_id VARCHAR(64) NOT NULL, 
	observation_id VARCHAR(64) NOT NULL, 
	role VARCHAR(32) NOT NULL, 
	reviewer VARCHAR(255), 
	reviewed_at TIMESTAMP WITHOUT TIME ZONE, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (claim_id, observation_id), 
	FOREIGN KEY(claim_id) REFERENCES evidence_claims (id) ON DELETE CASCADE, 
	FOREIGN KEY(observation_id) REFERENCES evidence_observations (id) ON DELETE CASCADE
);

-- Match the prior Python bootstrap behavior for missing columns on non-evidence tables.
ALTER TABLE "article_authors" ADD COLUMN IF NOT EXISTS "id" INTEGER;
ALTER TABLE "article_authors" ADD COLUMN IF NOT EXISTS "article_id" INTEGER;
ALTER TABLE "article_authors" ADD COLUMN IF NOT EXISTS "reporter_id" INTEGER;
ALTER TABLE "article_authors" ADD COLUMN IF NOT EXISTS "author_role" VARCHAR;
ALTER TABLE "article_authors" ADD COLUMN IF NOT EXISTS "author_confidence" FLOAT;
ALTER TABLE "article_authors" ADD COLUMN IF NOT EXISTS "observation_source" VARCHAR;
ALTER TABLE "article_authors" ADD COLUMN IF NOT EXISTS "author_url_raw" VARCHAR;
ALTER TABLE "article_authors" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "article_edges" ADD COLUMN IF NOT EXISTS "id" INTEGER;
ALTER TABLE "article_edges" ADD COLUMN IF NOT EXISTS "story_cluster_id" INTEGER;
ALTER TABLE "article_edges" ADD COLUMN IF NOT EXISTS "from_article_id" INTEGER;
ALTER TABLE "article_edges" ADD COLUMN IF NOT EXISTS "to_article_id" INTEGER;
ALTER TABLE "article_edges" ADD COLUMN IF NOT EXISTS "relation" VARCHAR;
ALTER TABLE "article_edges" ADD COLUMN IF NOT EXISTS "evidence" JSON;
ALTER TABLE "article_edges" ADD COLUMN IF NOT EXISTS "confidence" FLOAT;
ALTER TABLE "article_edges" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "id" INTEGER;
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "title" TEXT;
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "source" VARCHAR;
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "source_id" VARCHAR;
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "country" VARCHAR;
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "credibility" VARCHAR;
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "bias" VARCHAR;
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "summary" TEXT;
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "content" TEXT;
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "image_url" VARCHAR;
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "published_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "category" VARCHAR;
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "url" VARCHAR;
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "author" VARCHAR;
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "authors" VARCHAR[];
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "author_urls" VARCHAR[];
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "tags" VARCHAR[];
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "mentioned_countries" TEXT[];
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "original_language" VARCHAR;
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "translated" BOOLEAN;
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "paywall_status" VARCHAR;
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "chroma_id" VARCHAR;
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "embedding_generated" BOOLEAN;
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "bookmarks" ADD COLUMN IF NOT EXISTS "id" INTEGER;
ALTER TABLE "bookmarks" ADD COLUMN IF NOT EXISTS "article_id" INTEGER;
ALTER TABLE "bookmarks" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "claim_edges" ADD COLUMN IF NOT EXISTS "id" INTEGER;
ALTER TABLE "claim_edges" ADD COLUMN IF NOT EXISTS "story_cluster_id" INTEGER;
ALTER TABLE "claim_edges" ADD COLUMN IF NOT EXISTS "from_claim_id" INTEGER;
ALTER TABLE "claim_edges" ADD COLUMN IF NOT EXISTS "to_claim_id" INTEGER;
ALTER TABLE "claim_edges" ADD COLUMN IF NOT EXISTS "relation" VARCHAR;
ALTER TABLE "claim_edges" ADD COLUMN IF NOT EXISTS "evidence" JSON;
ALTER TABLE "claim_edges" ADD COLUMN IF NOT EXISTS "confidence" FLOAT;
ALTER TABLE "claim_edges" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "commodity_prices" ADD COLUMN IF NOT EXISTS "id" INTEGER;
ALTER TABLE "commodity_prices" ADD COLUMN IF NOT EXISTS "commodity_name" VARCHAR;
ALTER TABLE "commodity_prices" ADD COLUMN IF NOT EXISTS "price_usd" FLOAT;
ALTER TABLE "commodity_prices" ADD COLUMN IF NOT EXISTS "date" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "commodity_prices" ADD COLUMN IF NOT EXISTS "source" VARCHAR;
ALTER TABLE "corrections" ADD COLUMN IF NOT EXISTS "id" INTEGER;
ALTER TABLE "corrections" ADD COLUMN IF NOT EXISTS "source" VARCHAR;
ALTER TABLE "corrections" ADD COLUMN IF NOT EXISTS "article_id" INTEGER;
ALTER TABLE "corrections" ADD COLUMN IF NOT EXISTS "correction_url" VARCHAR;
ALTER TABLE "corrections" ADD COLUMN IF NOT EXISTS "correction_text" TEXT;
ALTER TABLE "corrections" ADD COLUMN IF NOT EXISTS "corrected_claim_id" INTEGER;
ALTER TABLE "corrections" ADD COLUMN IF NOT EXISTS "downstream_article_ids" JSON;
ALTER TABLE "corrections" ADD COLUMN IF NOT EXISTS "published_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "corrections" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "country_resources" ADD COLUMN IF NOT EXISTS "country_code" VARCHAR;
ALTER TABLE "country_resources" ADD COLUMN IF NOT EXISTS "natural_resources" JSON;
ALTER TABLE "country_resources" ADD COLUMN IF NOT EXISTS "top_exports" JSON;
ALTER TABLE "country_resources" ADD COLUMN IF NOT EXISTS "top_imports" JSON;
ALTER TABLE "country_resources" ADD COLUMN IF NOT EXISTS "economic_sectors" JSON;
ALTER TABLE "country_resources" ADD COLUMN IF NOT EXISTS "last_updated" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "event_clusters" ADD COLUMN IF NOT EXISTS "id" INTEGER;
ALTER TABLE "event_clusters" ADD COLUMN IF NOT EXISTS "cluster_label" VARCHAR;
ALTER TABLE "event_clusters" ADD COLUMN IF NOT EXISTS "cluster_hash" VARCHAR;
ALTER TABLE "event_clusters" ADD COLUMN IF NOT EXISTS "event_count" INTEGER;
ALTER TABLE "event_clusters" ADD COLUMN IF NOT EXISTS "source_count" INTEGER;
ALTER TABLE "event_clusters" ADD COLUMN IF NOT EXISTS "mean_tone" FLOAT;
ALTER TABLE "event_clusters" ADD COLUMN IF NOT EXISTS "tone_stddev" FLOAT;
ALTER TABLE "event_clusters" ADD COLUMN IF NOT EXISTS "mean_goldstein" FLOAT;
ALTER TABLE "event_clusters" ADD COLUMN IF NOT EXISTS "goldstein_stddev" FLOAT;
ALTER TABLE "event_clusters" ADD COLUMN IF NOT EXISTS "dominant_cameo_root" VARCHAR;
ALTER TABLE "event_clusters" ADD COLUMN IF NOT EXISTS "country_count" INTEGER;
ALTER TABLE "event_clusters" ADD COLUMN IF NOT EXISTS "first_seen_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "event_clusters" ADD COLUMN IF NOT EXISTS "last_seen_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "event_clusters" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "event_clusters" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "extracted_claims" ADD COLUMN IF NOT EXISTS "id" INTEGER;
ALTER TABLE "extracted_claims" ADD COLUMN IF NOT EXISTS "story_cluster_id" INTEGER;
ALTER TABLE "extracted_claims" ADD COLUMN IF NOT EXISTS "article_id" INTEGER;
ALTER TABLE "extracted_claims" ADD COLUMN IF NOT EXISTS "claim_text" TEXT;
ALTER TABLE "extracted_claims" ADD COLUMN IF NOT EXISTS "normalized_claim" TEXT;
ALTER TABLE "extracted_claims" ADD COLUMN IF NOT EXISTS "claim_hash" VARCHAR;
ALTER TABLE "extracted_claims" ADD COLUMN IF NOT EXISTS "claim_type" VARCHAR;
ALTER TABLE "extracted_claims" ADD COLUMN IF NOT EXISTS "checkability" VARCHAR;
ALTER TABLE "extracted_claims" ADD COLUMN IF NOT EXISTS "evidence_span" TEXT;
ALTER TABLE "extracted_claims" ADD COLUMN IF NOT EXISTS "entities" JSON;
ALTER TABLE "extracted_claims" ADD COLUMN IF NOT EXISTS "numbers" JSON;
ALTER TABLE "extracted_claims" ADD COLUMN IF NOT EXISTS "extracted_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "gdelt_events" ADD COLUMN IF NOT EXISTS "id" INTEGER;
ALTER TABLE "gdelt_events" ADD COLUMN IF NOT EXISTS "gdelt_id" VARCHAR;
ALTER TABLE "gdelt_events" ADD COLUMN IF NOT EXISTS "url" VARCHAR;
ALTER TABLE "gdelt_events" ADD COLUMN IF NOT EXISTS "title" VARCHAR;
ALTER TABLE "gdelt_events" ADD COLUMN IF NOT EXISTS "source" VARCHAR;
ALTER TABLE "gdelt_events" ADD COLUMN IF NOT EXISTS "published_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "gdelt_events" ADD COLUMN IF NOT EXISTS "event_code" VARCHAR;
ALTER TABLE "gdelt_events" ADD COLUMN IF NOT EXISTS "event_root_code" VARCHAR;
ALTER TABLE "gdelt_events" ADD COLUMN IF NOT EXISTS "actor1_name" VARCHAR;
ALTER TABLE "gdelt_events" ADD COLUMN IF NOT EXISTS "actor1_country" VARCHAR;
ALTER TABLE "gdelt_events" ADD COLUMN IF NOT EXISTS "actor2_name" VARCHAR;
ALTER TABLE "gdelt_events" ADD COLUMN IF NOT EXISTS "actor2_country" VARCHAR;
ALTER TABLE "gdelt_events" ADD COLUMN IF NOT EXISTS "tone" FLOAT;
ALTER TABLE "gdelt_events" ADD COLUMN IF NOT EXISTS "goldstein_scale" FLOAT;
ALTER TABLE "gdelt_events" ADD COLUMN IF NOT EXISTS "article_id" INTEGER;
ALTER TABLE "gdelt_events" ADD COLUMN IF NOT EXISTS "matched_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "gdelt_events" ADD COLUMN IF NOT EXISTS "match_method" VARCHAR;
ALTER TABLE "gdelt_events" ADD COLUMN IF NOT EXISTS "similarity_score" FLOAT;
ALTER TABLE "gdelt_events" ADD COLUMN IF NOT EXISTS "gdelt_event_cluster_id" INTEGER;
ALTER TABLE "gdelt_events" ADD COLUMN IF NOT EXISTS "raw_data" JSON;
ALTER TABLE "gdelt_events" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "highlights" ADD COLUMN IF NOT EXISTS "id" INTEGER;
ALTER TABLE "highlights" ADD COLUMN IF NOT EXISTS "user_id" INTEGER;
ALTER TABLE "highlights" ADD COLUMN IF NOT EXISTS "article_url" VARCHAR;
ALTER TABLE "highlights" ADD COLUMN IF NOT EXISTS "highlighted_text" TEXT;
ALTER TABLE "highlights" ADD COLUMN IF NOT EXISTS "color" VARCHAR;
ALTER TABLE "highlights" ADD COLUMN IF NOT EXISTS "note" TEXT;
ALTER TABLE "highlights" ADD COLUMN IF NOT EXISTS "character_start" INTEGER;
ALTER TABLE "highlights" ADD COLUMN IF NOT EXISTS "character_end" INTEGER;
ALTER TABLE "highlights" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "highlights" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "liked_articles" ADD COLUMN IF NOT EXISTS "id" INTEGER;
ALTER TABLE "liked_articles" ADD COLUMN IF NOT EXISTS "article_id" INTEGER;
ALTER TABLE "liked_articles" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "material_interest_analyses" ADD COLUMN IF NOT EXISTS "id" INTEGER;
ALTER TABLE "material_interest_analyses" ADD COLUMN IF NOT EXISTS "article_url" VARCHAR;
ALTER TABLE "material_interest_analyses" ADD COLUMN IF NOT EXISTS "source_name" VARCHAR;
ALTER TABLE "material_interest_analyses" ADD COLUMN IF NOT EXISTS "analysis_json" JSON;
ALTER TABLE "material_interest_analyses" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "id" INTEGER;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "name" VARCHAR;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "normalized_name" VARCHAR;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "org_type" VARCHAR;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "parent_org_id" INTEGER;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "ownership_percentage" VARCHAR;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "funding_type" VARCHAR;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "funding_sources" JSON;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "major_advertisers" JSON;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "ein" VARCHAR;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "annual_revenue" VARCHAR;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "top_donors" JSON;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "media_bias_rating" VARCHAR;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "factual_reporting" VARCHAR;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "website" VARCHAR;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "wikipedia_url" VARCHAR;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "littlesis_url" VARCHAR;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "opensecrets_url" VARCHAR;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "research_sources" JSON;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "last_researched_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "research_confidence" VARCHAR;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "owned_by" JSON;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "parent_orgs" JSON;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "part_of" JSON;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "subsidiaries" JSON;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "headquarters" JSON;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "inception" VARCHAR;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "official_website" VARCHAR;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "cik" VARCHAR;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "opensecrets_data" JSON;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "conflict_flags" JSON;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "preferences" ADD COLUMN IF NOT EXISTS "id" INTEGER;
ALTER TABLE "preferences" ADD COLUMN IF NOT EXISTS "key" VARCHAR;
ALTER TABLE "preferences" ADD COLUMN IF NOT EXISTS "value" TEXT;
ALTER TABLE "preferences" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "reading_queue" ADD COLUMN IF NOT EXISTS "id" INTEGER;
ALTER TABLE "reading_queue" ADD COLUMN IF NOT EXISTS "user_id" INTEGER;
ALTER TABLE "reading_queue" ADD COLUMN IF NOT EXISTS "article_id" INTEGER;
ALTER TABLE "reading_queue" ADD COLUMN IF NOT EXISTS "article_title" TEXT;
ALTER TABLE "reading_queue" ADD COLUMN IF NOT EXISTS "article_url" VARCHAR;
ALTER TABLE "reading_queue" ADD COLUMN IF NOT EXISTS "article_source" VARCHAR;
ALTER TABLE "reading_queue" ADD COLUMN IF NOT EXISTS "article_image" VARCHAR;
ALTER TABLE "reading_queue" ADD COLUMN IF NOT EXISTS "queue_type" VARCHAR;
ALTER TABLE "reading_queue" ADD COLUMN IF NOT EXISTS "position" INTEGER;
ALTER TABLE "reading_queue" ADD COLUMN IF NOT EXISTS "read_status" VARCHAR;
ALTER TABLE "reading_queue" ADD COLUMN IF NOT EXISTS "added_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "reading_queue" ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "reading_queue" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "reading_queue" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "reading_queue" ADD COLUMN IF NOT EXISTS "word_count" INTEGER;
ALTER TABLE "reading_queue" ADD COLUMN IF NOT EXISTS "estimated_read_time_minutes" INTEGER;
ALTER TABLE "reading_queue" ADD COLUMN IF NOT EXISTS "full_text" TEXT;
ALTER TABLE "reading_queue" ADD COLUMN IF NOT EXISTS "why_saved" TEXT;
ALTER TABLE "reading_queue" ADD COLUMN IF NOT EXISTS "unresolved_question" TEXT;
ALTER TABLE "reading_queue" ADD COLUMN IF NOT EXISTS "shelf_id" INTEGER;
ALTER TABLE "reading_shelves" ADD COLUMN IF NOT EXISTS "id" INTEGER;
ALTER TABLE "reading_shelves" ADD COLUMN IF NOT EXISTS "user_id" INTEGER;
ALTER TABLE "reading_shelves" ADD COLUMN IF NOT EXISTS "name" VARCHAR;
ALTER TABLE "reading_shelves" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "reading_shelves" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "reading_shelves" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "reporters" ADD COLUMN IF NOT EXISTS "id" INTEGER;
ALTER TABLE "reporters" ADD COLUMN IF NOT EXISTS "name" VARCHAR;
ALTER TABLE "reporters" ADD COLUMN IF NOT EXISTS "normalized_name" VARCHAR;
ALTER TABLE "reporters" ADD COLUMN IF NOT EXISTS "raw_name" TEXT;
ALTER TABLE "reporters" ADD COLUMN IF NOT EXISTS "merged_into" INTEGER;
ALTER TABLE "reporters" ADD COLUMN IF NOT EXISTS "retirement_reason" VARCHAR;
ALTER TABLE "reporters" ADD COLUMN IF NOT EXISTS "split_into" JSON;
ALTER TABLE "reporters" ADD COLUMN IF NOT EXISTS "is_collective" BOOLEAN;
ALTER TABLE "reporters" ADD COLUMN IF NOT EXISTS "bio" TEXT;
ALTER TABLE "reporters" ADD COLUMN IF NOT EXISTS "career_history" JSON;
ALTER TABLE "reporters" ADD COLUMN IF NOT EXISTS "topics" VARCHAR[];
ALTER TABLE "reporters" ADD COLUMN IF NOT EXISTS "education" JSON;
ALTER TABLE "reporters" ADD COLUMN IF NOT EXISTS "political_leaning" VARCHAR;
ALTER TABLE "reporters" ADD COLUMN IF NOT EXISTS "leaning_confidence" VARCHAR;
ALTER TABLE "reporters" ADD COLUMN IF NOT EXISTS "leaning_sources" JSON;
ALTER TABLE "reporters" ADD COLUMN IF NOT EXISTS "twitter_handle" VARCHAR;
ALTER TABLE "reporters" ADD COLUMN IF NOT EXISTS "linkedin_url" VARCHAR;
ALTER TABLE "reporters" ADD COLUMN IF NOT EXISTS "wikipedia_url" VARCHAR;
ALTER TABLE "reporters" ADD COLUMN IF NOT EXISTS "wikidata_qid" VARCHAR;
ALTER TABLE "reporters" ADD COLUMN IF NOT EXISTS "wikidata_url" VARCHAR;
ALTER TABLE "reporters" ADD COLUMN IF NOT EXISTS "canonical_name" VARCHAR;
ALTER TABLE "reporters" ADD COLUMN IF NOT EXISTS "resolver_key" VARCHAR;
ALTER TABLE "reporters" ADD COLUMN IF NOT EXISTS "match_status" VARCHAR;
ALTER TABLE "reporters" ADD COLUMN IF NOT EXISTS "overview" TEXT;
ALTER TABLE "reporters" ADD COLUMN IF NOT EXISTS "dossier_sections" JSON;
ALTER TABLE "reporters" ADD COLUMN IF NOT EXISTS "citations" JSON;
ALTER TABLE "reporters" ADD COLUMN IF NOT EXISTS "search_links" JSON;
ALTER TABLE "reporters" ADD COLUMN IF NOT EXISTS "match_explanation" TEXT;
ALTER TABLE "reporters" ADD COLUMN IF NOT EXISTS "source_patterns" JSON;
ALTER TABLE "reporters" ADD COLUMN IF NOT EXISTS "topics_avoided" JSON;
ALTER TABLE "reporters" ADD COLUMN IF NOT EXISTS "advertiser_alignment" JSON;
ALTER TABLE "reporters" ADD COLUMN IF NOT EXISTS "revolving_door" JSON;
ALTER TABLE "reporters" ADD COLUMN IF NOT EXISTS "controversies" JSON;
ALTER TABLE "reporters" ADD COLUMN IF NOT EXISTS "institutional_affiliations" JSON;
ALTER TABLE "reporters" ADD COLUMN IF NOT EXISTS "coverage_comparison" JSON;
ALTER TABLE "reporters" ADD COLUMN IF NOT EXISTS "article_count" INTEGER;
ALTER TABLE "reporters" ADD COLUMN IF NOT EXISTS "last_article_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "reporters" ADD COLUMN IF NOT EXISTS "littlesis_url" VARCHAR;
ALTER TABLE "reporters" ADD COLUMN IF NOT EXISTS "research_sources" JSON;
ALTER TABLE "reporters" ADD COLUMN IF NOT EXISTS "last_researched_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "reporters" ADD COLUMN IF NOT EXISTS "research_confidence" VARCHAR;
ALTER TABLE "reporters" ADD COLUMN IF NOT EXISTS "canonical_author_url" VARCHAR;
ALTER TABLE "reporters" ADD COLUMN IF NOT EXISTS "author_page_url" VARCHAR;
ALTER TABLE "reporters" ADD COLUMN IF NOT EXISTS "confidence_tier" VARCHAR;
ALTER TABLE "reporters" ADD COLUMN IF NOT EXISTS "confidence_score" FLOAT;
ALTER TABLE "reporters" ADD COLUMN IF NOT EXISTS "claims_count" INTEGER;
ALTER TABLE "reporters" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "reporters" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "search_history" ADD COLUMN IF NOT EXISTS "id" INTEGER;
ALTER TABLE "search_history" ADD COLUMN IF NOT EXISTS "query" TEXT;
ALTER TABLE "search_history" ADD COLUMN IF NOT EXISTS "search_type" VARCHAR;
ALTER TABLE "search_history" ADD COLUMN IF NOT EXISTS "results_count" INTEGER;
ALTER TABLE "search_history" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "source_analysis_scores" ADD COLUMN IF NOT EXISTS "id" INTEGER;
ALTER TABLE "source_analysis_scores" ADD COLUMN IF NOT EXISTS "source_name" VARCHAR;
ALTER TABLE "source_analysis_scores" ADD COLUMN IF NOT EXISTS "axis_name" VARCHAR;
ALTER TABLE "source_analysis_scores" ADD COLUMN IF NOT EXISTS "score" INTEGER;
ALTER TABLE "source_analysis_scores" ADD COLUMN IF NOT EXISTS "confidence" VARCHAR;
ALTER TABLE "source_analysis_scores" ADD COLUMN IF NOT EXISTS "prose_explanation" TEXT;
ALTER TABLE "source_analysis_scores" ADD COLUMN IF NOT EXISTS "citations" JSON;
ALTER TABLE "source_analysis_scores" ADD COLUMN IF NOT EXISTS "empirical_basis" TEXT;
ALTER TABLE "source_analysis_scores" ADD COLUMN IF NOT EXISTS "scored_by" VARCHAR;
ALTER TABLE "source_analysis_scores" ADD COLUMN IF NOT EXISTS "last_scored_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "source_analysis_scores" ADD COLUMN IF NOT EXISTS "signals_available" INTEGER;
ALTER TABLE "source_analysis_scores" ADD COLUMN IF NOT EXISTS "signals_missing" INTEGER;
ALTER TABLE "source_analysis_scores" ADD COLUMN IF NOT EXISTS "data_confidence" FLOAT;
ALTER TABLE "source_analysis_scores" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "source_analysis_scores" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "source_claims" ADD COLUMN IF NOT EXISTS "id" INTEGER;
ALTER TABLE "source_claims" ADD COLUMN IF NOT EXISTS "source_name" VARCHAR;
ALTER TABLE "source_claims" ADD COLUMN IF NOT EXISTS "claim_type" VARCHAR;
ALTER TABLE "source_claims" ADD COLUMN IF NOT EXISTS "claim_value" JSON;
ALTER TABLE "source_claims" ADD COLUMN IF NOT EXISTS "claim_kind" VARCHAR;
ALTER TABLE "source_claims" ADD COLUMN IF NOT EXISTS "confidence" FLOAT;
ALTER TABLE "source_claims" ADD COLUMN IF NOT EXISTS "parser_version" VARCHAR;
ALTER TABLE "source_claims" ADD COLUMN IF NOT EXISTS "is_current" BOOLEAN;
ALTER TABLE "source_claims" ADD COLUMN IF NOT EXISTS "valid_from" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "source_claims" ADD COLUMN IF NOT EXISTS "valid_to" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "source_claims" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "source_claims" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "source_coverage_stats" ADD COLUMN IF NOT EXISTS "id" INTEGER;
ALTER TABLE "source_coverage_stats" ADD COLUMN IF NOT EXISTS "source_name" VARCHAR;
ALTER TABLE "source_coverage_stats" ADD COLUMN IF NOT EXISTS "date" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "source_coverage_stats" ADD COLUMN IF NOT EXISTS "article_count" INTEGER;
ALTER TABLE "source_coverage_stats" ADD COLUMN IF NOT EXISTS "article_count_by_category" JSON;
ALTER TABLE "source_coverage_stats" ADD COLUMN IF NOT EXISTS "topics_covered" INTEGER;
ALTER TABLE "source_coverage_stats" ADD COLUMN IF NOT EXISTS "cluster_ids" JSON;
ALTER TABLE "source_coverage_stats" ADD COLUMN IF NOT EXISTS "countries_mentioned" JSON;
ALTER TABLE "source_coverage_stats" ADD COLUMN IF NOT EXISTS "country_count" INTEGER;
ALTER TABLE "source_coverage_stats" ADD COLUMN IF NOT EXISTS "vs_avg_ratio" FLOAT;
ALTER TABLE "source_coverage_stats" ADD COLUMN IF NOT EXISTS "coverage_percentile" FLOAT;
ALTER TABLE "source_coverage_stats" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "source_credibility" ADD COLUMN IF NOT EXISTS "id" INTEGER;
ALTER TABLE "source_credibility" ADD COLUMN IF NOT EXISTS "domain" VARCHAR;
ALTER TABLE "source_credibility" ADD COLUMN IF NOT EXISTS "credibility_score" FLOAT;
ALTER TABLE "source_credibility" ADD COLUMN IF NOT EXISTS "source_type" VARCHAR;
ALTER TABLE "source_credibility" ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN;
ALTER TABLE "source_credibility" ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "source_credibility" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "source_credibility" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "source_metadata" ADD COLUMN IF NOT EXISTS "id" INTEGER;
ALTER TABLE "source_metadata" ADD COLUMN IF NOT EXISTS "source_name" VARCHAR;
ALTER TABLE "source_metadata" ADD COLUMN IF NOT EXISTS "normalized_name" VARCHAR;
ALTER TABLE "source_metadata" ADD COLUMN IF NOT EXISTS "domain" VARCHAR;
ALTER TABLE "source_metadata" ADD COLUMN IF NOT EXISTS "country" VARCHAR;
ALTER TABLE "source_metadata" ADD COLUMN IF NOT EXISTS "language" VARCHAR;
ALTER TABLE "source_metadata" ADD COLUMN IF NOT EXISTS "timezone" VARCHAR;
ALTER TABLE "source_metadata" ADD COLUMN IF NOT EXISTS "source_type" VARCHAR;
ALTER TABLE "source_metadata" ADD COLUMN IF NOT EXISTS "is_state_media" BOOLEAN;
ALTER TABLE "source_metadata" ADD COLUMN IF NOT EXISTS "is_paywalled" BOOLEAN;
ALTER TABLE "source_metadata" ADD COLUMN IF NOT EXISTS "political_bias" VARCHAR;
ALTER TABLE "source_metadata" ADD COLUMN IF NOT EXISTS "bias_confidence" FLOAT;
ALTER TABLE "source_metadata" ADD COLUMN IF NOT EXISTS "factual_rating" VARCHAR;
ALTER TABLE "source_metadata" ADD COLUMN IF NOT EXISTS "credibility_score" FLOAT;
ALTER TABLE "source_metadata" ADD COLUMN IF NOT EXISTS "parent_company" VARCHAR;
ALTER TABLE "source_metadata" ADD COLUMN IF NOT EXISTS "funding_type" VARCHAR;
ALTER TABLE "source_metadata" ADD COLUMN IF NOT EXISTS "coverage_breadth" VARCHAR;
ALTER TABLE "source_metadata" ADD COLUMN IF NOT EXISTS "geographic_focus" VARCHAR[];
ALTER TABLE "source_metadata" ADD COLUMN IF NOT EXISTS "topic_focus" VARCHAR[];
ALTER TABLE "source_metadata" ADD COLUMN IF NOT EXISTS "topics_covered" INTEGER;
ALTER TABLE "source_metadata" ADD COLUMN IF NOT EXISTS "topics_blind_spots" JSON;
ALTER TABLE "source_metadata" ADD COLUMN IF NOT EXISTS "coverage_timeline" JSON;
ALTER TABLE "source_metadata" ADD COLUMN IF NOT EXISTS "last_analyzed_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "source_metadata" ADD COLUMN IF NOT EXISTS "research_sources" JSON;
ALTER TABLE "source_metadata" ADD COLUMN IF NOT EXISTS "research_confidence" VARCHAR;
ALTER TABLE "source_metadata" ADD COLUMN IF NOT EXISTS "credibility_dimensions" JSON;
ALTER TABLE "source_metadata" ADD COLUMN IF NOT EXISTS "credibility_last_scored_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "source_metadata" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "source_metadata" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "story_clusters" ADD COLUMN IF NOT EXISTS "id" INTEGER;
ALTER TABLE "story_clusters" ADD COLUMN IF NOT EXISTS "external_cluster_id" INTEGER;
ALTER TABLE "story_clusters" ADD COLUMN IF NOT EXISTS "label" VARCHAR;
ALTER TABLE "story_clusters" ADD COLUMN IF NOT EXISTS "keywords" JSON;
ALTER TABLE "story_clusters" ADD COLUMN IF NOT EXISTS "first_seen_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "story_clusters" ADD COLUMN IF NOT EXISTS "last_seen_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "story_clusters" ADD COLUMN IF NOT EXISTS "earliest_article_id" INTEGER;
ALTER TABLE "story_clusters" ADD COLUMN IF NOT EXISTS "current_summary" TEXT;
ALTER TABLE "story_clusters" ADD COLUMN IF NOT EXISTS "confidence" FLOAT;
ALTER TABLE "story_clusters" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "story_clusters" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "topic_blind_spots" ADD COLUMN IF NOT EXISTS "id" INTEGER;
ALTER TABLE "topic_blind_spots" ADD COLUMN IF NOT EXISTS "cluster_id" INTEGER;
ALTER TABLE "topic_blind_spots" ADD COLUMN IF NOT EXISTS "cluster_label" VARCHAR;
ALTER TABLE "topic_blind_spots" ADD COLUMN IF NOT EXISTS "covering_sources" JSON;
ALTER TABLE "topic_blind_spots" ADD COLUMN IF NOT EXISTS "covering_count" INTEGER;
ALTER TABLE "topic_blind_spots" ADD COLUMN IF NOT EXISTS "blind_spot_sources" JSON;
ALTER TABLE "topic_blind_spots" ADD COLUMN IF NOT EXISTS "blind_spot_count" INTEGER;
ALTER TABLE "topic_blind_spots" ADD COLUMN IF NOT EXISTS "severity" VARCHAR;
ALTER TABLE "topic_blind_spots" ADD COLUMN IF NOT EXISTS "article_count_total" INTEGER;
ALTER TABLE "topic_blind_spots" ADD COLUMN IF NOT EXISTS "date_identified" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "topic_blind_spots" ADD COLUMN IF NOT EXISTS "last_updated" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "topic_cluster_snapshots" ADD COLUMN IF NOT EXISTS "id" INTEGER;
ALTER TABLE "topic_cluster_snapshots" ADD COLUMN IF NOT EXISTS "window" VARCHAR(10);
ALTER TABLE "topic_cluster_snapshots" ADD COLUMN IF NOT EXISTS "clusters_json" JSON;
ALTER TABLE "topic_cluster_snapshots" ADD COLUMN IF NOT EXISTS "cluster_count" INTEGER;
ALTER TABLE "topic_cluster_snapshots" ADD COLUMN IF NOT EXISTS "computed_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "trade_flows" ADD COLUMN IF NOT EXISTS "id" INTEGER;
ALTER TABLE "trade_flows" ADD COLUMN IF NOT EXISTS "exporter_country" VARCHAR;
ALTER TABLE "trade_flows" ADD COLUMN IF NOT EXISTS "importer_country" VARCHAR;
ALTER TABLE "trade_flows" ADD COLUMN IF NOT EXISTS "product_code" VARCHAR;
ALTER TABLE "trade_flows" ADD COLUMN IF NOT EXISTS "product_name" VARCHAR;
ALTER TABLE "trade_flows" ADD COLUMN IF NOT EXISTS "trade_value_usd" FLOAT;
ALTER TABLE "trade_flows" ADD COLUMN IF NOT EXISTS "year" INTEGER;
ALTER TABLE "verification_cache" ADD COLUMN IF NOT EXISTS "id" INTEGER;
ALTER TABLE "verification_cache" ADD COLUMN IF NOT EXISTS "claim_hash" VARCHAR;
ALTER TABLE "verification_cache" ADD COLUMN IF NOT EXISTS "claim_text" TEXT;
ALTER TABLE "verification_cache" ADD COLUMN IF NOT EXISTS "confidence" FLOAT;
ALTER TABLE "verification_cache" ADD COLUMN IF NOT EXISTS "confidence_level" VARCHAR;
ALTER TABLE "verification_cache" ADD COLUMN IF NOT EXISTS "sources_json" JSON;
ALTER TABLE "verification_cache" ADD COLUMN IF NOT EXISTS "verified_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "verification_cache" ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "wiki_index_status" ADD COLUMN IF NOT EXISTS "id" INTEGER;
ALTER TABLE "wiki_index_status" ADD COLUMN IF NOT EXISTS "entity_type" VARCHAR;
ALTER TABLE "wiki_index_status" ADD COLUMN IF NOT EXISTS "entity_name" VARCHAR;
ALTER TABLE "wiki_index_status" ADD COLUMN IF NOT EXISTS "status" VARCHAR;
ALTER TABLE "wiki_index_status" ADD COLUMN IF NOT EXISTS "error_message" TEXT;
ALTER TABLE "wiki_index_status" ADD COLUMN IF NOT EXISTS "index_duration_ms" INTEGER;
ALTER TABLE "wiki_index_status" ADD COLUMN IF NOT EXISTS "last_indexed_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "wiki_index_status" ADD COLUMN IF NOT EXISTS "next_index_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "wiki_index_status" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "wiki_index_status" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "identity_edges" ADD COLUMN IF NOT EXISTS "id" INTEGER;
ALTER TABLE "identity_edges" ADD COLUMN IF NOT EXISTS "reporter_id" INTEGER;
ALTER TABLE "identity_edges" ADD COLUMN IF NOT EXISTS "target_url" VARCHAR;
ALTER TABLE "identity_edges" ADD COLUMN IF NOT EXISTS "edge_type" VARCHAR;
ALTER TABLE "identity_edges" ADD COLUMN IF NOT EXISTS "source_url" VARCHAR;
ALTER TABLE "identity_edges" ADD COLUMN IF NOT EXISTS "confidence" FLOAT;
ALTER TABLE "identity_edges" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "reporter_claims" ADD COLUMN IF NOT EXISTS "id" INTEGER;
ALTER TABLE "reporter_claims" ADD COLUMN IF NOT EXISTS "reporter_id" INTEGER;
ALTER TABLE "reporter_claims" ADD COLUMN IF NOT EXISTS "claim_type" VARCHAR;
ALTER TABLE "reporter_claims" ADD COLUMN IF NOT EXISTS "claim_value" TEXT;
ALTER TABLE "reporter_claims" ADD COLUMN IF NOT EXISTS "source_url" TEXT;
ALTER TABLE "reporter_claims" ADD COLUMN IF NOT EXISTS "source_type" VARCHAR;
ALTER TABLE "reporter_claims" ADD COLUMN IF NOT EXISTS "confidence" FLOAT;
ALTER TABLE "reporter_claims" ADD COLUMN IF NOT EXISTS "is_current" BOOLEAN;
ALTER TABLE "reporter_claims" ADD COLUMN IF NOT EXISTS "valid_from" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "reporter_claims" ADD COLUMN IF NOT EXISTS "valid_to" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "reporter_claims" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "reporter_claims" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "source_claim_evidence" ADD COLUMN IF NOT EXISTS "id" INTEGER;
ALTER TABLE "source_claim_evidence" ADD COLUMN IF NOT EXISTS "claim_id" INTEGER;
ALTER TABLE "source_claim_evidence" ADD COLUMN IF NOT EXISTS "source_type" VARCHAR;
ALTER TABLE "source_claim_evidence" ADD COLUMN IF NOT EXISTS "source_name" VARCHAR;
ALTER TABLE "source_claim_evidence" ADD COLUMN IF NOT EXISTS "source_url" VARCHAR;
ALTER TABLE "source_claim_evidence" ADD COLUMN IF NOT EXISTS "retrieved_at" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "source_claim_evidence" ADD COLUMN IF NOT EXISTS "raw_excerpt" TEXT;
ALTER TABLE "source_claim_evidence" ADD COLUMN IF NOT EXISTS "raw_hash" VARCHAR;
ALTER TABLE "source_claim_evidence" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP WITHOUT TIME ZONE;

-- ORM indexes follow missing-column repair so old tables can be upgraded safely.
CREATE INDEX IF NOT EXISTS ix_adjudication_items_item_type ON adjudication_items (item_type);
CREATE INDEX IF NOT EXISTS ix_adjudication_items_status ON adjudication_items (status);
CREATE INDEX IF NOT EXISTS ix_article_authors_article_id ON article_authors (article_id);
CREATE UNIQUE INDEX IF NOT EXISTS ix_article_authors_article_reporter ON article_authors (article_id, reporter_id);
CREATE INDEX IF NOT EXISTS ix_article_authors_id ON article_authors (id);
CREATE INDEX IF NOT EXISTS ix_article_authors_reporter_id ON article_authors (reporter_id);
CREATE INDEX IF NOT EXISTS ix_article_edges_from_article_id ON article_edges (from_article_id);
CREATE INDEX IF NOT EXISTS ix_article_edges_id ON article_edges (id);
CREATE INDEX IF NOT EXISTS ix_article_edges_relation ON article_edges (relation);
CREATE INDEX IF NOT EXISTS ix_article_edges_story_cluster_id ON article_edges (story_cluster_id);
CREATE INDEX IF NOT EXISTS ix_article_edges_to_article_id ON article_edges (to_article_id);
CREATE UNIQUE INDEX IF NOT EXISTS ix_article_edges_unique_story_edge ON article_edges (story_cluster_id, from_article_id, to_article_id, relation);
CREATE INDEX IF NOT EXISTS ix_articles_category ON articles (category);
CREATE INDEX IF NOT EXISTS ix_articles_category_published ON articles (category, published_at DESC);
CREATE INDEX IF NOT EXISTS ix_articles_id ON articles (id);
CREATE INDEX IF NOT EXISTS ix_articles_mentioned_countries_gin ON articles USING gin (mentioned_countries);
CREATE INDEX IF NOT EXISTS ix_articles_paywall_status ON articles (paywall_status);
CREATE INDEX IF NOT EXISTS ix_articles_published_at ON articles (published_at);
CREATE INDEX IF NOT EXISTS ix_articles_published_at_id_desc ON articles (published_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_articles_source ON articles (source);
CREATE INDEX IF NOT EXISTS ix_articles_source_published ON articles (source, published_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ix_articles_url ON articles (url);
CREATE INDEX IF NOT EXISTS ix_bookmarks_id ON bookmarks (id);
CREATE INDEX IF NOT EXISTS ix_claim_edges_from_claim_id ON claim_edges (from_claim_id);
CREATE INDEX IF NOT EXISTS ix_claim_edges_id ON claim_edges (id);
CREATE INDEX IF NOT EXISTS ix_claim_edges_relation ON claim_edges (relation);
CREATE INDEX IF NOT EXISTS ix_claim_edges_story_cluster_id ON claim_edges (story_cluster_id);
CREATE INDEX IF NOT EXISTS ix_claim_edges_to_claim_id ON claim_edges (to_claim_id);
CREATE UNIQUE INDEX IF NOT EXISTS ix_claim_edges_unique_story_edge ON claim_edges (story_cluster_id, from_claim_id, to_claim_id, relation);
CREATE INDEX IF NOT EXISTS ix_commodity_prices_id ON commodity_prices (id);
CREATE INDEX IF NOT EXISTS ix_commodity_prices_name_date ON commodity_prices (commodity_name, date);
CREATE INDEX IF NOT EXISTS ix_corpus_coverage_windows_window_end ON corpus_coverage_windows (window_end);
CREATE INDEX IF NOT EXISTS ix_corpus_coverage_windows_window_start ON corpus_coverage_windows (window_start);
CREATE INDEX IF NOT EXISTS ix_corrections_article_id ON corrections (article_id);
CREATE INDEX IF NOT EXISTS ix_corrections_corrected_claim_id ON corrections (corrected_claim_id);
CREATE UNIQUE INDEX IF NOT EXISTS ix_corrections_correction_url ON corrections (correction_url);
CREATE INDEX IF NOT EXISTS ix_corrections_id ON corrections (id);
CREATE INDEX IF NOT EXISTS ix_corrections_source ON corrections (source);
CREATE INDEX IF NOT EXISTS ix_country_resources_country_code ON country_resources (country_code);
CREATE UNIQUE INDEX IF NOT EXISTS ix_event_clusters_cluster_hash ON event_clusters (cluster_hash);
CREATE INDEX IF NOT EXISTS ix_event_clusters_cluster_label ON event_clusters (cluster_label);
CREATE INDEX IF NOT EXISTS ix_event_clusters_first_seen ON event_clusters (first_seen_at);
CREATE INDEX IF NOT EXISTS ix_event_clusters_id ON event_clusters (id);
CREATE INDEX IF NOT EXISTS ix_event_clusters_last_seen ON event_clusters (last_seen_at);
CREATE INDEX IF NOT EXISTS ix_evidence_entities_canonical_name ON evidence_entities (canonical_name);
CREATE INDEX IF NOT EXISTS ix_evidence_entities_entity_kind ON evidence_entities (entity_kind);
CREATE INDEX IF NOT EXISTS ix_evidence_entities_record_kind ON evidence_entities (record_kind);
CREATE INDEX IF NOT EXISTS ix_evidence_entities_status ON evidence_entities (status);
CREATE INDEX IF NOT EXISTS ix_evidence_ingest_runs_adapter ON evidence_ingest_runs (adapter);
CREATE INDEX IF NOT EXISTS ix_evidence_ingest_runs_completed_at ON evidence_ingest_runs (completed_at);
CREATE INDEX IF NOT EXISTS ix_evidence_ingest_runs_started_at ON evidence_ingest_runs (started_at);
CREATE INDEX IF NOT EXISTS ix_evidence_ingest_runs_status ON evidence_ingest_runs (status);
CREATE UNIQUE INDEX IF NOT EXISTS ix_extracted_claims_article_hash ON extracted_claims (article_id, claim_hash);
CREATE INDEX IF NOT EXISTS ix_extracted_claims_article_id ON extracted_claims (article_id);
CREATE INDEX IF NOT EXISTS ix_extracted_claims_claim_hash ON extracted_claims (claim_hash);
CREATE INDEX IF NOT EXISTS ix_extracted_claims_id ON extracted_claims (id);
CREATE INDEX IF NOT EXISTS ix_extracted_claims_story_cluster_id ON extracted_claims (story_cluster_id);
CREATE INDEX IF NOT EXISTS ix_extracted_claims_story_hash ON extracted_claims (story_cluster_id, claim_hash);
CREATE INDEX IF NOT EXISTS ix_gdelt_events_article_id ON gdelt_events (article_id);
CREATE INDEX IF NOT EXISTS ix_gdelt_events_article_published ON gdelt_events (article_id, published_at);
CREATE INDEX IF NOT EXISTS ix_gdelt_events_cluster ON gdelt_events (gdelt_event_cluster_id);
CREATE INDEX IF NOT EXISTS ix_gdelt_events_event_code ON gdelt_events (event_code);
CREATE INDEX IF NOT EXISTS ix_gdelt_events_gdelt_event_cluster_id ON gdelt_events (gdelt_event_cluster_id);
CREATE UNIQUE INDEX IF NOT EXISTS ix_gdelt_events_gdelt_id ON gdelt_events (gdelt_id);
CREATE INDEX IF NOT EXISTS ix_gdelt_events_id ON gdelt_events (id);
CREATE INDEX IF NOT EXISTS ix_gdelt_events_published_at ON gdelt_events (published_at);
CREATE INDEX IF NOT EXISTS ix_gdelt_events_source ON gdelt_events (source);
CREATE INDEX IF NOT EXISTS ix_gdelt_events_url ON gdelt_events (url);
CREATE INDEX IF NOT EXISTS ix_highlights_article_url ON highlights (article_url);
CREATE INDEX IF NOT EXISTS ix_highlights_id ON highlights (id);
CREATE INDEX IF NOT EXISTS ix_highlights_user_id ON highlights (user_id);
CREATE INDEX IF NOT EXISTS ix_liked_articles_id ON liked_articles (id);
CREATE INDEX IF NOT EXISTS ix_material_interest_analyses_id ON material_interest_analyses (id);
CREATE INDEX IF NOT EXISTS ix_material_interest_analyses_url ON material_interest_analyses (article_url);
CREATE INDEX IF NOT EXISTS ix_organizations_id ON organizations (id);
CREATE INDEX IF NOT EXISTS ix_organizations_name ON organizations (name);
CREATE INDEX IF NOT EXISTS ix_organizations_normalized_name ON organizations (normalized_name);
CREATE INDEX IF NOT EXISTS ix_organizations_parent_org_id ON organizations (parent_org_id);
CREATE INDEX IF NOT EXISTS ix_preferences_id ON preferences (id);
CREATE UNIQUE INDEX IF NOT EXISTS ix_preregistrations_canonical_hash ON preregistrations (canonical_hash);
CREATE INDEX IF NOT EXISTS ix_proof_runs_case_id ON proof_runs (case_id);
CREATE INDEX IF NOT EXISTS ix_proof_runs_dataset_snapshot ON proof_runs (dataset_snapshot);
CREATE INDEX IF NOT EXISTS ix_proof_runs_status ON proof_runs (status);
CREATE INDEX IF NOT EXISTS ix_reading_queue_added_at ON reading_queue (added_at);
CREATE INDEX IF NOT EXISTS ix_reading_queue_article_id ON reading_queue (article_id);
CREATE INDEX IF NOT EXISTS ix_reading_queue_id ON reading_queue (id);
CREATE INDEX IF NOT EXISTS ix_reading_queue_position ON reading_queue (position);
CREATE INDEX IF NOT EXISTS ix_reading_queue_queue_type ON reading_queue (queue_type);
CREATE INDEX IF NOT EXISTS ix_reading_queue_read_status ON reading_queue (read_status);
CREATE INDEX IF NOT EXISTS ix_reading_queue_shelf_id ON reading_queue (shelf_id);
CREATE INDEX IF NOT EXISTS ix_reading_queue_user_id ON reading_queue (user_id);
CREATE INDEX IF NOT EXISTS ix_reading_shelves_id ON reading_shelves (id);
CREATE INDEX IF NOT EXISTS ix_reading_shelves_user_id ON reading_shelves (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS ix_reading_shelves_user_name ON reading_shelves (user_id, name);
CREATE INDEX IF NOT EXISTS ix_reporters_id ON reporters (id);
CREATE INDEX IF NOT EXISTS ix_reporters_is_collective ON reporters (is_collective);
CREATE INDEX IF NOT EXISTS ix_reporters_merged_into ON reporters (merged_into);
CREATE INDEX IF NOT EXISTS ix_reporters_name ON reporters (name);
CREATE INDEX IF NOT EXISTS ix_reporters_normalized_name ON reporters (normalized_name);
CREATE INDEX IF NOT EXISTS ix_reporters_resolver_key ON reporters (resolver_key);
CREATE INDEX IF NOT EXISTS ix_reporters_wikidata_qid ON reporters (wikidata_qid);
CREATE INDEX IF NOT EXISTS ix_search_history_id ON search_history (id);
CREATE INDEX IF NOT EXISTS ix_source_analysis_scores_id ON source_analysis_scores (id);
CREATE INDEX IF NOT EXISTS ix_source_analysis_scores_source_name ON source_analysis_scores (source_name);
CREATE UNIQUE INDEX IF NOT EXISTS ix_source_analysis_source_axis ON source_analysis_scores (source_name, axis_name);
CREATE INDEX IF NOT EXISTS ix_source_claims_claim_type ON source_claims (claim_type);
CREATE INDEX IF NOT EXISTS ix_source_claims_id ON source_claims (id);
CREATE INDEX IF NOT EXISTS ix_source_claims_is_current ON source_claims (is_current);
CREATE INDEX IF NOT EXISTS ix_source_claims_source_current ON source_claims (source_name, is_current);
CREATE INDEX IF NOT EXISTS ix_source_claims_source_name ON source_claims (source_name);
CREATE INDEX IF NOT EXISTS ix_source_claims_source_type ON source_claims (source_name, claim_type);
CREATE INDEX IF NOT EXISTS ix_source_coverage_stats_date ON source_coverage_stats (date);
CREATE INDEX IF NOT EXISTS ix_source_coverage_stats_id ON source_coverage_stats (id);
CREATE UNIQUE INDEX IF NOT EXISTS ix_source_coverage_stats_source_date ON source_coverage_stats (source_name, date);
CREATE INDEX IF NOT EXISTS ix_source_coverage_stats_source_name ON source_coverage_stats (source_name);
CREATE UNIQUE INDEX IF NOT EXISTS ix_source_credibility_domain ON source_credibility (domain);
CREATE INDEX IF NOT EXISTS ix_source_credibility_id ON source_credibility (id);
CREATE INDEX IF NOT EXISTS ix_source_credibility_is_active ON source_credibility (is_active);
CREATE INDEX IF NOT EXISTS ix_source_metadata_bias ON source_metadata (political_bias);
CREATE INDEX IF NOT EXISTS ix_source_metadata_country ON source_metadata (country);
CREATE INDEX IF NOT EXISTS ix_source_metadata_country_type ON source_metadata (country, source_type);
CREATE INDEX IF NOT EXISTS ix_source_metadata_domain ON source_metadata (domain);
CREATE INDEX IF NOT EXISTS ix_source_metadata_id ON source_metadata (id);
CREATE INDEX IF NOT EXISTS ix_source_metadata_last_analyzed ON source_metadata (last_analyzed_at);
CREATE INDEX IF NOT EXISTS ix_source_metadata_normalized_name ON source_metadata (normalized_name);
CREATE UNIQUE INDEX IF NOT EXISTS ix_source_metadata_source_name ON source_metadata (source_name);
CREATE INDEX IF NOT EXISTS ix_story_clusters_earliest_article_id ON story_clusters (earliest_article_id);
CREATE UNIQUE INDEX IF NOT EXISTS ix_story_clusters_external_cluster_id ON story_clusters (external_cluster_id);
CREATE INDEX IF NOT EXISTS ix_story_clusters_id ON story_clusters (id);
CREATE INDEX IF NOT EXISTS ix_topic_blind_spots_cluster ON topic_blind_spots (cluster_id);
CREATE INDEX IF NOT EXISTS ix_topic_blind_spots_cluster_id ON topic_blind_spots (cluster_id);
CREATE INDEX IF NOT EXISTS ix_topic_blind_spots_date ON topic_blind_spots (date_identified);
CREATE INDEX IF NOT EXISTS ix_topic_blind_spots_id ON topic_blind_spots (id);
CREATE INDEX IF NOT EXISTS ix_topic_blind_spots_severity ON topic_blind_spots (severity);
CREATE INDEX IF NOT EXISTS ix_topic_cluster_snapshots_window_computed ON topic_cluster_snapshots ("window", computed_at);
CREATE INDEX IF NOT EXISTS ix_trade_flows_exporter_importer ON trade_flows (exporter_country, importer_country);
CREATE INDEX IF NOT EXISTS ix_trade_flows_id ON trade_flows (id);
CREATE UNIQUE INDEX IF NOT EXISTS ix_verification_cache_claim_hash ON verification_cache (claim_hash);
CREATE INDEX IF NOT EXISTS ix_verification_cache_expires ON verification_cache (expires_at);
CREATE INDEX IF NOT EXISTS ix_verification_cache_expires_at ON verification_cache (expires_at);
CREATE INDEX IF NOT EXISTS ix_verification_cache_id ON verification_cache (id);
CREATE INDEX IF NOT EXISTS ix_verification_cache_verified_at ON verification_cache (verified_at);
CREATE UNIQUE INDEX IF NOT EXISTS ix_wiki_index_entity ON wiki_index_status (entity_type, entity_name);
CREATE INDEX IF NOT EXISTS ix_wiki_index_status_entity_name ON wiki_index_status (entity_name);
CREATE INDEX IF NOT EXISTS ix_wiki_index_status_entity_type ON wiki_index_status (entity_type);
CREATE INDEX IF NOT EXISTS ix_wiki_index_status_id ON wiki_index_status (id);
CREATE INDEX IF NOT EXISTS ix_wiki_index_status_next ON wiki_index_status (status, next_index_at);
CREATE INDEX IF NOT EXISTS ix_accepted_relationships_asof ON accepted_relationships (subject_entity_id, predicate, valid_from, valid_to);
CREATE INDEX IF NOT EXISTS ix_accepted_relationships_lifecycle_state ON accepted_relationships (lifecycle_state);
CREATE INDEX IF NOT EXISTS ix_accepted_relationships_object_entity_id ON accepted_relationships (object_entity_id);
CREATE INDEX IF NOT EXISTS ix_accepted_relationships_predicate ON accepted_relationships (predicate);
CREATE INDEX IF NOT EXISTS ix_accepted_relationships_recorded_at ON accepted_relationships (recorded_at);
CREATE UNIQUE INDEX IF NOT EXISTS ix_accepted_relationships_relationship_hash ON accepted_relationships (relationship_hash);
CREATE INDEX IF NOT EXISTS ix_accepted_relationships_retracted_at ON accepted_relationships (retracted_at);
CREATE INDEX IF NOT EXISTS ix_accepted_relationships_status ON accepted_relationships (status);
CREATE INDEX IF NOT EXISTS ix_accepted_relationships_subject_entity_id ON accepted_relationships (subject_entity_id);
CREATE INDEX IF NOT EXISTS ix_accepted_relationships_valid_from ON accepted_relationships (valid_from);
CREATE INDEX IF NOT EXISTS ix_accepted_relationships_valid_to ON accepted_relationships (valid_to);
CREATE INDEX IF NOT EXISTS ix_entity_external_ids_entity_id ON entity_external_ids (entity_id);
CREATE INDEX IF NOT EXISTS ix_entity_external_ids_entity_scheme ON entity_external_ids (entity_id, scheme);
CREATE INDEX IF NOT EXISTS ix_entity_external_ids_source_claim_id ON entity_external_ids (source_claim_id);
CREATE INDEX IF NOT EXISTS ix_entity_resolutions_basis_claim_id ON entity_resolutions (basis_claim_id);
CREATE INDEX IF NOT EXISTS ix_entity_resolutions_decision ON entity_resolutions (decision);
CREATE INDEX IF NOT EXISTS ix_entity_resolutions_left_entity_id ON entity_resolutions (left_entity_id);
CREATE INDEX IF NOT EXISTS ix_entity_resolutions_right_entity_id ON entity_resolutions (right_entity_id);
CREATE INDEX IF NOT EXISTS ix_entity_resolutions_status ON entity_resolutions (status);
CREATE UNIQUE INDEX IF NOT EXISTS ix_evidence_claims_claim_hash ON evidence_claims (claim_hash);
CREATE INDEX IF NOT EXISTS ix_evidence_claims_evidence_class ON evidence_claims (evidence_class);
CREATE INDEX IF NOT EXISTS ix_evidence_claims_object_entity_id ON evidence_claims (object_entity_id);
CREATE INDEX IF NOT EXISTS ix_evidence_claims_predicate ON evidence_claims (predicate);
CREATE INDEX IF NOT EXISTS ix_evidence_claims_recorded_at ON evidence_claims (recorded_at);
CREATE INDEX IF NOT EXISTS ix_evidence_claims_retracted_at ON evidence_claims (retracted_at);
CREATE INDEX IF NOT EXISTS ix_evidence_claims_status ON evidence_claims (status);
CREATE INDEX IF NOT EXISTS ix_evidence_claims_subject_entity_id ON evidence_claims (subject_entity_id);
CREATE INDEX IF NOT EXISTS ix_evidence_claims_subject_predicate_current ON evidence_claims (subject_entity_id, predicate, retracted_at);
CREATE INDEX IF NOT EXISTS ix_evidence_claims_superseded_by ON evidence_claims (superseded_by);
CREATE INDEX IF NOT EXISTS ix_evidence_claims_valid_from ON evidence_claims (valid_from);
CREATE INDEX IF NOT EXISTS ix_evidence_claims_valid_to ON evidence_claims (valid_to);
CREATE INDEX IF NOT EXISTS ix_evidence_documents_document_type ON evidence_documents (document_type);
CREATE INDEX IF NOT EXISTS ix_evidence_documents_issuer_entity_id ON evidence_documents (issuer_entity_id);
CREATE INDEX IF NOT EXISTS ix_evidence_documents_jurisdiction ON evidence_documents (jurisdiction);
CREATE INDEX IF NOT EXISTS ix_evidence_documents_published_at ON evidence_documents (published_at);
CREATE INDEX IF NOT EXISTS ix_evidence_documents_source_class ON evidence_documents (source_class);
CREATE INDEX IF NOT EXISTS ix_evidence_documents_source_url ON evidence_documents (source_url);
CREATE INDEX IF NOT EXISTS ix_identity_edges_edge_type ON identity_edges (edge_type);
CREATE INDEX IF NOT EXISTS ix_identity_edges_id ON identity_edges (id);
CREATE INDEX IF NOT EXISTS ix_identity_edges_reporter_id ON identity_edges (reporter_id);
CREATE INDEX IF NOT EXISTS ix_identity_edges_reporter_type ON identity_edges (reporter_id, edge_type);
CREATE INDEX IF NOT EXISTS ix_reporter_claims_claim_type ON reporter_claims (claim_type);
CREATE INDEX IF NOT EXISTS ix_reporter_claims_id ON reporter_claims (id);
CREATE INDEX IF NOT EXISTS ix_reporter_claims_is_current ON reporter_claims (is_current);
CREATE INDEX IF NOT EXISTS ix_reporter_claims_reporter_current ON reporter_claims (reporter_id, is_current);
CREATE INDEX IF NOT EXISTS ix_reporter_claims_reporter_id ON reporter_claims (reporter_id);
CREATE INDEX IF NOT EXISTS ix_reporter_claims_reporter_type ON reporter_claims (reporter_id, claim_type);
CREATE INDEX IF NOT EXISTS ix_source_claim_evidence_claim_id ON source_claim_evidence (claim_id);
CREATE INDEX IF NOT EXISTS ix_source_claim_evidence_id ON source_claim_evidence (id);
CREATE INDEX IF NOT EXISTS ix_source_claim_evidence_raw_hash ON source_claim_evidence (raw_hash);
CREATE INDEX IF NOT EXISTS ix_calculation_traces_measurement_name ON calculation_traces (measurement_name);
CREATE INDEX IF NOT EXISTS ix_calculation_traces_relationship_id ON calculation_traces (relationship_id);
CREATE INDEX IF NOT EXISTS ix_document_snapshots_document_id ON document_snapshots (document_id);
CREATE INDEX IF NOT EXISTS ix_document_snapshots_retrieved_at ON document_snapshots (retrieved_at);
CREATE INDEX IF NOT EXISTS ix_document_snapshots_sha256_canonical_text ON document_snapshots (sha256_canonical_text);
CREATE UNIQUE INDEX IF NOT EXISTS ix_document_snapshots_sha256_raw ON document_snapshots (sha256_raw);
CREATE INDEX IF NOT EXISTS ix_external_material_events_event_type ON external_material_events (event_type);
CREATE INDEX IF NOT EXISTS ix_external_material_events_occurred_at ON external_material_events (occurred_at);
CREATE INDEX IF NOT EXISTS ix_external_material_events_registry ON external_material_events (registry);
CREATE INDEX IF NOT EXISTS ix_external_material_events_source_claim_id ON external_material_events (source_claim_id);
CREATE INDEX IF NOT EXISTS ix_external_material_events_status ON external_material_events (status);
CREATE INDEX IF NOT EXISTS ix_external_material_events_subject_entity_id ON external_material_events (subject_entity_id);
CREATE INDEX IF NOT EXISTS ix_source_lineage_child_document_id ON source_lineage (child_document_id);
CREATE INDEX IF NOT EXISTS ix_source_lineage_parent_document_id ON source_lineage (parent_document_id);
CREATE INDEX IF NOT EXISTS ix_archive_requests_snapshot_id ON archive_requests (snapshot_id);
CREATE INDEX IF NOT EXISTS ix_archive_requests_status ON archive_requests (status);
CREATE INDEX IF NOT EXISTS ix_evidence_observations_canonical_text_hash ON evidence_observations (canonical_text_hash);
CREATE INDEX IF NOT EXISTS ix_evidence_observations_entailment ON evidence_observations (entailment);
CREATE INDEX IF NOT EXISTS ix_evidence_observations_snapshot_id ON evidence_observations (snapshot_id);
CREATE INDEX IF NOT EXISTS ix_measurement_validation_cards_active ON measurement_validation_cards (active);
CREATE INDEX IF NOT EXISTS ix_measurement_validation_cards_measurement_name ON measurement_validation_cards (measurement_name);

-- Keep historical bootstrap indexes that are not represented in SQLAlchemy metadata.
CREATE INDEX IF NOT EXISTS idx_articles_source ON articles(source);
CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category);
CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_url ON articles(url);
CREATE INDEX IF NOT EXISTS idx_articles_chroma_id ON articles(chroma_id);
CREATE INDEX IF NOT EXISTS idx_articles_paywall_status ON articles(paywall_status);
CREATE INDEX IF NOT EXISTS idx_articles_search ON articles USING GIN((
  setweight(to_tsvector('english', COALESCE(title, '')), 'A') ||
  setweight(to_tsvector('english', COALESCE(summary, '')), 'B') ||
  setweight(to_tsvector('english', COALESCE(source, '')), 'B') ||
  setweight(to_tsvector('english', COALESCE(category, '')), 'C') ||
  setweight(to_tsvector('english', COALESCE(content, '')), 'D')
));
CREATE INDEX IF NOT EXISTS ix_articles_mentioned_countries_gin ON articles USING GIN(mentioned_countries);
CREATE INDEX IF NOT EXISTS idx_search_history_query ON search_history(query);
CREATE INDEX IF NOT EXISTS idx_search_history_created ON search_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reading_queue_user_id ON reading_queue(user_id);
CREATE INDEX IF NOT EXISTS idx_reading_queue_queue_type ON reading_queue(queue_type);
CREATE INDEX IF NOT EXISTS idx_reading_queue_read_status ON reading_queue(read_status);
CREATE INDEX IF NOT EXISTS idx_reading_queue_position ON reading_queue(position);
CREATE INDEX IF NOT EXISTS idx_reading_queue_added_at ON reading_queue(added_at DESC);
CREATE INDEX IF NOT EXISTS idx_reading_queue_shelf_id ON reading_queue(shelf_id);
CREATE INDEX IF NOT EXISTS idx_reading_shelves_user_id ON reading_shelves(user_id);
CREATE INDEX IF NOT EXISTS idx_story_clusters_external_cluster_id ON story_clusters(external_cluster_id);
CREATE INDEX IF NOT EXISTS idx_story_clusters_earliest_article_id ON story_clusters(earliest_article_id);
CREATE INDEX IF NOT EXISTS idx_article_edges_story_cluster_id ON article_edges(story_cluster_id);
CREATE INDEX IF NOT EXISTS idx_article_edges_from_article_id ON article_edges(from_article_id);
CREATE INDEX IF NOT EXISTS idx_article_edges_to_article_id ON article_edges(to_article_id);
CREATE INDEX IF NOT EXISTS idx_article_edges_relation ON article_edges(relation);
CREATE INDEX IF NOT EXISTS idx_extracted_claims_story_cluster_id ON extracted_claims(story_cluster_id);
CREATE INDEX IF NOT EXISTS idx_extracted_claims_article_id ON extracted_claims(article_id);
CREATE INDEX IF NOT EXISTS idx_extracted_claims_claim_hash ON extracted_claims(claim_hash);
CREATE INDEX IF NOT EXISTS idx_extracted_claims_story_hash ON extracted_claims(story_cluster_id, claim_hash);
CREATE INDEX IF NOT EXISTS idx_claim_edges_story_cluster_id ON claim_edges(story_cluster_id);
CREATE INDEX IF NOT EXISTS idx_claim_edges_from_claim_id ON claim_edges(from_claim_id);
CREATE INDEX IF NOT EXISTS idx_claim_edges_to_claim_id ON claim_edges(to_claim_id);
CREATE INDEX IF NOT EXISTS idx_claim_edges_relation ON claim_edges(relation);
CREATE INDEX IF NOT EXISTS idx_corrections_source ON corrections(source);
CREATE INDEX IF NOT EXISTS idx_corrections_article_id ON corrections(article_id);
CREATE INDEX IF NOT EXISTS idx_corrections_corrected_claim_id ON corrections(corrected_claim_id);
CREATE INDEX IF NOT EXISTS idx_corrections_correction_url ON corrections(correction_url);
CREATE INDEX IF NOT EXISTS idx_source_credibility_domain ON source_credibility(domain);
CREATE INDEX IF NOT EXISTS idx_source_credibility_active ON source_credibility(is_active);
CREATE INDEX IF NOT EXISTS idx_verification_cache_hash ON verification_cache(claim_hash);
CREATE INDEX IF NOT EXISTS idx_verification_cache_expires ON verification_cache(expires_at);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.reading_queue'::regclass AND tgname = 'update_reading_queue_updated_at' AND NOT tgisinternal) THEN
        EXECUTE 'CREATE TRIGGER update_reading_queue_updated_at BEFORE UPDATE ON public.reading_queue FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.reading_shelves'::regclass AND tgname = 'update_reading_shelves_updated_at' AND NOT tgisinternal) THEN
        EXECUTE 'CREATE TRIGGER update_reading_shelves_updated_at BEFORE UPDATE ON public.reading_shelves FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.articles'::regclass AND tgname = 'update_articles_updated_at' AND NOT tgisinternal) THEN
        EXECUTE 'CREATE TRIGGER update_articles_updated_at BEFORE UPDATE ON public.articles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.preferences'::regclass AND tgname = 'update_preferences_updated_at' AND NOT tgisinternal) THEN
        EXECUTE 'CREATE TRIGGER update_preferences_updated_at BEFORE UPDATE ON public.preferences FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.story_clusters'::regclass AND tgname = 'update_story_clusters_updated_at' AND NOT tgisinternal) THEN
        EXECUTE 'CREATE TRIGGER update_story_clusters_updated_at BEFORE UPDATE ON public.story_clusters FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.source_credibility'::regclass AND tgname = 'update_source_credibility_updated_at' AND NOT tgisinternal) THEN
        EXECUTE 'CREATE TRIGGER update_source_credibility_updated_at BEFORE UPDATE ON public.source_credibility FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()';
    END IF;
END;
$$;

INSERT INTO source_credibility (domain, credibility_score, source_type, notes) VALUES
  ('reuters.com', 0.95, 'wire', 'Major wire service'),
  ('apnews.com', 0.95, 'wire', 'Associated Press'),
  ('bbc.com', 0.90, 'broadcast', 'British Broadcasting Corporation'),
  ('bbc.co.uk', 0.90, 'broadcast', 'British Broadcasting Corporation'),
  ('npr.org', 0.88, 'broadcast', 'National Public Radio'),
  ('pbs.org', 0.88, 'broadcast', 'Public Broadcasting Service'),
  ('factcheck.org', 0.92, 'fact_checker', 'Annenberg Public Policy Center'),
  ('snopes.com', 0.88, 'fact_checker', 'Fact-checking since 1994'),
  ('politifact.com', 0.88, 'fact_checker', 'Pulitzer Prize-winning fact-checker'),
  ('mediabiasfactcheck.com', 0.85, 'fact_checker', 'Media bias ratings'),
  ('nytimes.com', 0.85, 'newspaper', 'New York Times'),
  ('washingtonpost.com', 0.85, 'newspaper', 'Washington Post'),
  ('theguardian.com', 0.83, 'newspaper', 'The Guardian'),
  ('wsj.com', 0.85, 'newspaper', 'Wall Street Journal'),
  ('economist.com', 0.87, 'magazine', 'The Economist'),
  ('nature.com', 0.92, 'academic', 'Nature journal'),
  ('science.org', 0.92, 'academic', 'Science journal'),
  ('gov.uk', 0.85, 'government', 'UK Government'),
  ('usa.gov', 0.85, 'government', 'US Government'),
  ('who.int', 0.88, 'government', 'World Health Organization'),
  ('un.org', 0.85, 'government', 'United Nations')
ON CONFLICT (domain) DO NOTHING;
