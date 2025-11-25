-- Migration: Add Pagination Indexes for Article Table
-- Description: Composite indexes for efficient cursor-based pagination
-- Date: 2024-11-24

-- Composite index for efficient cursor pagination (primary)
-- Used by: /news/page endpoint for date-ordered pagination
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_articles_published_at_id_desc 
ON articles (published_at DESC, id DESC);

-- Category filtering with date ordering
-- Used by: /news/page?category=X for filtered pagination
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_articles_category_published 
ON articles (category, published_at DESC);

-- Source filtering with date ordering
-- Used by: /news/page?source=X for source-specific pagination  
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_articles_source_published 
ON articles (source, published_at DESC);

-- Full-text search index using trigrams (optional, for search optimization)
-- Requires: CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- Uncomment the following lines if trigram extension is available:
-- CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_articles_title_trgm 
-- ON articles USING gin (title gin_trgm_ops);

-- Analyze tables after index creation for query planner optimization
ANALYZE articles;

-- Verify indexes were created
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'articles' 
AND indexname LIKE 'ix_articles_%';
