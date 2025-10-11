import chromadb
from chromadb.config import Settings
from typing import List, Dict, Optional
import os
import logging
from sentence_transformers import SentenceTransformer

logger = logging.getLogger(__name__)

CHROMA_HOST = os.getenv("CHROMA_HOST", "localhost")
CHROMA_PORT = int(os.getenv("CHROMA_PORT", "8000"))


class VectorStore:
    def __init__(self):
        try:
            # Use HTTP client for Docker setup
            self.client = chromadb.HttpClient(
                host=CHROMA_HOST,
                port=CHROMA_PORT,
                settings=Settings(
                    anonymized_telemetry=False,
                    allow_reset=True  # Enable for development
                )
            )
            
            # Create or get collection
            self.collection = self.client.get_or_create_collection(
                name="news_articles",
                metadata={"hnsw:space": "cosine"}  # Cosine similarity for text
            )
            
            # Use lightweight embedding model
            # Alternative: 'BAAI/bge-small-en-v1.5' (384 dims, better quality)
            self.embedding_model = SentenceTransformer('all-MiniLM-L6-v2')
            
            logger.info(f"✅ Connected to ChromaDB at {CHROMA_HOST}:{CHROMA_PORT}")
            logger.info(f"📊 Collection '{self.collection.name}' has {self.collection.count()} documents")
        except Exception as e:
            logger.error(f"❌ Failed to connect to ChromaDB: {e}")
            raise
    
    def add_article(
        self,
        article_id: str,
        title: str,
        summary: str,
        content: str,
        metadata: Dict
    ) -> bool:
        """Add article embedding to ChromaDB"""
        try:
            # Combine title, summary, and content for richer embeddings
            text = f"{title}\n\n{summary}"
            if content and content != summary:
                text += f"\n\n{content[:500]}"  # Limit content length
            
            # Generate embedding
            embedding = self.embedding_model.encode(
                text,
                show_progress_bar=False,
            ).tolist()
            
            # Store in ChromaDB with metadata
            self.collection.add(
                ids=[article_id],
                embeddings=[embedding],
                documents=[text],
                metadatas=[{
                    **metadata,
                    'title': title,
                    'summary': summary[:200]  # Truncate for metadata
                }]
            )
            
            logger.debug(f"Added article {article_id} to vector store")
            return True
            
        except Exception as e:
            logger.error(f"Failed to add article to vector store: {e}")
            return False
    
    def search_similar(
        self,
        query: str,
        limit: int = 10,
        filter_metadata: Optional[Dict] = None
    ) -> List[Dict]:
        """Semantic search for similar articles"""
        try:
            # Generate query embedding
            query_embedding = self.embedding_model.encode(query).tolist()
            
            # Build where clause for filtering
            where_clause = filter_metadata if filter_metadata else None
            
            # Search ChromaDB
            results = self.collection.query(
                query_embeddings=[query_embedding],
                n_results=limit,
                where=where_clause,
                include=["metadatas", "documents", "distances"]
            )
            
            # Format results
            articles = []
            if results['ids'] and len(results['ids'][0]) > 0:
                for i in range(len(results['ids'][0])):
                    articles.append({
                        'chroma_id': results['ids'][0][i],
                        'article_id': int(results['ids'][0][i].replace('article_', '')),
                        'distance': results['distances'][0][i],
                        'similarity_score': 1 - results['distances'][0][i],  # Convert to similarity
                        'metadata': results['metadatas'][0][i],
                        'preview': results['documents'][0][i][:200]
                    })
            
            logger.info(f"Found {len(articles)} similar articles for query: '{query[:50]}...'")
            return articles
            
        except Exception as e:
            logger.error(f"Vector search failed: {e}")
            return []
    
    def batch_add_articles(self, articles: List[Dict]) -> int:
        """Batch insert articles for better performance"""
        try:
            ids: List[str] = []
            documents: List[str] = []
            metadatas: List[Dict] = []

            for article in articles:
                text_parts = [article.get('title', '') or '', "\n\n", article.get('summary', '') or '']
                content = article.get('content')
                if content and content.strip() and content.strip() != (article.get('summary') or '').strip():
                    text_parts.extend(["\n\n", content[:500]])
                text = "".join(text_parts)

                ids.append(article['chroma_id'])
                documents.append(text)
                metadatas.append({
                    **article.get('metadata', {}),
                    'title': article.get('title'),
                    'summary': (article.get('summary') or '')[:200],
                })

            embeddings_array = self.embedding_model.encode(
                documents,
                batch_size=min(32, max(1, len(documents))),
                convert_to_numpy=True,
                show_progress_bar=False,
            )

            embeddings = [embedding.tolist() for embedding in embeddings_array]

            self.collection.add(
                ids=ids,
                embeddings=embeddings,
                documents=documents,
                metadatas=metadatas
            )
            
            logger.info(f"Batch added {len(articles)} articles to vector store")
            return len(articles)
            
        except Exception as e:
            logger.error(f"Batch add failed: {e}")
            return 0
    
    def delete_article(self, article_id: str) -> bool:
        """Remove article from vector store"""
        try:
            self.collection.delete(ids=[article_id])
            logger.debug(f"Deleted article {article_id} from vector store")
            return True
        except Exception as e:
            logger.error(f"Failed to delete article: {e}")
            return False
    
    def get_collection_stats(self) -> Dict:
        """Get vector store statistics"""
        try:
            count = self.collection.count()
            return {
                "total_articles": count,
                "collection_name": self.collection.name,
                "embedding_dimension": 384,  # For all-MiniLM-L6-v2
                "similarity_metric": "cosine"
            }
        except Exception as e:
            logger.error(f"Failed to get stats: {e}")
            return {"total_articles": 0, "error": str(e)}


# Global instance - initialized when module is imported
try:
    vector_store = VectorStore()
except Exception as e:
    logger.warning(f"⚠️ ChromaDB not available: {e}")
    vector_store = None
