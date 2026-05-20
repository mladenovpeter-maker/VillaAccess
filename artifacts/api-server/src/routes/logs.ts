import { Router } from "express";
import { db } from "@workspace/db";
import { logsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth } from "./auth";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  const { log_type, villa_id, page = "1", page_size = "50" } = req.query;
  const pageNum = parseInt(page as string);
  const pageSizeNum = parseInt(page_size as string);
  const offset = (pageNum - 1) * pageSizeNum;

  const conditions: any[] = [];
  if (log_type) conditions.push(eq(logsTable.log_type, log_type as any));
  if (villa_id) conditions.push(eq(logsTable.villa_id, villa_id as string));

  const [countResult, rows] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(logsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined),
    db.select().from(logsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(sql`${logsTable.timestamp} desc`)
      .limit(pageSizeNum)
      .offset(offset),
  ]);

  res.json({
    items: rows.map((l) => ({
      id: l.id,
      timestamp: l.timestamp,
      log_type: l.log_type,
      message: l.message,
      vehicle_id: l.vehicle_id,
      villa_id: l.villa_id,
      operator_id: l.operator_id,
      snapshot_url: l.snapshot_url,
      confidence_score: l.confidence_score,
    })),
    total: countResult[0]?.count ?? 0,
    page: pageNum,
    page_size: pageSizeNum,
  });
});

export { router as logsRouter };
