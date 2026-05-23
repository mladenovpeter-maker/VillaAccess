-- 0000_init.sql — baseline schema generated from drizzle schema via drizzle-kit generate.
-- Hand-edited to be idempotent so it can be applied to fresh prod DBs and recorded as a no-op
-- on dev DBs that were bootstrapped via drizzle-kit push. Subsequent 0010+ migrations layer on top.

DO $$ BEGIN
  CREATE TYPE "public"."role" AS ENUM('admin', 'operator', 'viewer');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "public"."intercom_protocol" AS ENUM('hikvision', 'dahua', 'sip', 'generic');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "public"."intercom_status" AS ENUM('online', 'offline', 'error');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "public"."villa_status" AS ENUM('active', 'inactive', 'maintenance');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "public"."camera_protocol" AS ENUM('hikvision', 'dahua', 'onvif', 'rtsp');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "public"."camera_status" AS ENUM('online', 'offline', 'error');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "public"."vehicle_access_type" AS ENUM('reservation', 'permanent');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "public"."vehicle_status" AS ENUM('known', 'unknown', 'blacklisted');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "public"."vehicle_type" AS ENUM('sedan', 'suv', 'van', 'truck', 'motorcycle', 'other');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "public"."pin_sync_status" AS ENUM('pending', 'synced', 'failed', 'revoked', 'not_applicable');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "public"."reservation_status" AS ENUM('upcoming', 'active', 'completed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "public"."event_status" AS ENUM('allowed', 'denied', 'manual', 'pending');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "public"."event_type" AS ENUM('entry', 'exit', 'denied', 'manual_open', 'override');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "public"."action_type" AS ENUM('open_gate', 'open_door', 'close_gate', 'close_door');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "public"."triggered_by" AS ENUM('ai_auto', 'manual', 'schedule', 'api');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "public"."credential_status" AS ENUM('active', 'expired', 'revoked');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "public"."log_type" AS ENUM('access', 'denied', 'override', 'system', 'ai');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "users" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "role" DEFAULT 'operator' NOT NULL,
	"full_name" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);

CREATE TABLE IF NOT EXISTS "entrances" (
	"id" text PRIMARY KEY NOT NULL,
	"villa_id" text,
	"name" text NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "intercoms" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"entrance_id" text,
	"ip_address" text NOT NULL,
	"http_port" integer DEFAULT 80 NOT NULL,
	"username" text DEFAULT 'admin' NOT NULL,
	"password" text,
	"protocol" "intercom_protocol" DEFAULT 'hikvision' NOT NULL,
	"device_type" text,
	"relay_no" integer DEFAULT 1 NOT NULL,
	"door_count" integer DEFAULT 1,
	"lock_type" text,
	"pin_support" boolean DEFAULT true,
	"schedule_support" boolean DEFAULT false,
	"pin_sync_enabled" boolean DEFAULT true NOT NULL,
	"last_sync_status" text,
	"last_sync_at" timestamp,
	"status" "intercom_status" DEFAULT 'offline' NOT NULL,
	"last_status_check" timestamp,
	"last_status_latency_ms" integer,
	"device_info" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "villas" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"location" text,
	"status" "villa_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "cameras" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"ip_address" text NOT NULL,
	"rtsp_url" text,
	"entrance_id" text,
	"model" text,
	"protocol" "camera_protocol" DEFAULT 'hikvision' NOT NULL,
	"http_port" integer DEFAULT 80 NOT NULL,
	"username" text DEFAULT 'admin' NOT NULL,
	"password" text,
	"channel_no" integer DEFAULT 1 NOT NULL,
	"gate_no" integer DEFAULT 1 NOT NULL,
	"status" "camera_status" DEFAULT 'offline' NOT NULL,
	"last_snapshot" timestamp,
	"snapshot_url" text,
	"last_status_check" timestamp,
	"last_status_latency_ms" integer,
	"device_info" text,
	"ocr_enabled" boolean DEFAULT false NOT NULL,
	"polling_interval_ms" integer DEFAULT 1500 NOT NULL,
	"ocr_min_confidence" integer DEFAULT 70 NOT NULL,
	"anpr_cooldown_seconds" integer DEFAULT 30 NOT NULL,
	"last_anpr_plate" text,
	"last_anpr_at" timestamp,
	"allow_partial_match" boolean DEFAULT false NOT NULL,
	"partial_match_threshold" integer DEFAULT 85 NOT NULL,
	"partial_min_confidence" integer DEFAULT 50 NOT NULL,
	"min_matching_digits" integer DEFAULT 4 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "vehicle_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"vehicle_id" text NOT NULL,
	"access_event_id" text,
	"camera_id" text,
	"snapshot_url" text NOT NULL,
	"thumbnail_url" text,
	"plate_crop_url" text,
	"confidence_score" real,
	"ocr_text" text,
	"ai_annotations" jsonb,
	"is_primary" boolean DEFAULT false NOT NULL,
	"captured_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "vehicles" (
	"id" text PRIMARY KEY NOT NULL,
	"license_plate" text NOT NULL,
	"plate_region" text,
	"make" text,
	"model" text,
	"color" text,
	"vehicle_type" "vehicle_type",
	"owner_name" text,
	"ai_fingerprint" jsonb,
	"confidence_score" real,
	"status" "vehicle_status" DEFAULT 'unknown' NOT NULL,
	"access_type" "vehicle_access_type" DEFAULT 'reservation' NOT NULL,
	"blacklist_reason" text,
	"blacklisted_at" timestamp,
	"blacklisted_by" text,
	"first_seen" timestamp,
	"last_seen" timestamp,
	"total_visits" integer DEFAULT 0 NOT NULL,
	"snapshot_url" text,
	"thumbnail_url" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "vehicles_license_plate_unique" UNIQUE("license_plate")
);

