import { Router, type IRouter } from "express";
import healthRouter from "./health";
import { authRouter, requireAuth, requireRole } from "./auth";
import { dashboardRouter } from "./dashboard";
import { entrancesRouter } from "./entrances";
import { intercomsRouter } from "./intercoms";
import { villasRouter } from "./villas";
import { reservationsRouter } from "./reservations";
import { vehiclesRouter } from "./vehicles";
import { accessRouter } from "./access";
import { camerasRouter } from "./cameras";
import { logsRouter } from "./logs";
import { snapshotsRouter } from "./snapshots";
import { eventsRouter } from "./events";
import { mockRouter } from "./mock";
import { settingsRouter } from "./settings";
import { diagnosticsRouter } from "./diagnostics";
import { exportRouter } from "./export";
import { usersRouter } from "./users";
import { tempCredentialsRouter } from "./temp-credentials";

const router: IRouter = Router();

const adminOnly   = requireRole("admin");
const opOrAbove   = requireRole("admin", "operator");

// Public
router.use(healthRouter);
router.use("/auth", authRouter);

// All authenticated users (admin + operator + viewer)
router.use("/dashboard",     requireAuth,             dashboardRouter);
router.use("/access",        requireAuth,             accessRouter);
router.use("/events",        requireAuth,             eventsRouter);
router.use("/logs",          requireAuth,             logsRouter);
router.use("/snapshots",     requireAuth,             snapshotsRouter);

// Operator and above (admin + operator)
router.use("/villas",        requireAuth, opOrAbove,  villasRouter);
router.use("/reservations",  requireAuth, opOrAbove,  reservationsRouter);
router.use("/vehicles",      requireAuth, opOrAbove,  vehiclesRouter);

// Admin only
router.use("/entrances",        requireAuth, adminOnly, entrancesRouter);
router.use("/intercoms",        requireAuth, adminOnly, intercomsRouter);
router.use("/cameras",          requireAuth, adminOnly, camerasRouter);
router.use("/diagnostics",      requireAuth, adminOnly, diagnosticsRouter);
router.use("/settings",         requireAuth, adminOnly, settingsRouter);
router.use("/export",           requireAuth, adminOnly, exportRouter);
router.use("/users",            requireAuth, adminOnly, usersRouter);
router.use("/temp-credentials", requireAuth, adminOnly, tempCredentialsRouter);
router.use("/mock",             requireAuth, adminOnly, mockRouter);

export default router;
