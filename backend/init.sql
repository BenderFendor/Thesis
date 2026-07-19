-- Articles table with full-text search
CREATE TABLE IF NOT EXISTS articles (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  source TEXT NOT NULL,
  source_id TEXT,
  country TEXT,
  credibility TEXT,
  bias TEXT,
  summary TEXT,
  content TEXT,
  image_url TEXT,
  published_at TIMESTAMPTZ NOT NULL,
  category TEXT,
  url TEXT UNIQUE NOT NULL,
  tags TEXT[],
  original_language TEXT DEFAULT 'en',
  translated BOOLEAN DEFAULT false,
  paywall_status TEXT DEFAULT 'unknown',
  chroma_id TEXT UNIQUE,
  embedding_generated BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_articles_source ON articles(source);
CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category);
CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_url ON articles(url);
CREATE INDEX IF NOT EXISTS idx_articles_chroma_id ON articles(chroma_id);
CREATE INDEX IF NOT EXISTS idx_articles_paywall_status ON articles(paywall_status);

-- Full-text search index covering the weighted backend search vector.
CREATE INDEX IF NOT EXISTS idx_articles_search ON articles USING GIN((
  setweight(to_tsvector('english', COALESCE(title, '')), 'A') ||
  setweight(to_tsvector('english', COALESCE(summary, '')), 'B') ||
  setweight(to_tsvector('english', COALESCE(source, '')), 'B') ||
  setweight(to_tsvector('english', COALESCE(category, '')), 'C') ||
  setweight(to_tsvector('english', COALESCE(content, '')), 'D')
));

-- Bookmarks (no user auth needed for self-hosted)
CREATE TABLE IF NOT EXISTS bookmarks (
  id SERIAL PRIMARY KEY,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(article_id)
);

-- Liked Articles (no user auth needed for self-hosted)
CREATE TABLE IF NOT EXISTS liked_articles (
  id SERIAL PRIMARY KEY,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(article_id)
);

