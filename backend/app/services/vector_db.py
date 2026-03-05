"""Chroma Vector Database Service for style similarity search."""
import logging
from typing import List, Dict, Any, Optional
import json

logger = logging.getLogger(__name__)

try:
    import chromadb
    from chromadb.config import Settings as ChromaSettings
    CHROMA_AVAILABLE = True
except ImportError:
    CHROMA_AVAILABLE = False
    logger.warning("ChromaDB not available, vector search disabled")


class VectorDBService:
    """Chroma-based vector database for storing and searching style embeddings."""

    _instance: Optional["VectorDBService"] = None
    _client = None
    _collection = None
    _initialized = False

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def _ensure_initialized(self):
        if self._initialized or not CHROMA_AVAILABLE:
            return
        try:
            from app.core.config import get_settings
            settings = get_settings()
            self._client = chromadb.Client(ChromaSettings(
                anonymized_telemetry=False
            ))
            self._collection = self._client.get_or_create_collection(
                name=settings.CHROMA_COLLECTION_NAME,
                metadata={"description": "Style embeddings for creative content"}
            )
            self._initialized = True
        except Exception as e:
            logger.error(f"Failed to initialize ChromaDB: {e}")

    @property
    def collection(self):
        self._ensure_initialized()
        return self._collection

    async def add_style(
        self,
        style_id: str,
        embedding: List[float],
        metadata: Dict[str, Any]
    ) -> bool:
        """Add a style embedding to the database."""
        self._ensure_initialized()
        if not self._collection:
            return False
        try:
            self._collection.add(
                ids=[style_id],
                embeddings=[embedding],
                metadatas=[{k: json.dumps(v) if isinstance(v, (dict, list)) else str(v)
                           for k, v in metadata.items()}]
            )
            return True
        except Exception as e:
            logger.error(f"Error adding style: {e}")
            return False

    async def search_similar_styles(
        self,
        query_embedding: List[float],
        top_k: int = 5,
        filter_metadata: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        """Search for similar styles based on embedding similarity."""
        self._ensure_initialized()
        if not self._collection:
            return []
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
            logger.error(f"Error searching styles: {e}")
            return []

    async def delete_style(self, style_id: str) -> bool:
        """Delete a style from the database."""
        self._ensure_initialized()
        if not self._collection:
            return False
        try:
            self._collection.delete(ids=[style_id])
            return True
        except Exception as e:
            logger.error(f"Error deleting style: {e}")
            return False

    async def get_style(self, style_id: str) -> Optional[Dict[str, Any]]:
        """Get a specific style by ID."""
        self._ensure_initialized()
        if not self._collection:
            return None
        try:
            result = self._collection.get(ids=[style_id])
            if result and result['ids']:
                return {
                    "id": result['ids'][0],
                    "metadata": result['metadatas'][0] if result.get('metadatas') else {}
                }
            return None
        except Exception as e:
            logger.error(f"Error getting style: {e}")
            return None


# Singleton instance (lazy - won't crash on import)
vector_db = VectorDBService()
