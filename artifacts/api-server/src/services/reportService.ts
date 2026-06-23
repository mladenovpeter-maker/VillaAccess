import { db } from "@workspace/db";
import {
  workersTable,
  departmentsTable,
  shiftsTable,
  workerVehiclesTable,
  accessEventsTable,
  leavesTable,
} from "@workspace/db";
import { eq, isNull, and, gte, lte, inArray, asc, desc, or } from "drizzle-orm";
import { getSettingValue } from "./emailService";

export interface WorkerReportEntry {
  workerId: string;
  fullName: string;
  position: string | null;
  department: string | null;
  shiftName: string;
  shiftStart: string;
  shiftEnd: string;
  eventTime: Date | null;
  minutesDiff: number | null;
  status: "late" | "absent" | "early" | "no_exit";
}

function parseHHMM(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function toHHMM(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function dayRange(date: Date): { start: Date; end: Date } {
  const y = date.getFullYear();
  const m = date.getMonth();
  const d = date.getDate();
  return {
    start: new Date(y, m, d, 0, 0, 0),
    end: new Date(y, m, d, 23, 59, 59),
  };
}

function todayDateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function getGraceMinutes(key: "report_late_grace_minutes" | "report_early_grace_minutes"): Promise<number> {
  const v = await getSettingValue(key);
  const n = parseInt(v, 10);
  return isNaN(n) ? 15 : n;
}

async function getActiveWorkersWithShifts() {
  const rows = await db
    .select({
      id: workersTable.id,
      first_name: workersTable.first_name,
      last_name: workersTable.last_name,
      position: workersTable.position,
      department_id: workersTable.department_id,
      dept_name: departmentsTable.name,
      shift_id: departmentsTable.default_shift_id,
      shift_name: shiftsTable.name,
      start_time: shiftsTable.start_time,
      end_time: shiftsTable.end_time,
    })
    .from(workersTable)
    .leftJoin(departmentsTable, eq(workersTable.department_id, departmentsTable.id))
    .leftJoin(shiftsTable, eq(departmentsTable.default_shift_id, shiftsTable.id))
    .where(isNull(workersTable.archived_at));

  return rows.filter((r) => r.shift_id && r.start_time && r.end_time);
}

async function getOnLeaveSet(dateStr: string): Promise<Set<string>> {
  const rows = await db
    .select({ worker_id: leavesTable.worker_id })
    .from(leavesTable)
    .where(
      and(
        lte(leavesTable.start_date, dateStr),
        gte(leavesTable.end_date, dateStr),
      ),
    );
  return new Set(rows.map((r) => r.worker_id));
}

async function getWorkerVehicleIds(workerIds: string[]): Promise<Map<string, string[]>> {
  if (!workerIds.length) return new Map();
  const links = await db
    .select()
    .from(workerVehiclesTable)
    .where(inArray(workerVehiclesTable.worker_id, workerIds));

  const map = new Map<string, string[]>();
  for (const l of links) {
    if (!map.has(l.worker_id)) map.set(l.worker_id, []);
    map.get(l.worker_id)!.push(l.vehicle_id);
  }
  return map;
}

export async function getLateArrivals(date: Date): Promise<WorkerReportEntry[]> {
  const graceMinutes = await getGraceMinutes("report_late_grace_minutes");
  const dateStr = todayDateString(date);
  const { start, end } = dayRange(date);

  const workers = await getActiveWorkersWithShifts();
  const onLeave = await getOnLeaveSet(dateStr);
  const workerIds = workers.map((w) => w.id).filter((id) => !onLeave.has(id));
  const vehicleMap = await getWorkerVehicleIds(workerIds);

  const results: WorkerReportEntry[] = [];

  for (const w of workers) {
    if (onLeave.has(w.id)) continue;

    const vehicleIds = vehicleMap.get(w.id) ?? [];
    const fullName = `${w.last_name} ${w.first_name}`;

    const shiftStartMin = parseHHMM(w.start_time!);

    let firstEntry: Date | null = null;

    if (vehicleIds.length > 0) {
      const events = await db
        .select({ timestamp: accessEventsTable.timestamp })
        .from(accessEventsTable)
        .where(
          and(
            inArray(accessEventsTable.vehicle_id, vehicleIds),
            eq(accessEventsTable.event_type, "entry"),
            gte(accessEventsTable.timestamp, start),
            lte(accessEventsTable.timestamp, end),
          ),
        )
        .orderBy(asc(accessEventsTable.timestamp))
        .limit(1);

      if (events[0]) firstEntry = events[0].timestamp;
    }

    if (!firstEntry) {
      results.push({
        workerId: w.id,
        fullName,
        position: w.position,
        department: w.dept_name ?? null,
        shiftName: w.shift_name!,
        shiftStart: w.start_time!,
        shiftEnd: w.end_time!,
        eventTime: null,
        minutesDiff: null,
        status: "absent",
      });
      continue;
    }

    const entryMin = firstEntry.getHours() * 60 + firstEntry.getMinutes();
    const minutesLate = entryMin - shiftStartMin;

    if (minutesLate > graceMinutes) {
      results.push({
        workerId: w.id,
        fullName,
        position: w.position,
        department: w.dept_name ?? null,
        shiftName: w.shift_name!,
        shiftStart: w.start_time!,
        shiftEnd: w.end_time!,
        eventTime: firstEntry,
        minutesDiff: minutesLate,
        status: "late",
      });
    }
  }

  return results.sort((a, b) => (b.minutesDiff ?? 9999) - (a.minutesDiff ?? 9999));
}

export async function getEarlyDepartures(date: Date): Promise<WorkerReportEntry[]> {
  const graceMinutes = await getGraceMinutes("report_early_grace_minutes");
  const dateStr = todayDateString(date);
  const { start, end } = dayRange(date);

  const workers = await getActiveWorkersWithShifts();
  const onLeave = await getOnLeaveSet(dateStr);
  const workerIds = workers.map((w) => w.id).filter((id) => !onLeave.has(id));
  const vehicleMap = await getWorkerVehicleIds(workerIds);

  const results: WorkerReportEntry[] = [];

  for (const w of workers) {
    if (onLeave.has(w.id)) continue;

    const vehicleIds = vehicleMap.get(w.id) ?? [];
    const fullName = `${w.last_name} ${w.first_name}`;
    const shiftEndMin = parseHHMM(w.end_time!);

    if (vehicleIds.length === 0) continue;

    const [lastExit] = await db
      .select({ timestamp: accessEventsTable.timestamp })
      .from(accessEventsTable)
      .where(
        and(
          inArray(accessEventsTable.vehicle_id, vehicleIds),
          eq(accessEventsTable.event_type, "exit"),
          gte(accessEventsTable.timestamp, start),
          lte(accessEventsTable.timestamp, end),
        ),
      )
      .orderBy(desc(accessEventsTable.timestamp))
      .limit(1);

    if (!lastExit) continue;

    const exitMin = lastExit.timestamp.getHours() * 60 + lastExit.timestamp.getMinutes();
    const minutesEarly = shiftEndMin - exitMin;

    if (minutesEarly > graceMinutes) {
      results.push({
        workerId: w.id,
        fullName,
        position: w.position,
        department: w.dept_name ?? null,
        shiftName: w.shift_name!,
        shiftStart: w.start_time!,
        shiftEnd: w.end_time!,
        eventTime: lastExit.timestamp,
        minutesDiff: minutesEarly,
        status: "early",
      });
    }
  }

  return results.sort((a, b) => (b.minutesDiff ?? 0) - (a.minutesDiff ?? 0));
}
