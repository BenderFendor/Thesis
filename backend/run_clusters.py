import asyncio
import sys

from app.core.config import settings
from app.database import AsyncSessionLocal, init_db
from app.services.chroma_topics import ChromaTopicService
from app.vector_store import is_chroma_reachable, CHROMA_HOST, CHROMA_PORT

async def main():
    print(f"CHROMA_HOST: {CHROMA_HOST}, CHROMA_PORT: {CHROMA_PORT}")
    print(f"is_chroma_reachable: {is_chroma_reachable()}")
    await init_db()
    service = ChromaTopicService()
    async with AsyncSessionLocal() as session:
        counts = await service.compute_and_save_clusters(session)
        print(f"Counts: {counts}")

if __name__ == "__main__":
    asyncio.run(main())
