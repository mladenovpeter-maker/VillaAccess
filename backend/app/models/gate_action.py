from sqlalchemy import Column, String, DateTime, Enum, Boolean, ForeignKey
from sqlalchemy.sql import func
from app.database import Base
import enum


class ActionType(str, enum.Enum):
    open_gate = "open_gate"
    open_door = "open_door"
    close_gate = "close_gate"
    close_door = "close_door"


class TriggeredBy(str, enum.Enum):
    ai_auto = "ai_auto"
    manual = "manual"
    schedule = "schedule"
    api = "api"


class GateAction(Base):
    __tablename__ = "gate_actions"

    id = Column(String, primary_key=True)
    villa_id = Column(String, ForeignKey("villas.id", ondelete="CASCADE"), nullable=False)
    action_type = Column(Enum(ActionType), nullable=False)
    triggered_by = Column(Enum(TriggeredBy), nullable=False, default=TriggeredBy.manual)
    operator_id = Column(String, ForeignKey("users.id", ondelete="SET NULL"))
    timestamp = Column(DateTime(timezone=True), server_default=func.now())
    success = Column(Boolean, nullable=False, default=True)
    notes = Column(String)
