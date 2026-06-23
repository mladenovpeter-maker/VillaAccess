-- 0025_departments.sql
-- Introduces a departments table with an optional default shift.
-- Workers get a department_id FK; existing 'Makmetal' text value is migrated.

CREATE TABLE IF NOT EXISTS departments (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name        TEXT NOT NULL UNIQUE,
  default_shift_id TEXT REFERENCES shifts(id) ON DELETE SET NULL,
  notes       TEXT,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

ALTER TABLE workers ADD COLUMN IF NOT EXISTS department_id TEXT REFERENCES departments(id) ON DELETE SET NULL;

-- Migrate existing unique department names to rows
INSERT INTO departments (name)
SELECT DISTINCT department
FROM workers
WHERE department IS NOT NULL AND department <> ''
ON CONFLICT (name) DO NOTHING;

-- Link workers to their new department row
UPDATE workers
SET department_id = d.id
FROM departments d
WHERE workers.department = d.name
  AND workers.department_id IS NULL;
