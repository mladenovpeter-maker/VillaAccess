from sqlalchemy import Column, String, DateTime, Enum, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.database import Base
import enum


class ReservationStatus(str, enum.Enum):
    upcoming = "upcoming"
    active = "active"
    completed = "completed"
    cancelled = "cancelled"


class Reservation(Base):
    __tablename__ = "reservations"

    id = Column(String, primary_key=True)
    guest_name = Column(String, nullable=False)
    guest_phone = Column(String)
    guest_email = Column(String)
    villa_id = Column(String, ForeignKey("villas.id", ondelete="CASCADE"), nullable=False)
    check_in = Column(DateTime(timezone=True), nullable=False)
    check_out = Column(DateTime(timezone=True), nullable=False)
    status = Column(Enum(ReservationStatus), nullable=False, default=ReservationStatus.upcoming)
    notes = Column(String)
    pin_code = Column(String)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    villa = relationship("Villa", back_populates="reservations")
    vehicle_links = relationship("ReservationVehicle", back_populates="reservation", cascade="all, delete-orphan")


class ReservationVehicle(Base):
    __tablename__ = "reservation_vehicles"

    reservation_id = Column(String, ForeignKey("reservations.id", ondelete="CASCADE"), primary_key=True)
    vehicle_id = Column(String, primary_key=True)

    reservation = relationship("Reservation", back_populates="vehicle_links")
