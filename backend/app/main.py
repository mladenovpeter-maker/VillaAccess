"""
Villa Access Control - FastAPI Backend
This is the production Python/FastAPI backend designed to run inside Docker.
For Replit development, the TypeScript Express server (artifacts/api-server) is used instead.
"""

from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os

from app.database import engine, Base
from app.routers import auth, dashboard, villas, reservations, vehicles, access, cameras, logs
from app.core.config import settings

# Create tables on startup
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Villa Access Control API",
    version="1.0.0",
    description="AI-powered smart access control platform for vacation rental villas",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount snapshots directory
snapshots_dir = settings.snapshots_dir
os.makedirs(snapshots_dir, exist_ok=True)
app.mount("/snapshots", StaticFiles(directory=snapshots_dir), name="snapshots")

# Register routers
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(dashboard.router, prefix="/api/dashboard", tags=["dashboard"])
app.include_router(villas.router, prefix="/api/villas", tags=["villas"])
app.include_router(reservations.router, prefix="/api/reservations", tags=["reservations"])
app.include_router(vehicles.router, prefix="/api/vehicles", tags=["vehicles"])
app.include_router(access.router, prefix="/api/access", tags=["access"])
app.include_router(cameras.router, prefix="/api/cameras", tags=["cameras"])
app.include_router(logs.router, prefix="/api/logs", tags=["logs"])


@app.get("/api/healthz")
async def health():
    return {"status": "ok"}
