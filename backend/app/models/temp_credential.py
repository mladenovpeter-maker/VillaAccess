from sqlalchemy import Column, String, DateTime, Enum, ForeignKey
from sqlalchemy.sql import func
from app.database import Base
import enum


class CredentialStatus(str, enum.Enum):
    active = "active"
    expired = "expired"
    revoked = "revoked"


class TempCredential(Base):
    __tablename__ = "temp_credentials"

    id = Column(String, primary_key=True)
    reservation_id = Column(String, ForeignKey("reservations.id", ondelete="CASCADE"), nullable=False)
    pin_code = Column(String, nullable=False)
    valid_from = Column(DateTime(timezone=True), nullable=False)
    valid_until = Column(DateTime(timezone=True), nullable=False)
    status = Column(Enum(CredentialStatus), nullable=False, default=CredentialStatus.active)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
