from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional

from app.database import get_db
from app.models.log import Log
from app.routers.auth import get_current_user
from app.models.user import User

router = APIRouter()


@router.get("/")
def get_logs(
    log_type: Optional[str] = None,
    villa_id: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(Log)
    if log_type:
        q = q.filter(Log.log_type == log_type)
    if villa_id:
        q = q.filter(Log.villa_id == villa_id)
    total = q.count()
    logs = q.order_by(Log.timestamp.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {
        "items": [{"id": l.id, "timestamp": l.timestamp, "log_type": l.log_type,
                   "message": l.message, "vehicle_id": l.vehicle_id, "villa_id": l.villa_id,
                   "operator_id": l.operator_id, "snapshot_url": l.snapshot_url, "confidence_score": l.confidence_score}
                  for l in logs],
        "total": total, "page": page, "page_size": page_size,
    }
