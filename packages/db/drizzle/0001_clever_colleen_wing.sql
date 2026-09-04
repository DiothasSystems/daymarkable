CREATE TYPE "public"."calibration_status" AS ENUM('pending', 'captured', 'skipped');--> statement-breakpoint
CREATE TABLE "calibrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "calibration_status" DEFAULT 'pending' NOT NULL,
	"expected_text" text NOT NULL,
	"notebook_name" text NOT NULL,
	"tablet_doc_id" text,
	"sample_image_enc" text,
	"transcribed_text" text,
	"accuracy" real,
	"captured_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"captured_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "corrections" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"item_type" text NOT NULL,
	"item_id" text NOT NULL,
	"original_text" text NOT NULL,
	"corrected_text" text NOT NULL,
	"learned_terms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calibrations" ADD CONSTRAINT "calibrations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrections" ADD CONSTRAINT "corrections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calibrations_user" ON "calibrations" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "corrections_user_created" ON "corrections" USING btree ("user_id","created_at");