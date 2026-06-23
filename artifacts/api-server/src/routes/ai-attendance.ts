import { Router } from "express";
import { db, workersTable, leavesTable, accessEventsTable } from "@workspace/db";
import { gte } from "drizzle-orm";

export const aiAttendanceRouter = Router();

// ─── Build context snapshot for the AI ────────────────────────────────────────

async function buildContext(): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const [workers, allLeaves, recentEvents] = await Promise.all([
    db.select({
      id: workersTable.id,
      first_name: workersTable.first_name,
      last_name: workersTable.last_name,
      department: workersTable.department,
      position: workersTable.position,
      active: workersTable.active,
      employee_number: workersTable.employee_number,
    }).from(workersTable),

    db.select().from(leavesTable),

    db.select({
      id: accessEventsTable.id,
      timestamp: accessEventsTable.timestamp,
      event_type: accessEventsTable.event_type,
      status: accessEventsTable.status,
      license_plate: accessEventsTable.license_plate,
      entrance_id: accessEventsTable.entrance_id,
    }).from(accessEventsTable)
      .where(gte(accessEventsTable.timestamp, new Date(thirtyDaysAgo)))
      .limit(500),
  ]);

  const activeWorkers = workers.filter(w => w.active);
  const todayLeaves = allLeaves.filter(l => l.start_date <= today && l.end_date >= today);
  const deptMap = new Map<string, number>();
  activeWorkers.forEach(w => {
    const d = w.department ?? "Без отдел";
    deptMap.set(d, (deptMap.get(d) ?? 0) + 1);
  });

  const allowedEvents = recentEvents.filter(e => e.status === "allowed" || e.status === "manual");
  const deniedEvents  = recentEvents.filter(e => e.status === "denied");

  const leaveTypeCounts = {
    vacation:      allLeaves.filter(l => l.type === "vacation").length,
    sick:          allLeaves.filter(l => l.type === "sick").length,
    business_trip: allLeaves.filter(l => l.type === "business_trip").length,
    other:         allLeaves.filter(l => l.type === "other").length,
  };

  const workerSummaries = activeWorkers.map(w => {
    const wLeaves = allLeaves.filter(l => l.worker_id === w.id);
    const onLeave = todayLeaves.some(l => l.worker_id === w.id);
    return `- ${w.last_name} ${w.first_name}${w.department ? ` (${w.department})` : ""}${w.position ? `, ${w.position}` : ""}${onLeave ? " [В ОТПУСКА]" : ""}; Отпуски общо: ${wLeaves.length}`;
  }).join("\n");

  return `
СИСТЕМА: MakmetalAccess — Контрол на достъпа за промишлен обект (България)
ДАТА ДНЕС: ${today}

## РАБОТНИЦИ
Общо активни: ${activeWorkers.length} от ${workers.length}
По отдели:
${Array.from(deptMap.entries()).map(([d, n]) => `  - ${d}: ${n} души`).join("\n")}

Списък работници (активни):
${workerSummaries}

## ОТПУСКИ
Днес в отпуска: ${todayLeaves.length} работника
${todayLeaves.map(l => {
  const w = workers.find(w => w.id === l.worker_id);
  return `  - ${w ? `${w.last_name} ${w.first_name}` : l.worker_id} (${l.type}, до ${l.end_date})`;
}).join("\n")}

Общо записани отпуски:
  - Платен отпуск: ${leaveTypeCounts.vacation}
  - Болничен: ${leaveTypeCounts.sick}
  - Командировка: ${leaveTypeCounts.business_trip}
  - Друго: ${leaveTypeCounts.other}

## ДОСТЪП (последни 30 дни)
Общо събития: ${recentEvents.length}
Разрешени влизания: ${allowedEvents.length}
Отказани: ${deniedEvents.length}
Процент отказани: ${recentEvents.length > 0 ? ((deniedEvents.length / recentEvents.length) * 100).toFixed(1) : 0}%
`.trim();
}

// ─── POST /ai-attendance/chat ─────────────────────────────────────────────────

aiAttendanceRouter.post("/chat", async (req, res) => {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) {
    res.status(503).json({
      detail: "OPENAI_API_KEY не е конфигуриран. Добавете го в .env.docker и рестартирайте.",
    });
    return;
  }

  const { message, history = [] } = req.body as {
    message: string;
    history: { role: "user" | "assistant"; content: string }[];
  };

  if (!message?.trim()) {
    res.status(400).json({ detail: "Празно съобщение" });
    return;
  }

  try {
    const context = await buildContext();

    const systemPrompt = `Ти си AI асистент за анализ на присъствие и достъп в MakmetalAccess — система за контрол на достъпа на промишлен обект в България. Отговаряш САМО на БЪЛГАРСКИ език.

Разполагаш с актуални данни за работниците, отпуски и достъп:

${context}

Давай конкретни, ясни отговори. Когато показваш числа или имена, ги форматирай прегледно. Ако въпросът е извън обхвата на наличните данни, кажи го честно. Не измисляй данни.`;

    const messages = [
      { role: "system" as const, content: systemPrompt },
      ...history.slice(-10),
      { role: "user" as const, content: message },
    ];

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages,
        max_tokens: 800,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("[ai-attendance] OpenAI error", err);
      res.status(502).json({ detail: "OpenAI API грешка" });
      return;
    }

    const data = await response.json() as {
      choices: { message: { content: string } }[];
      usage: { total_tokens: number };
    };

    const reply = data.choices[0]?.message?.content ?? "";
    res.json({ reply, tokens: data.usage?.total_tokens ?? 0 });
  } catch (err) {
    console.error("[ai-attendance] chat error", err);
    res.status(500).json({ detail: "Грешка при генериране на отговор" });
  }
});
