from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
import uuid, random

from app.database import get_db
from app.models.reservation import Reservation, ReservationVehicle, ReservationStatus
from app.models.villa import Villa
from app.models.vehicle import Vehicle
from app.models.camera import Camera
from app.routers.auth import get_current_user
from app.models.user import User
from datetime import datetime

router = APIRouter()


class ReservationInput(BaseModel):
    guest_name: str
    guest_phone: Optional[str] = None
    guest_email: Optional[str] = None
    villa_id: str
    check_in: datetime
    check_out: datetime
    vehicle_ids: Optional[List[str]] = []
    notes: Optional[str] = None


def enrich(r: Reservation, db: Session):
    vehicle_ids = [rv.vehicle_id for rv in r.vehicle_links]
    vehicles = db.query(Vehicle).filter(Vehicle.id.in_(vehicle_ids)).all() if vehicle_ids else []
    villa = r.villa
    villa_dict = None
    if villa:
        cameras = db.query(Camera.id).filter(Camera.villa_id == villa.id).all()
        villa_dict = {"id": villa.id, "name": villa.name, "gate_id": villa.gate_id,
                      "door_id": villa.door_id, "status": villa.status, "camera_ids": [c.id for c in cameras]}
    return {
        "id": r.id, "guest_name": r.guest_name, "guest_phone": r.guest_phone,
        "guest_email": r.guest_email, "villa_id": r.villa_id,
        "check_in": r.check_in, "check_out": r.check_out, "status": r.status,
        "vehicle_ids": vehicle_ids, "notes": r.notes, "pin_code": r.pin_code,
        "villa": villa_dict,
        "vehicles": [{"id": v.id, "license_plate": v.license_plate, "make": v.make,
                      "model": v.model, "color": v.color, "vehicle_type": v.vehicle_type,
                      "confidence_score": v.confidence_score, "status": v.status,
                      "snapshot_url": v.snapshot_url, "first_seen": v.first_seen,
                      "last_seen": v.last_seen, "total_visits": v.total_visits, "notes": v.notes}
                     for v in vehicles],
    }


@router.get("/")
def list_reservations(
    status: Optional[str] = None,
    villa_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(Reservation)
    if status:
        q = q.filter(Reservation.status == status)
    if villa_id:
        q = q.filter(Reservation.villa_id == villa_id)
    return [enrich(r, db) for r in q.all()]


@router.post("/", status_code=201)
def create_reservation(body: ReservationInput, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    pin = str(random.randint(1000, 9999))
    r = Reservation(id=str(uuid.uuid4()), guest_name=body.guest_name, guest_phone=body.guest_phone,
                    guest_email=body.guest_email, villa_id=body.villa_id, check_in=body.check_in,
                    check_out=body.check_out, pin_code=pin, notes=body.notes)
    db.add(r)
    db.flush()
    for vid in (body.vehicle_ids or []):
        db.add(ReservationVehicle(reservation_id=r.id, vehicle_id=vid))
    db.commit()
    db.refresh(r)
    return enrich(r, db)


@router.get("/{reservation_id}")
def get_reservation(reservation_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    r = db.query(Reservation).filter(Reservation.id == reservation_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Not found")
    return enrich(r, db)


@router.put("/{reservation_id}")
def update_reservation(reservation_id: str, body: ReservationInput, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    r = db.query(Reservation).filter(Reservation.id == reservation_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Not found")
    r.guest_name = body.guest_name
    r.guest_phone = body.guest_phone
    r.guest_email = body.guest_email
    r.villa_id = body.villa_id
    r.check_in = body.check_in
    r.check_out = body.check_out
    r.notes = body.notes
    db.query(ReservationVehicle).filter(ReservationVehicle.reservation_id == r.id).delete()
    for vid in (body.vehicle_ids or []):
        db.add(ReservationVehicle(reservation_id=r.id, vehicle_id=vid))
    db.commit()
    db.refresh(r)
    return enrich(r, db)


@router.delete("/{reservation_id}", status_code=204)
def delete_reservation(reservation_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    r = db.query(Reservation).filter(Reservation.id == reservation_id).first()
    if r:
        db.delete(r)
        db.commit()
