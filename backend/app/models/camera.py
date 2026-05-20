from sqlalchemy import Column, String, DateTime, Enum, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.database import Base
import enum


class CameraStatus(str, enum.Enum):
    online = "online"
    offline = "offline"
    error = "error"


class Camera(Base):
    __tablename__ = "cameras"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    ip_address = Column(String, nullable=False)
    rtsp_url = Column(String)
    villa_id = Column(String, ForeignKey("villas.id", ondelete="SET NULL"))
    status = Column(Enum(CameraStatus), nullable=False, default=CameraStatus.offline)
    last_snapshot = Column(DateTime(timezone=True))
    snapshot_url = Column(String)
    model = Column(String)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    villa = relationship("Villa", back_populates="cameras")
