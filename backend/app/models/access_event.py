from sqlalchemy import Column, String, DateTime, Enum, Float, ForeignKey
from sqlalchemy.sql import func
from app.database import Base
import enum


class EventType(str, enum.Enum):
    entry = "entry"
    exit = "exit"
    denied = "denied"
    manual_open = "manual_open"
    override = "override"


class EventStatus(str, enum.Enum):
    allowed = "allowed"
    denied = "denied"
    manual = "manual"
    pending = "pending"


class AccessEvent(Base):
    __tablename__ = "access_events"

    id = Column(String, primary_key=True)
    timestamp = Column(DateTime(timezone=True), server_default=func.now())
    event_type = Column(Enum(EventType), nullable=False)
    status = Column(Enum(EventStatus), nullable=False)
    confidence_score = Column(Float)
    vehicle_id = Column(String)
    license_plate = Column(String)
    villa_id = Column(String, ForeignKey("villas.id", ondelete="SET NULL"))
    camera_id = Column(String, ForeignKey("cameras.id", ondelete="SET NULL"))
    snapshot_url = Column(String)
    notes = Column(String)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
