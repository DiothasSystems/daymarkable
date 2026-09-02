CREATE TYPE "public"."account_status" AS ENUM('trial', 'active', 'past_due', 'canceled', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."document_kind" AS ENUM('planner', 'action_list', 'meeting_notes');--> statement-breakpoint
CREATE TYPE "public"."email_status" AS ENUM('sent', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."event_source" AS ENUM('ink', 'external');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('active', 'dropped');--> statement-breakpoint
CREATE TYPE "public"."inbox_kind" AS ENUM('task', 'event', 'meeting_request', 'margin_note');--> statement-breakpoint
CREATE TYPE "public"."inbox_status" AS ENUM('pending', 'accepted', 'dropped', 'expired');--> statement-breakpoint
CREATE TYPE "public"."meeting_request_state" AS ENUM('drafted', 'confirmed', 'sent', 'dropped');--> statement-breakpoint
CREATE TYPE "public"."printed_item_type" AS ENUM('task', 'inbox', 'meeting_request');--> statement-breakpoint
CREATE TYPE "public"."run_kind" AS ENUM('nightly', 'on_demand');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."task_kind" AS ENUM('action', 'follow_up');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('high', 'normal', 'low');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('open', 'carried', 'done', 'dropped');--> statement-breakpoint
CREATE TABLE "admin_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"admin_login_id" text NOT NULL,
	"action" text NOT NULL,
	"target_user_id" uuid,
	"detail" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_login_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"ip" text NOT NULL,
	"success" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doc_snapshots" (
	"user_id" uuid NOT NULL,
	"doc_id" text NOT NULL,
	"hash" text NOT NULL,
	"name" text NOT NULL,
	"path" text NOT NULL,
	"file_type" text NOT NULL,
	"last_modified" timestamp with time zone,
	"page_count" integer DEFAULT 0 NOT NULL,
	"last_run_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doc_snapshots_user_id_doc_id_pk" PRIMARY KEY("user_id","doc_id")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"kind" "document_kind" NOT NULL,
	"name" text NOT NULL,
	"cache_path" text NOT NULL,
	"bytes" integer NOT NULL,
	"page_count" integer NOT NULL,
	"tablet_doc_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"run_id" uuid,
	"idempotency_key" text NOT NULL,
	"to_email" text NOT NULL,
	"subject" text NOT NULL,
	"status" "email_status" NOT NULL,
	"provider_id" text,
	"error" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_log_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"date" date,
	"start_time" text,
	"end_time" text,
	"location" text,
	"people" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" "event_source" DEFAULT 'ink' NOT NULL,
	"confidence" real NOT NULL,
	"status" "event_status" DEFAULT 'active' NOT NULL,
	"created_run_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"run_id" uuid,
	"rating" integer NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbox_items" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "inbox_kind" NOT NULL,
	"text" text NOT NULL,
	"detail" text,
	"confidence" real NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "inbox_status" DEFAULT 'pending' NOT NULL,
	"source_notebook" text,
	"source_page_index" integer,
	"created_on" date NOT NULL,
	"created_run_id" uuid,
	"resolved_run_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"proposed_date" date,
	"proposed_time" text,
	"duration_minutes" integer,
	"attendees" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" real NOT NULL,
	"state" "meeting_request_state" DEFAULT 'drafted' NOT NULL,
	"confirmed_on" date,
	"created_run_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"date" date,
	"time" text,
	"attendees" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"body_enc" text NOT NULL,
	"confidence" real NOT NULL,
	"source_notebook" text,
	"source_page_index" integer,
	"created_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_snapshots" (
	"user_id" uuid NOT NULL,
	"doc_id" text NOT NULL,
	"page_id" text NOT NULL,
	"page_index" integer NOT NULL,
	"hash" text,
	"last_decoded_run_id" uuid,
	"page_kind" text,
	"confidence" real,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_snapshots_user_id_doc_id_page_id_pk" PRIMARY KEY("user_id","doc_id","page_id")
);
--> statement-breakpoint
CREATE TABLE "printed_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"page_code" text NOT NULL,
	"item_code" text NOT NULL,
	"item_type" "printed_item_type" NOT NULL,
	"item_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_costs" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"model" text NOT NULL,
	"mode" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"pages" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"kind" "run_kind" NOT NULL,
	"seq" integer DEFAULT 0 NOT NULL,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"requested_via" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error" text,
	"stats" jsonb,
	"cache_dir" text,
	"cache_purged_at" timestamp with time zone,
	"decode_model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tablet_credentials" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'remarkable_cloud' NOT NULL,
	"device_token_enc" text NOT NULL,
	"paired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_ok_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"text" text NOT NULL,
	"due" date,
	"due_time" text,
	"priority" "task_priority" DEFAULT 'normal' NOT NULL,
	"kind" "task_kind" DEFAULT 'action' NOT NULL,
	"project" text,
	"people" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" real NOT NULL,
	"source_convention" text,
	"source_notebook" text,
	"source_page_index" integer,
	"status" "task_status" DEFAULT 'open' NOT NULL,
	"carried_count" integer DEFAULT 0 NOT NULL,
	"last_aged_on" date,
	"created_on" date NOT NULL,
	"completed_on" date,
	"created_run_id" uuid,
	"updated_run_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"status" "account_status" DEFAULT 'trial' NOT NULL,
	"settings" jsonb NOT NULL,
	"onboarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "doc_snapshots" ADD CONSTRAINT "doc_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_log" ADD CONSTRAINT "email_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_requests" ADD CONSTRAINT "meeting_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_snapshots" ADD CONSTRAINT "page_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printed_items" ADD CONSTRAINT "printed_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printed_items" ADD CONSTRAINT "printed_items_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_costs" ADD CONSTRAINT "run_costs_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tablet_credentials" ADD CONSTRAINT "tablet_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_user_created" ON "documents" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "events_user_date" ON "events" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "feedback_user_created" ON "feedback" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "inbox_user_status" ON "inbox_items" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "meeting_requests_user_state" ON "meeting_requests" USING btree ("user_id","state");--> statement-breakpoint
CREATE INDEX "meetings_user_date" ON "meetings" USING btree ("user_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "printed_items_page_item" ON "printed_items" USING btree ("user_id","page_code","item_code","run_id");--> statement-breakpoint
CREATE INDEX "run_costs_user_created" ON "run_costs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "runs_user_date_kind_seq" ON "runs" USING btree ("user_id","local_date","kind","seq");--> statement-breakpoint
CREATE INDEX "runs_user_created" ON "runs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "tasks_user_status" ON "tasks" USING btree ("user_id","status");