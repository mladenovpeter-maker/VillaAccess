import { Router } from "express";
import { db } from "@workspace/db";
import { camerasTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "./auth";

const router = Router();

router.get("/", requireAuth, async (_req, res) => {
  const cameras = await db.select().from(camerasTable).orderBy(camerasTable.name);
  res.json(cameras.map((c) => ({
    id: c.id,
    name: c.name,
    ip_address: c.ip_address,
    rtsp_url: c.rtsp_url,
    villa_id: c.villa_id,
    status: c.status,
    last_snapshot: c.last_snapshot,
    snapshot_url: c.snapshot_url,
    model: c.model,
  })));
});

router.get("/:id/snapshot", requireAuth, async (req, res) => {
  const rows = await db.select().from(camerasTable).where(eq(camerasTable.id, req.params.id)).limit(1);
  if (!rows[0]) { res.status(404).json({ detail: "Not found" }); return; }
  const c = rows[0];
  res.json({
    id: c.id,
    name: c.name,
    ip_address: c.ip_address,
    rtsp_url: c.rtsp_url,
    villa_id: c.villa_id,
    status: c.status,
    last_snapshot: c.last_snapshot,
    snapshot_url: c.snapshot_url,
    model: c.model,
  });
});

export { router as camerasRouter };
