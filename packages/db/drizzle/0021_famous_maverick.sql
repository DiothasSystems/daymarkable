ALTER TABLE "meetings" ADD COLUMN "source_doc_id" text;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "source_page_id" text;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "source_gone" text;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "source_gone_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
-- A note dated more than a week after the night it was read is a misread date (merge.ts now guards
-- new notes against it). Such a note sorts above everything in the newest-first Notes notebook and is
-- never filed into a finished week, so it would sit on top until the misread date arrived. Re-date
-- the ones already stored to the day they were read.
UPDATE "meetings" SET "date" = ("created_at" AT TIME ZONE 'UTC')::date WHERE "date" > ("created_at" AT TIME ZONE 'UTC')::date + 7;
