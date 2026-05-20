from sqlalchemy import Column, String, DateTime, Enum, Integer, Float
from sqlalchemy.sql import func
from app.database import Base
import enum


class VehicleType(str, enum.Enum):
    sedan = "sedan"
    suv = "suv"
    van = "van"
    truck = "truck"
    motorcycle = "motorcycle"
    other = "other"


class VehicleStatus(str, enum.Enum):
    known = "known"
    unknown = "unknown"
    blacklisted = "blacklisted"


class Vehicle(Base):
    __tablename__ = "vehicles"

    id = Column(String, primary_key=True)
    license_plate = Column(String, unique=True, nullable=False)
    make = Column(String)
    model = Column(String)
    color = Column(String)
    vehicle_type = Column(Enum(VehicleType))
    confidence_score = Column(Float)
    status = Column(Enum(VehicleStatus), nullable=False, default=VehicleStatus.unknown)
    snapshot_url = Column(String)
    first_seen = Column(DateTime(timezone=True))
    last_seen = Column(DateTime(timezone=True))
    total_visits = Column(Integer, nullable=False, default=0)
    notes = Column(String)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
