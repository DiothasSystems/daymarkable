CREATE TABLE "daily_briefs" (
	"local_date" text NOT NULL,
	"edition" text NOT NULL,
	"sections" jsonb NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_briefs_local_date_edition_pk" PRIMARY KEY("local_date","edition")
);
