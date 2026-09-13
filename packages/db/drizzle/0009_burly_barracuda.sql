CREATE TYPE "public"."request_kind" AS ENUM('feature', 'document_format', 'bug', 'other');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('new', 'planned', 'shipped', 'declined');--> statement-breakpoint
CREATE TABLE "feature_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "request_kind" DEFAULT 'feature' NOT NULL,
	"body" text NOT NULL,
	"status" "request_status" DEFAULT 'new' NOT NULL,
	"admin_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "feature_requests" ADD CONSTRAINT "feature_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feature_requests_status" ON "feature_requests" USING btree ("status","created_at");