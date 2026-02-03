"""Chroma Vector Database Service for style similarity search."""
import chromadb
from chromadb.config import Settings as ChromaSettings
from typing import List, Dict, Any, Optional
import json

from app.core.config import get_settings

settings = get_settings()


class VectorDBService:
    """Chroma-based vector database for storing and searching style embeddings."""

    _instance: Optional["VectorDBService"] = None
    _client: Optional[chromadb.Client] = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self):
        if self._client is None:
            self._client = chromadb.Client(ChromaSettings(
                chroma_db_impl="duckdb+parquet",
                persist_directory=settings.CHROMA_PERSIST_DIRECTORY,
                anonymized_telemetry=False
            ))
            self._collection = self._client.get_or_create_collection(
                name=settings.CHROMA_COLLECTION_NAME,
                metadata={"description": "Style embeddings for creative content"}
            )

    @property
    def collection(self):
        return self._collection

    async def add_style(
        self,
        style_id: str,
        embedding: List[float],
        metadata: Dict[str, Any]
    ) -> bool:
        """Add a style embedding to the database."""
        try:
            self._collection.add(
                ids=[style_id],
                embeddings=[embedding],
                metadatas=[{k: json.dumps(v) if isinstance(v, (dict, list)) else str(v)
                           for k, v in metadata.items()}]
            )
            return True
        except Exception as e:
            print(f"Error adding style: {e}")
            return False

    async def search_similar_styles(
        self,
        query_embedding: List[float],
        top_k: int = 5,
        filter_metadata: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        """Search for similar styles based on embedding similarity."""
        try:
            results = self._collection.query(
                query_embeddings=[query_embedding],
                n_results=top_k,
                where=filter_metadata
            )

            similar_styles = []
            if results and results['ids']:
                for i, style_id in enumerate(results['ids'][0]):
                    similar_styles.append({
                        "id": style_id,
                        "distance": results['distances'][0][i] if results.get('distances') else None,
                        "metadata": results['metadatas'][0][i] if results.get('metadatas') else {}
                    })

            return similar_styles
        except Exception as e:
            print(f"Error searching styles: {e}")
            return []

    async def delete_style(self, style_id: str) -> bool:
        """Delete a style from the database."""
        try:
            self._collection.delete(ids=[style_id])
            return True
        except Exception as e:
            print(f"Error deleting style: {e}")
            return False

    async def get_style(self, style_id: str) -> Optional[Dict[str, Any]]:
        """Get a specific style by ID."""
        try:
            result = self._collection.get(ids=[style_id])
            if result and result['ids']:
                return {
                    "id": result['ids'][0],
                    "metadata": result['metadatas'][0] if result.get('metadatas') else {}
                }
            return None
        except Exception as e:
            print(f"Error getting style: {e}")
            return None


# Singleton instance
vector_db = VectorDBService()
