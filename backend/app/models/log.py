from sqlalchemy import Column, String, DateTime, Enum, Float
from sqlalchemy.sql import func
from app.database import Base
import enum


class LogType(str, enum.Enum):
    access = "access"
    denied = "denied"
    override = "override"
    system = "system"
    ai = "ai"


class Log(Base):
    __tablename__ = "logs"

    id = Column(String, primary_key=True)
    timestamp = Column(DateTime(timezone=True), server_default=func.now())
    log_type = Column(Enum(LogType), nullable=False)
    message = Column(String, nullable=False)
    vehicle_id = Column(String)
    villa_id = Column(String)
    operator_id = Column(String)
    snapshot_url = Column(String)
    confidence_score = Column(Float)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
