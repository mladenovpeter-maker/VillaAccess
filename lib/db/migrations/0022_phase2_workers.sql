-- Phase 2: Workers, shifts, and access rules
-- workers         — employee registry
-- shifts          — named time windows (HH:MM + days)
-- access_rules    — which worker can enter which entrance, optionally restricted to a shift
-- worker_vehicles — links a vehicle to a worker (many-to-many)

CREATE TABLE IF NOT EXISTS workers (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  employee_number TEXT UNIQUE,
  first_name      TEXT NOT NULL,
  last_name       TEXT NOT NULL,
  position        TEXT,
  department      TEXT,
  phone           TEXT,
  email           TEXT,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shifts (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name         TEXT NOT NULL,
  start_time   TEXT NOT NULL,  -- HH:MM  (24-h)
  end_time     TEXT NOT NULL,  -- HH:MM  (24-h)
  days_of_week JSONB NOT NULL DEFAULT '[0,1,2,3,4,5,6]'::jsonb,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS access_rules (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  worker_id   TEXT NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  entrance_id TEXT NOT NULL REFERENCES entrances(id) ON DELETE CASCADE,
  shift_id    TEXT REFERENCES shifts(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (worker_id, entrance_id)
);

CREATE TABLE IF NOT EXISTS worker_vehicles (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  worker_id  TEXT NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (worker_id, vehicle_id)
);

CREATE INDEX IF NOT EXISTS workers_active_idx        ON workers(active);
CREATE INDEX IF NOT EXISTS access_rules_worker_idx   ON access_rules(worker_id);
CREATE INDEX IF NOT EXISTS access_rules_entrance_idx ON access_rules(entrance_id);
CREATE INDEX IF NOT EXISTS worker_vehicles_worker_idx  ON worker_vehicles(worker_id);
CREATE INDEX IF NOT EXISTS worker_vehicles_vehicle_idx ON worker_vehicles(vehicle_id);
