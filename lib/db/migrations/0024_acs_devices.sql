-- 0024_acs_devices.sql
-- Adds Hikvision template_no to shifts and seeds the 3 ASC3202B access controllers.

-- ── Shift → Hikvision time-template number ────────────────────────────────────
-- Template 1 is reserved by the device as "always" (24/7).
-- Our custom shifts start at 2.
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS hik_template_no INTEGER;

-- Assign stable template numbers to any existing shifts (starting from 2).
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) + 1 AS tno
  FROM shifts
  WHERE hik_template_no IS NULL
)
UPDATE shifts
SET hik_template_no = numbered.tno
FROM numbered
WHERE shifts.id = numbered.id;

-- ── Seed the three ASC3202B controllers ──────────────────────────────────────
-- IPs: Сграда Администрация → .166, Врата Управител → .167, Турникет → .168
-- password left NULL — operator must set via Intercoms page before first sync.
INSERT INTO intercoms (
  id, name, entrance_id,
  ip_address, http_port, username, password,
  protocol, device_type,
  relay_no, door_count,
  pin_support, schedule_support, pin_sync_enabled
)
SELECT
  gen_random_uuid()::text,
  'ASC3202B — ' || e.name,
  e.id,
  CASE e.name
    WHEN 'Сграда Администрация' THEN '192.168.0.166'
    WHEN 'Врата Управител'      THEN '192.168.0.167'
    WHEN 'Турникет'             THEN '192.168.0.168'
  END,
  80, 'admin', NULL,
  'hikvision', 'ASC3202B',
  1, 2,
  false, true, false
FROM entrances e
WHERE e.name IN ('Сграда Администрация', 'Врата Управител', 'Турникет')
  AND NOT EXISTS (
    SELECT 1 FROM intercoms i
    WHERE i.entrance_id = e.id
      AND i.device_type = 'ASC3202B'
  );
