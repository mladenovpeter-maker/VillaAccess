import { Router, type IRouter } from "express";
import healthRouter from "./health";
import { authRouter, requireAuth, requireRole, requireWriteAccess } from "./auth";
import { dashboardRouter } from "./dashboard";
import { entrancesRouter } from "./entrances";
import { intercomsRouter } from "./intercoms";
import { vehiclesRouter } from "./vehicles";
import { accessRouter } from "./access";
import { camerasRouter } from "./cameras";
import { anprRouter } from "./anpr";
import { logsRouter } from "./logs";
import { snapshotsRouter } from "./snapshots";
import { eventsRouter } from "./events";
import { mockRouter } from "./mock";
import { settingsRouter } from "./settings";
import { diagnosticsRouter } from "./diagnostics";
import { exportRouter } from "./export";
import { usersRouter } from "./users";
import { aiUsageRouter } from "./ai-usage";
import { workersRouter } from "./workers";
import { shiftsRouter } from "./shifts";
import { accessRulesRouter } from "./access-rules";
import { acsRouter } from "./acs";

const router: IRouter = Router();

const adminOnly   = requireRole("admin");
const writeAccess = requireWriteAccess();

// Public
router.use(healthRouter);
router.use("/auth", authRouter);

// All authenticated — read-only viewers, write blocked for viewer
router.use("/dashboard",     requireAuth,                  dashboardRouter);
router.use("/access",        requireAuth,  writeAccess,    accessRouter);
// NOTE: no blanket requireAuth here. The SSE endpoint /events/stream
// authenticates via a ?token= query param (EventSource cannot send the
// Authorization header), and the other routes (/events, /events/stats)
// apply requireAuth individually inside the router. A blanket requireAuth
// would 401 the SSE stream and leave the live feed stuck "connecting".
router.use("/events",                                      eventsRouter);
router.use("/logs",          requireAuth,                  logsRouter);
router.use("/snapshots",     requireAuth,                  snapshotsRouter);

// All authenticated — viewer read-only (GET allowed, writes blocked)
router.use("/vehicles",      requireAuth,  writeAccess,    vehiclesRouter);

// Admin only
router.use("/entrances",        requireAuth, adminOnly, entrancesRouter);
// Intercoms / cameras: list+status readable to all authed users
// (Quick Controls page needs them); write/test routes are admin-guarded
// per-route inside each router, and the trigger actions
// (POST /intercoms/:id/open, POST /cameras/:id/gate) are intentionally
// open to operator + admin.
router.use("/intercoms",        requireAuth, intercomsRouter);
router.use("/cameras",          requireAuth, camerasRouter);
router.use("/diagnostics",      requireAuth, adminOnly, diagnosticsRouter);
router.use("/settings",         requireAuth, adminOnly, settingsRouter);
router.use("/export",           requireAuth, adminOnly, exportRouter);
router.use("/users",            requireAuth, adminOnly,   usersRouter);
router.use("/ai-usage",         requireAuth, adminOnly,   aiUsageRouter);
router.use("/mock",             requireAuth, adminOnly,   mockRouter);
router.use("/workers",          requireAuth, writeAccess, workersRouter);
router.use("/shifts",           requireAuth, adminOnly,   shiftsRouter);
router.use("/access-rules",     requireAuth, adminOnly,   accessRulesRouter);
router.use("/acs",              requireAuth, adminOnly,   acsRouter);

// ANPR — worker-token-authed (no user session). Mounted last to avoid
// any accidental requireAuth middleware inheritance.
router.use("/anpr", anprRouter);

export default router;
