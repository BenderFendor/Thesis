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

-- Full-text search index (for fallback search)
CREATE INDEX IF NOT EXISTS idx_articles_search ON articles USING GIN(to_tsvector('english', title || ' ' || COALESCE(summary, '')));

-- Bookmarks (no user auth needed for self-hosted)
CREATE TABLE IF NOT EXISTS bookmarks (
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
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for reading queue queries
CREATE INDEX IF NOT EXISTS idx_reading_queue_user_id ON reading_queue(user_id);
CREATE INDEX IF NOT EXISTS idx_reading_queue_queue_type ON reading_queue(queue_type);
CREATE INDEX IF NOT EXISTS idx_reading_queue_read_status ON reading_queue(read_status);
CREATE INDEX IF NOT EXISTS idx_reading_queue_position ON reading_queue(position);
CREATE INDEX IF NOT EXISTS idx_reading_queue_added_at ON reading_queue(added_at DESC);

CREATE TRIGGER update_reading_queue_updated_at BEFORE UPDATE ON reading_queue
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
