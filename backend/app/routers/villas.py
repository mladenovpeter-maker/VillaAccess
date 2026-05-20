from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
import uuid

from app.database import get_db
from app.models.villa import Villa, VillaStatus
from app.models.camera import Camera
from app.routers.auth import get_current_user
from app.models.user import User

router = APIRouter()


class VillaInput(BaseModel):
    name: str
    gate_id: str
    door_id: str
    camera_ids: Optional[List[str]] = []
    status: Optional[VillaStatus] = VillaStatus.active


def villa_to_dict(villa: Villa, db: Session):
    cameras = db.query(Camera.id).filter(Camera.villa_id == villa.id).all()
    return {
        "id": villa.id, "name": villa.name, "gate_id": villa.gate_id,
        "door_id": villa.door_id, "status": villa.status,
        "camera_ids": [c.id for c in cameras],
    }


@router.get("/")
def list_villas(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    villas = db.query(Villa).order_by(Villa.name).all()
    return [villa_to_dict(v, db) for v in villas]


@router.post("/", status_code=201)
def create_villa(body: VillaInput, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    villa = Villa(id=str(uuid.uuid4()), name=body.name, gate_id=body.gate_id, door_id=body.door_id, status=body.status)
    db.add(villa)
    db.commit()
    db.refresh(villa)
    return villa_to_dict(villa, db)


@router.get("/{villa_id}")
def get_villa(villa_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    villa = db.query(Villa).filter(Villa.id == villa_id).first()
    if not villa:
        raise HTTPException(status_code=404, detail="Not found")
    return villa_to_dict(villa, db)


@router.put("/{villa_id}")
def update_villa(villa_id: str, body: VillaInput, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    villa = db.query(Villa).filter(Villa.id == villa_id).first()
    if not villa:
        raise HTTPException(status_code=404, detail="Not found")
    villa.name = body.name
    villa.gate_id = body.gate_id
    villa.door_id = body.door_id
    villa.status = body.status
    db.commit()
    db.refresh(villa)
    return villa_to_dict(villa, db)
