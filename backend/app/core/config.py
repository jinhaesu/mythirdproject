"""Application configuration settings."""
from functools import lru_cache
from typing import List

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Application
    APP_NAME: str = "Meta-Commander"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False

    # Database
    DATABASE_URL: str = "sqlite+aiosqlite:///./meta_commander.db"

    # Meta API
    META_APP_ID: str = ""
    META_APP_SECRET: str = ""
    META_ACCESS_TOKEN: str = ""
    META_API_VERSION: str = "v19.0"
    META_GRAPH_API_BASE: str = "https://graph.facebook.com"

    # AI Services
    ANTHROPIC_API_KEY: str = ""
    OPENAI_API_KEY: str = ""
    REPLICATE_API_TOKEN: str = ""

    # Market Intelligence APIs
    YOUTUBE_API_KEY: str = ""
    NAVER_CLIENT_ID: str = ""
    NAVER_CLIENT_SECRET: str = ""

    # Resend (Email)
    RESEND_API_KEY: str = ""
    RESEND_FROM_EMAIL: str = "onboarding@resend.dev"
    FRONTEND_URL: str = "http://localhost:3000"

    # Allowed emails (comma-separated, empty = allow all)
    ALLOWED_EMAILS: str = ""

    @property
    def allowed_emails_list(self) -> List[str]:
        if not self.ALLOWED_EMAILS.strip():
            return []
        return [e.strip().lower() for e in self.ALLOWED_EMAILS.split(",")]

    # Chroma Vector DB (로컬 실행, API 키 불필요)
    CHROMA_PERSIST_DIRECTORY: str = "./chroma_data"
    CHROMA_COLLECTION_NAME: str = "meta-commander-styles"

    # JWT Authentication
    JWT_SECRET_KEY: str = "your-secret-key-change-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 30

    # Server
    PORT: int = 8000

    # CORS
    CORS_ORIGINS: str = "http://localhost:3000"

    @property
    def cors_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",")]

    class Config:
        env_file = ".env"
        case_sensitive = True


@lru_cache()
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