-- Preferences (shared or single-user)
CREATE TABLE IF NOT EXISTS preferences (
  id SERIAL PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Search history for analytics
CREATE TABLE IF NOT EXISTS search_history (
  id SERIAL PRIMARY KEY,
  query TEXT NOT NULL,
  search_type TEXT,
  results_count INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_search_history_query ON search_history(query);
CREATE INDEX IF NOT EXISTS idx_search_history_created ON search_history(created_at DESC);

-- Reading Queue for user's daily and permanent reading lists
CREATE TABLE IF NOT EXISTS reading_queue (
  id SERIAL PRIMARY KEY,
  user_id INTEGER DEFAULT 1,
  article_id INTEGER NOT NULL,
  article_title TEXT NOT NULL,
  article_url TEXT NOT NULL UNIQUE,
  article_source TEXT NOT NULL,
  article_image TEXT,
  queue_type TEXT DEFAULT 'daily' CHECK (queue_type IN ('daily', 'permanent')),
  position INTEGER DEFAULT 0,
  read_status TEXT DEFAULT 'unread' CHECK (read_status IN ('unread', 'reading', 'completed')),
  added_at TIMESTAMPTZ DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  word_count INTEGER,
  estimated_read_time_minutes INTEGER,
  full_text TEXT,
  why_saved TEXT,
  unresolved_question TEXT,
  shelf_id INTEGER
);

-- Indexes for reading queue queries
CREATE INDEX IF NOT EXISTS idx_reading_queue_user_id ON reading_queue(user_id);
CREATE INDEX IF NOT EXISTS idx_reading_queue_queue_type ON reading_queue(queue_type);
CREATE INDEX IF NOT EXISTS idx_reading_queue_read_status ON reading_queue(read_status);
CREATE INDEX IF NOT EXISTS idx_reading_queue_position ON reading_queue(position);
CREATE INDEX IF NOT EXISTS idx_reading_queue_added_at ON reading_queue(added_at DESC);
CREATE INDEX IF NOT EXISTS idx_reading_queue_shelf_id ON reading_queue(shelf_id);

CREATE TABLE IF NOT EXISTS reading_shelves (
  id SERIAL PRIMARY KEY,
  user_id INTEGER DEFAULT 1,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_reading_shelves_user_id ON reading_shelves(user_id);

CREATE TRIGGER update_reading_queue_updated_at BEFORE UPDATE ON reading_queue
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_reading_shelves_updated_at BEFORE UPDATE ON reading_shelves
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Auto-update timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_articles_updated_at BEFORE UPDATE ON articles
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_preferences_updated_at BEFORE UPDATE ON preferences
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Durable story lineage tables promoted from topic-cluster snapshots.
CREATE TABLE IF NOT EXISTS story_clusters (
  id SERIAL PRIMARY KEY,
  external_cluster_id INTEGER UNIQUE NOT NULL,
  label TEXT,
  keywords JSONB DEFAULT '[]'::jsonb,
  first_seen_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  earliest_article_id INTEGER,
  current_summary TEXT,
  confidence DOUBLE PRECISION DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_story_clusters_external_cluster_id ON story_clusters(external_cluster_id);
CREATE INDEX IF NOT EXISTS idx_story_clusters_earliest_article_id ON story_clusters(earliest_article_id);

CREATE TABLE IF NOT EXISTS article_edges (
  id SERIAL PRIMARY KEY,
  story_cluster_id INTEGER NOT NULL,
  from_article_id INTEGER NOT NULL,
  to_article_id INTEGER NOT NULL,
  relation TEXT NOT NULL,
  evidence JSONB DEFAULT '{}'::jsonb,
  confidence DOUBLE PRECISION DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(story_cluster_id, from_article_id, to_article_id, relation)
);

CREATE INDEX IF NOT EXISTS idx_article_edges_story_cluster_id ON article_edges(story_cluster_id);
CREATE INDEX IF NOT EXISTS idx_article_edges_from_article_id ON article_edges(from_article_id);
CREATE INDEX IF NOT EXISTS idx_article_edges_to_article_id ON article_edges(to_article_id);
CREATE INDEX IF NOT EXISTS idx_article_edges_relation ON article_edges(relation);

CREATE TABLE IF NOT EXISTS extracted_claims (
  id SERIAL PRIMARY KEY,
  story_cluster_id INTEGER NOT NULL,
  article_id INTEGER NOT NULL,
  claim_text TEXT NOT NULL,
  normalized_claim TEXT NOT NULL,
  claim_hash TEXT NOT NULL,
  claim_type TEXT DEFAULT 'general',
  checkability TEXT DEFAULT 'medium',
  evidence_span TEXT,
  entities JSONB DEFAULT '[]'::jsonb,
  numbers JSONB DEFAULT '[]'::jsonb,
  extracted_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(article_id, claim_hash)
);

CREATE INDEX IF NOT EXISTS idx_extracted_claims_story_cluster_id ON extracted_claims(story_cluster_id);
CREATE INDEX IF NOT EXISTS idx_extracted_claims_article_id ON extracted_claims(article_id);
CREATE INDEX IF NOT EXISTS idx_extracted_claims_claim_hash ON extracted_claims(claim_hash);
CREATE INDEX IF NOT EXISTS idx_extracted_claims_story_hash ON extracted_claims(story_cluster_id, claim_hash);

CREATE TABLE IF NOT EXISTS claim_edges (
  id SERIAL PRIMARY KEY,
  story_cluster_id INTEGER NOT NULL,
  from_claim_id INTEGER NOT NULL,
  to_claim_id INTEGER NOT NULL,
  relation TEXT NOT NULL,
  evidence JSONB DEFAULT '{}'::jsonb,
  confidence DOUBLE PRECISION DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(story_cluster_id, from_claim_id, to_claim_id, relation)
);

CREATE INDEX IF NOT EXISTS idx_claim_edges_story_cluster_id ON claim_edges(story_cluster_id);
CREATE INDEX IF NOT EXISTS idx_claim_edges_from_claim_id ON claim_edges(from_claim_id);
CREATE INDEX IF NOT EXISTS idx_claim_edges_to_claim_id ON claim_edges(to_claim_id);
CREATE INDEX IF NOT EXISTS idx_claim_edges_relation ON claim_edges(relation);

CREATE TABLE IF NOT EXISTS corrections (
  id SERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  article_id INTEGER,
  correction_url TEXT UNIQUE,
  correction_text TEXT NOT NULL,
  corrected_claim_id INTEGER,
  downstream_article_ids JSONB DEFAULT '[]'::jsonb,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_corrections_source ON corrections(source);
CREATE INDEX IF NOT EXISTS idx_corrections_article_id ON corrections(article_id);
CREATE INDEX IF NOT EXISTS idx_corrections_corrected_claim_id ON corrections(corrected_claim_id);
CREATE INDEX IF NOT EXISTS idx_corrections_correction_url ON corrections(correction_url);

CREATE TRIGGER update_story_clusters_updated_at BEFORE UPDATE ON story_clusters
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Verification Agent Tables

CREATE TABLE IF NOT EXISTS source_credibility (
  id SERIAL PRIMARY KEY,
  domain TEXT UNIQUE NOT NULL,
  credibility_score DECIMAL(3,2) NOT NULL CHECK (credibility_score >= 0 AND credibility_score <= 1),
  source_type TEXT DEFAULT 'unknown',
  is_active BOOLEAN DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_source_credibility_domain ON source_credibility(domain);
CREATE INDEX IF NOT EXISTS idx_source_credibility_active ON source_credibility(is_active);

CREATE TRIGGER update_source_credibility_updated_at BEFORE UPDATE ON source_credibility
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Seed default high-credibility sources
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

-- Verification cache for avoiding redundant checks
CREATE TABLE IF NOT EXISTS verification_cache (
  id SERIAL PRIMARY KEY,
  claim_hash TEXT UNIQUE NOT NULL,
  claim_text TEXT NOT NULL,
  confidence DECIMAL(3,2) NOT NULL,
  confidence_level TEXT NOT NULL,
  sources_json JSONB,
  verified_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_verification_cache_hash ON verification_cache(claim_hash);
CREATE INDEX IF NOT EXISTS idx_verification_cache_expires ON verification_cache(expires_at);
