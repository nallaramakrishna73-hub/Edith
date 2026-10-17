import os
from typing import List
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    APP_NAME: str = "EDITH"
    APP_ENV: str = "development"
    DATABASE_URL: str = "sqlite:///./edith.db"
    AI_PROVIDER: str = "google-gemini"
    AI_API_KEY: str = ""
    AI_MODEL: str = "gemini-3.8-flash"
    AI_BASE_URL: str = ""
    AI_TIMEOUT_SECONDS: int = 30
    CORS_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000"
    MAX_MESSAGE_CHARS: int = 4000
    MAX_CONTEXT_MESSAGES: int = 20
    MAX_CONTEXT_CHARS: int = 12000
    RATE_LIMIT_PER_MINUTE: int = 30

    @property
    def cors_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]

    @property
    def is_ai_configured(self) -> bool:
        key = self.AI_API_KEY or os.environ.get("GEMINI_API_KEY", "")
        return bool(key and key.strip() and self.AI_MODEL)

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"

settings = Settings()
