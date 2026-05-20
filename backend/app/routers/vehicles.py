from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
import uuid

from app.database import get_db
from app.models.vehicle import Vehicle, VehicleStatus, VehicleType
from app.models.access_event import AccessEvent
from app.routers.auth import get_current_user
from app.models.user import User

router = APIRouter()


class VehicleInput(BaseModel):
    license_plate: str
    make: Optional[str] = None
    model: Optional[str] = None
    color: Optional[str] = None
    vehicle_type: Optional[VehicleType] = None
    status: Optional[VehicleStatus] = VehicleStatus.unknown
    notes: Optional[str] = None


def vehicle_dict(v: Vehicle):
    return {
        "id": v.id, "license_plate": v.license_plate, "make": v.make, "model": v.model,
        "color": v.color, "vehicle_type": v.vehicle_type, "confidence_score": v.confidence_score,
        "status": v.status, "snapshot_url": v.snapshot_url, "first_seen": v.first_seen,
        "last_seen": v.last_seen, "total_visits": v.total_visits, "notes": v.notes,
    }


@router.get("/")
def list_vehicles(
    status: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(Vehicle)
    if status:
        q = q.filter(Vehicle.status == status)
    if search:
        q = q.filter(Vehicle.license_plate.ilike(f"%{search}%"))
    return [vehicle_dict(v) for v in q.all()]


@router.post("/", status_code=201)
def create_vehicle(body: VehicleInput, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    v = Vehicle(id=str(uuid.uuid4()), **body.model_dump())
    db.add(v)
    db.commit()
    db.refresh(v)
    return vehicle_dict(v)


@router.get("/{vehicle_id}")
def get_vehicle(vehicle_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    v = db.query(Vehicle).filter(Vehicle.id == vehicle_id).first()
    if not v:
        raise HTTPException(status_code=404, detail="Not found")
    return vehicle_dict(v)


@router.put("/{vehicle_id}")
def update_vehicle(vehicle_id: str, body: VehicleInput, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    v = db.query(Vehicle).filter(Vehicle.id == vehicle_id).first()
    if not v:
        raise HTTPException(status_code=404, detail="Not found")
    for k, val in body.model_dump().items():
        setattr(v, k, val)
    db.commit()
    db.refresh(v)
    return vehicle_dict(v)


@router.delete("/{vehicle_id}", status_code=204)
def delete_vehicle(vehicle_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    v = db.query(Vehicle).filter(Vehicle.id == vehicle_id).first()
    if v:
        db.delete(v)
        db.commit()


@router.get("/{vehicle_id}/events")
def get_vehicle_events(vehicle_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    events = db.query(AccessEvent).filter(AccessEvent.vehicle_id == vehicle_id).order_by(AccessEvent.timestamp.desc()).limit(50).all()
    return {
        "items": [{"id": e.id, "timestamp": e.timestamp, "event_type": e.event_type, "status": e.status,
                   "confidence_score": e.confidence_score, "vehicle_id": e.vehicle_id,
                   "license_plate": e.license_plate, "villa_id": e.villa_id, "camera_id": e.camera_id,
                   "snapshot_url": e.snapshot_url, "notes": e.notes, "vehicle": None, "villa": None}
                  for e in events],
        "total": len(events), "page": 1, "page_size": 50,
    }
