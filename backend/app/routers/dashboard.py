from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import get_db
from app.models.villa import Villa
from app.models.reservation import Reservation, ReservationStatus
from app.models.vehicle import Vehicle
from app.models.access_event import AccessEvent, EventStatus
from app.models.camera import Camera, CameraStatus
from app.routers.auth import get_current_user
from app.models.user import User
from datetime import datetime, date

router = APIRouter()


@router.get("/stats")
def get_stats(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    today = datetime.combine(date.today(), datetime.min.time())

    total_villas = db.query(func.count(Villa.id)).scalar()
    active_reservations = db.query(func.count(Reservation.id)).filter(Reservation.status == ReservationStatus.active).scalar()
    total_vehicles = db.query(func.count(Vehicle.id)).scalar()
    events_today = db.query(func.count(AccessEvent.id)).filter(AccessEvent.timestamp >= today).scalar()
    denied_today = db.query(func.count(AccessEvent.id)).filter(
        AccessEvent.timestamp >= today, AccessEvent.status == EventStatus.denied
    ).scalar()
    allowed_today = db.query(func.count(AccessEvent.id)).filter(
        AccessEvent.timestamp >= today, AccessEvent.status == EventStatus.allowed
    ).scalar()
    cameras_online = db.query(func.count(Camera.id)).filter(Camera.status == CameraStatus.online).scalar()

    return {
        "total_villas": total_villas,
        "active_reservations": active_reservations,
        "total_vehicles": total_vehicles,
        "events_today": events_today,
        "gates_online": total_villas,
        "cameras_online": cameras_online,
        "denied_attempts_today": denied_today,
        "auto_opens_today": allowed_today,
    }


@router.get("/recent-events")
def get_recent_events(
    limit: int = Query(default=20, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    events = db.query(AccessEvent).order_by(AccessEvent.timestamp.desc()).limit(limit).all()
    return [
        {
            "id": e.id, "timestamp": e.timestamp, "event_type": e.event_type,
            "status": e.status, "confidence_score": e.confidence_score,
            "vehicle_id": e.vehicle_id, "license_plate": e.license_plate,
            "villa_id": e.villa_id, "camera_id": e.camera_id,
            "snapshot_url": e.snapshot_url, "notes": e.notes,
            "vehicle": None, "villa": None,
        }
        for e in events
    ]
