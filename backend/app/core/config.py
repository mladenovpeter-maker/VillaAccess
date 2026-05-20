from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    database_url: str = "postgresql://villa_user:changeme@localhost:5432/villa_access"
    redis_url: str = "redis://localhost:6379"
    jwt_secret: str = "change_this_in_production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24 * 7  # 7 days
    snapshots_dir: str = "/app/snapshots"
    allowed_origins: List[str] = ["http://localhost:3000", "http://localhost:5173"]

    # AI confidence thresholds
    ai_confidence_high: float = 0.90   # Auto-open gate
    ai_confidence_medium: float = 0.70  # Ask admin confirmation

    # Hikvision / camera settings
    hikvision_admin_user: str = "admin"
    hikvision_admin_password: str = ""
    camera_snapshot_interval: int = 30  # seconds

    class Config:
        env_file = ".env"
        case_sensitive = False


settings = Settings()
