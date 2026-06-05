import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { accessEventsTable } from "@workspace/db";
import { and, gte, like, sql } from "drizzle-orm";

// Rough per-call cost estimate for the OpenAI vision fallback (gpt-4o-mini,
// a few snapshots per call). The authoritative figure is always the OpenAI
// billing dashboard — this endpoint is a convenience self-tracker that counts
// the ai_fallback events we already log into access_events.
const EST_USD_PER_CALL = 0.017;

// Every AI fallback decision is persisted as an access_events row whose `notes`
// (TEXT, JSON-encoded) contains `"ai_fallback":true`. We match on that marker.
const AI_FALLBACK_MARKER = '%"ai_fallback":true%';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const aiUsageRouter: IRouter = Router();

aiUsageRouter.get("/", async (_req, res) => {
  try {
    const isAi = like(accessEventsTable.notes, AI_FALLBACK_MARKER);

    const [monthAgg] = await db
      .select({
        calls: sql<number>`count(*)::int`,
        opened: sql<number>`count(*) filter (where ${accessEventsTable.status} = 'allowed')::int`,
        denied: sql<number>`count(*) filter (where ${accessEventsTable.status} = 'denied')::int`,
      })
      .from(accessEventsTable)
      .where(and(isAi, gte(accessEventsTable.timestamp, sql`date_trunc('month', now())`)));

    const [todayAgg] = await db
      .select({ calls: sql<number>`count(*)::int` })
      .from(accessEventsTable)
      .where(and(isAi, gte(accessEventsTable.timestamp, sql`date_trunc('day', now())`)));

    const daily = await db
      .select({
        day: sql<string>`to_char(date_trunc('day', ${accessEventsTable.timestamp}), 'YYYY-MM-DD')`,
        calls: sql<number>`count(*)::int`,
      })
      .from(accessEventsTable)
      .where(and(isAi, gte(accessEventsTable.timestamp, sql`date_trunc('day', now()) - interval '13 days'`)))
      .groupBy(sql`1`)
      .orderBy(sql`1 desc`);

    const monthCalls = monthAgg?.calls ?? 0;
    const todayCalls = todayAgg?.calls ?? 0;

    res.json({
      est_usd_per_call: EST_USD_PER_CALL,
      month: {
        calls: monthCalls,
        opened: monthAgg?.opened ?? 0,
        denied: monthAgg?.denied ?? 0,
        est_usd: round2(monthCalls * EST_USD_PER_CALL),
      },
      today: {
        calls: todayCalls,
        est_usd: round2(todayCalls * EST_USD_PER_CALL),
      },
      daily: daily.map((d) => ({
        day: d.day,
        calls: d.calls,
        est_usd: round2(d.calls * EST_USD_PER_CALL),
      })),
    });
  } catch (err: any) {
    console.error("[ai-usage] failed to compute usage:", err);
    res.status(500).json({ detail: "Failed to compute AI usage" });
  }
});
