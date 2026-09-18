ALTER TABLE "events" ADD COLUMN "rrule" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "exdates" jsonb;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "ical_uid" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "ical_sequence" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "calendar_token" text;--> statement-breakpoint
CREATE UNIQUE INDEX "events_ical_uid" ON "events" USING btree ("user_id","ical_uid");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_calendar_token_unique" UNIQUE("calendar_token");