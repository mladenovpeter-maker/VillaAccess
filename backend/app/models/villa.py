from sqlalchemy import Column, String, DateTime, Enum
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.database import Base
import enum


class VillaStatus(str, enum.Enum):
    active = "active"
    inactive = "inactive"
    maintenance = "maintenance"


class Villa(Base):
    __tablename__ = "villas"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    gate_id = Column(String, nullable=False)
    door_id = Column(String, nullable=False)
    status = Column(Enum(VillaStatus), nullable=False, default=VillaStatus.active)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    cameras = relationship("Camera", back_populates="villa")
    reservations = relationship("Reservation", back_populates="villa")
