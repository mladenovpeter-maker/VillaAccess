CREATE TYPE leave_type AS ENUM ('vacation', 'sick', 'business_trip', 'other');

CREATE TABLE leaves (
  id          text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  worker_id   text        NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  type        leave_type  NOT NULL DEFAULT 'vacation',
  start_date  text        NOT NULL,
  end_date    text        NOT NULL,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX leaves_worker_idx ON leaves(worker_id);
CREATE INDEX leaves_dates_idx  ON leaves(start_date, end_date);