CREATE TABLE IF NOT EXISTS "reservation_vehicles" (
	"reservation_id" text NOT NULL,
	"vehicle_id" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"guest_name" text NOT NULL,
	"guest_phone" text,
	"guest_email" text,
	"villa_id" text NOT NULL,
	"check_in" timestamp NOT NULL,
	"check_out" timestamp NOT NULL,
	"status" "reservation_status" DEFAULT 'upcoming' NOT NULL,
	"notes" text,
	"pin_code" text,
	"pin_valid_from" timestamp,
	"pin_valid_to" timestamp,
	"pin_sync_status" "pin_sync_status" DEFAULT 'pending' NOT NULL,
	"pin_last_synced_at" timestamp,
	"actual_check_in" timestamp,
	"actual_check_out" timestamp,
	"cancelled_at" timestamp,
	"cancelled_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "access_events" (
	"id" text PRIMARY KEY NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"event_type" "event_type" NOT NULL,
	"status" "event_status" NOT NULL,
	"confidence_score" real,
	"vehicle_id" text,
	"license_plate" text,
	"entrance_id" text,
	"camera_id" text,
	"snapshot_url" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "gate_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"entrance_id" text,
	"action_type" "action_type" NOT NULL,
	"triggered_by" "triggered_by" DEFAULT 'manual' NOT NULL,
	"operator_id" text,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"success" boolean DEFAULT true NOT NULL,
	"notes" text
);

CREATE TABLE IF NOT EXISTS "temp_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"reservation_id" text NOT NULL,
	"pin_code" text NOT NULL,
	"label" text,
	"notes" text,
	"valid_from" timestamp NOT NULL,
	"valid_until" timestamp NOT NULL,
	"status" "credential_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "logs" (
	"id" text PRIMARY KEY NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"log_type" "log_type" NOT NULL,
	"message" text NOT NULL,
	"vehicle_id" text,
	"villa_id" text,
	"operator_id" text,
	"snapshot_url" text,
	"confidence_score" real,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "refresh_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);

CREATE TABLE IF NOT EXISTS "domain_events" (
	"id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"category" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"payload" jsonb,
	"vehicle_id" text,
	"entrance_id" text,
	"camera_id" text,
	"reservation_id" text,
	"operator_id" text,
	"source" text DEFAULT 'api' NOT NULL,
	"ip_address" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "system_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"value_type" text DEFAULT 'string' NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"category" text DEFAULT 'general' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "system_settings_key_unique" UNIQUE("key")
);

