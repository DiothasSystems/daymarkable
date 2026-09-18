CREATE TABLE "daily_puzzles" (
	"local_date" text NOT NULL,
	"kind" text NOT NULL,
	"words" jsonb NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_puzzles_local_date_kind_pk" PRIMARY KEY("local_date","kind")
);
