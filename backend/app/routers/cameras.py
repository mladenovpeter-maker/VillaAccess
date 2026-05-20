from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.camera import Camera
from app.routers.auth import get_current_user
from app.models.user import User

router = APIRouter()


def camera_dict(c: Camera):
    return {"id": c.id, "name": c.name, "ip_address": c.ip_address, "rtsp_url": c.rtsp_url,
            "villa_id": c.villa_id, "status": c.status, "last_snapshot": c.last_snapshot,
            "snapshot_url": c.snapshot_url, "model": c.model}


@router.get("/")
def list_cameras(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return [camera_dict(c) for c in db.query(Camera).order_by(Camera.name).all()]


@router.get("/{camera_id}/snapshot")
def get_snapshot(camera_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    c = db.query(Camera).filter(Camera.id == camera_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Not found")
    return camera_dict(c)
