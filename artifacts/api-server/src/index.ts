import app from "./app";
import { logger } from "./lib/logger";
import { seedDefaultUsers } from "./lib/seed";
import { startExpirySweep } from "./services/pin-sync";
import { startLockExpirySweep } from "./services/lock-sync";
import { startVehicleArchiveSweep } from "./services/vehicle-archive";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

seedDefaultUsers()
  .catch((err) => logger.warn({ err }, "Seed failed — continuing startup"))
  .finally(() => {
    app.listen(port, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }
      logger.info({ port }, "Server listening");
      // Housekeeping: revoke expired/orphaned PIN records from Hikvision
      // terminals every 5 minutes. See sweepExpiredPins for rationale.
      startExpirySweep();
      startLockExpirySweep();
      logger.info("PIN expiry sweep started (every 5 min)");
      // Phase 2 live: archive temporary reservation vehicles whose access
      // window (check_out + 1h grace) has fully closed by setting archived_at.
      // See services/vehicle-archive.ts.
      startVehicleArchiveSweep();
      logger.info("Vehicle archive sweep started (every 5 min, LIVE)");
    });
  });