DO $$ BEGIN
  ALTER TABLE "entrances" ADD CONSTRAINT "entrances_villa_id_villas_id_fk" FOREIGN KEY ("villa_id") REFERENCES "public"."villas"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "intercoms" ADD CONSTRAINT "intercoms_entrance_id_entrances_id_fk" FOREIGN KEY ("entrance_id") REFERENCES "public"."entrances"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "cameras" ADD CONSTRAINT "cameras_entrance_id_entrances_id_fk" FOREIGN KEY ("entrance_id") REFERENCES "public"."entrances"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "reservation_vehicles" ADD CONSTRAINT "reservation_vehicles_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "reservations" ADD CONSTRAINT "reservations_villa_id_villas_id_fk" FOREIGN KEY ("villa_id") REFERENCES "public"."villas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "access_events" ADD CONSTRAINT "access_events_entrance_id_entrances_id_fk" FOREIGN KEY ("entrance_id") REFERENCES "public"."entrances"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "access_events" ADD CONSTRAINT "access_events_camera_id_cameras_id_fk" FOREIGN KEY ("camera_id") REFERENCES "public"."cameras"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "gate_actions" ADD CONSTRAINT "gate_actions_entrance_id_entrances_id_fk" FOREIGN KEY ("entrance_id") REFERENCES "public"."entrances"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "gate_actions" ADD CONSTRAINT "gate_actions_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "temp_credentials" ADD CONSTRAINT "temp_credentials_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_camera_id_cameras_id_fk" FOREIGN KEY ("camera_id") REFERENCES "public"."cameras"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "entrances_villa_idx" ON "entrances" USING btree ("villa_id");

CREATE INDEX IF NOT EXISTS "intercoms_entrance_idx" ON "intercoms" USING btree ("entrance_id");

CREATE INDEX IF NOT EXISTS "intercoms_status_idx" ON "intercoms" USING btree ("status");

CREATE INDEX IF NOT EXISTS "cameras_entrance_idx" ON "cameras" USING btree ("entrance_id");

CREATE INDEX IF NOT EXISTS "cameras_status_idx" ON "cameras" USING btree ("status");

CREATE INDEX IF NOT EXISTS "cameras_protocol_idx" ON "cameras" USING btree ("protocol");

CREATE INDEX IF NOT EXISTS "vehicle_snapshots_vehicle_idx" ON "vehicle_snapshots" USING btree ("vehicle_id");

CREATE INDEX IF NOT EXISTS "vehicle_snapshots_event_idx" ON "vehicle_snapshots" USING btree ("access_event_id");

CREATE INDEX IF NOT EXISTS "vehicle_snapshots_captured_idx" ON "vehicle_snapshots" USING btree ("captured_at");

CREATE INDEX IF NOT EXISTS "vehicle_snapshots_primary_idx" ON "vehicle_snapshots" USING btree ("vehicle_id","is_primary");

CREATE INDEX IF NOT EXISTS "vehicles_status_idx" ON "vehicles" USING btree ("status");

CREATE INDEX IF NOT EXISTS "vehicles_last_seen_idx" ON "vehicles" USING btree ("last_seen");

CREATE INDEX IF NOT EXISTS "vehicles_plate_region_idx" ON "vehicles" USING btree ("plate_region");

CREATE INDEX IF NOT EXISTS "domain_events_category_idx" ON "domain_events" USING btree ("category");

CREATE INDEX IF NOT EXISTS "domain_events_event_type_idx" ON "domain_events" USING btree ("event_type");

CREATE INDEX IF NOT EXISTS "domain_events_severity_idx" ON "domain_events" USING btree ("severity");

CREATE INDEX IF NOT EXISTS "domain_events_vehicle_idx" ON "domain_events" USING btree ("vehicle_id");

CREATE INDEX IF NOT EXISTS "domain_events_entrance_idx" ON "domain_events" USING btree ("entrance_id");

CREATE INDEX IF NOT EXISTS "domain_events_camera_idx" ON "domain_events" USING btree ("camera_id");

CREATE INDEX IF NOT EXISTS "domain_events_created_idx" ON "domain_events" USING btree ("created_at");

CREATE INDEX IF NOT EXISTS "domain_events_source_idx" ON "domain_events" USING btree ("source");

CREATE INDEX IF NOT EXISTS "settings_key_idx" ON "system_settings" USING btree ("key");

CREATE INDEX IF NOT EXISTS "settings_category_idx" ON "system_settings" USING btree ("category");
