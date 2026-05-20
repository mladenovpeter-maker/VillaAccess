import { Router, type IRouter } from "express";
import healthRouter from "./health";
import { authRouter } from "./auth";
import { dashboardRouter } from "./dashboard";
import { villasRouter } from "./villas";
import { reservationsRouter } from "./reservations";
import { vehiclesRouter } from "./vehicles";
import { accessRouter } from "./access";
import { camerasRouter } from "./cameras";
import { logsRouter } from "./logs";
import { snapshotsRouter } from "./snapshots";
import { eventsRouter } from "./events";
import { mockRouter } from "./mock";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/dashboard", dashboardRouter);
router.use("/villas", villasRouter);
router.use("/reservations", reservationsRouter);
router.use("/vehicles", vehiclesRouter);
router.use("/access", accessRouter);
router.use("/cameras", camerasRouter);
router.use("/logs", logsRouter);
router.use("/snapshots", snapshotsRouter);
router.use("/events", eventsRouter);
router.use("/mock", mockRouter);

export default router;
