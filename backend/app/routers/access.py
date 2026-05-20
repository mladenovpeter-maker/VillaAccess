from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
import uuid, random
from datetime import datetime, timedelta

from app.database import get_db
from app.models.access_event import AccessEvent, EventStatus, EventType
from app.models.gate_action import GateAction, ActionType, TriggeredBy
from app.models.temp_credential import TempCredential, CredentialStatus
from app.models.villa import Villa
from app.routers.auth import get_current_user
from app.models.user import User

router = APIRouter()


@router.get("/events")
def get_events(
    status: Optional[str] = None,
    villa_id: Optional[str] = None,
    event_type: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(AccessEvent)
    if status:
        q = q.filter(AccessEvent.status == status)
    if villa_id:
        q = q.filter(AccessEvent.villa_id == villa_id)
    if event_type:
        q = q.filter(AccessEvent.event_type == event_type)
    total = q.count()
    events = q.order_by(AccessEvent.timestamp.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {
        "items": [{"id": e.id, "timestamp": e.timestamp, "event_type": e.event_type, "status": e.status,
                   "confidence_score": e.confidence_score, "vehicle_id": e.vehicle_id, "license_plate": e.license_plate,
                   "villa_id": e.villa_id, "camera_id": e.camera_id, "snapshot_url": e.snapshot_url, "notes": e.notes,
                   "vehicle": None, "villa": None}
                  for e in events],
        "total": total, "page": page, "page_size": page_size,
    }


class OpenGateRequest(BaseModel):
    villa_id: str
    duration_seconds: Optional[int] = None
    notes: Optional[str] = None


@router.post("/open-gate")
def open_gate(body: OpenGateRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    villa = db.query(Villa).filter(Villa.id == body.villa_id).first()
    if not villa:
        raise HTTPException(status_code=404, detail="Villa not found")

    action = GateAction(id=str(uuid.uuid4()), villa_id=body.villa_id, action_type=ActionType.open_gate,
                        triggered_by=TriggeredBy.manual, operator_id=current_user.id, success=True, notes=body.notes)
    event = AccessEvent(id=str(uuid.uuid4()), event_type=EventType.manual_open, status=EventStatus.manual,
                        villa_id=body.villa_id, notes=f"Gate opened manually by {current_user.username}")
    db.add(action)
    db.add(event)
    db.commit()
    db.refresh(action)
    return {"id": action.id, "villa_id": action.villa_id, "action_type": action.action_type,
            "triggered_by": action.triggered_by, "operator_id": action.operator_id,
            "timestamp": action.timestamp, "success": action.success, "notes": action.notes}


class OpenDoorRequest(BaseModel):
    villa_id: str
    duration_seconds: Optional[int] = None
    notes: Optional[str] = None


@router.post("/open-door")
def open_door(body: OpenDoorRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    villa = db.query(Villa).filter(Villa.id == body.villa_id).first()
    if not villa:
        raise HTTPException(status_code=404, detail="Villa not found")

    action = GateAction(id=str(uuid.uuid4()), villa_id=body.villa_id, action_type=ActionType.open_door,
                        triggered_by=TriggeredBy.manual, operator_id=current_user.id, success=True, notes=body.notes)
    event = AccessEvent(id=str(uuid.uuid4()), event_type=EventType.manual_open, status=EventStatus.manual,
                        villa_id=body.villa_id, notes=f"Door opened manually by {current_user.username}")
    db.add(action)
    db.add(event)
    db.commit()
    db.refresh(action)
    return {"id": action.id, "villa_id": action.villa_id, "action_type": action.action_type,
            "triggered_by": action.triggered_by, "operator_id": action.operator_id,
            "timestamp": action.timestamp, "success": action.success, "notes": action.notes}


@router.get("/temp-credentials")
def list_credentials(reservation_id: Optional[str] = None, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = db.query(TempCredential)
    if reservation_id:
        q = q.filter(TempCredential.reservation_id == reservation_id)
    creds = q.all()
    return [{"id": c.id, "reservation_id": c.reservation_id, "pin_code": c.pin_code,
             "valid_from": c.valid_from, "valid_until": c.valid_until, "status": c.status} for c in creds]


class TempCredentialRequest(BaseModel):
    reservation_id: str
    duration_hours: Optional[int] = 24


@router.post("/temp-credentials", status_code=201)
def create_credential(body: TempCredentialRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    pin = str(random.randint(100000, 999999))
    valid_from = datetime.utcnow()
    valid_until = valid_from + timedelta(hours=body.duration_hours or 24)
    cred = TempCredential(id=str(uuid.uuid4()), reservation_id=body.reservation_id, pin_code=pin,
                          valid_from=valid_from, valid_until=valid_until, status=CredentialStatus.active)
    db.add(cred)
    db.commit()
    db.refresh(cred)
    return {"id": cred.id, "reservation_id": cred.reservation_id, "pin_code": cred.pin_code,
            "valid_from": cred.valid_from, "valid_until": cred.valid_until, "status": cred.status}
