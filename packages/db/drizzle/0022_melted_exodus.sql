CREATE TABLE "daily_notes" (
	"user_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"doc_id" text NOT NULL,
	"page_id" text NOT NULL,
	"notebook" text NOT NULL,
	"page_index" integer NOT NULL,
	"body_enc" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_notes_user_id_local_date_doc_id_page_id_pk" PRIMARY KEY("user_id","local_date","doc_id","page_id")
);
--> statement-breakpoint
CREATE TABLE "page_readings" (
	"user_id" uuid NOT NULL,
	"doc_id" text NOT NULL,
	"page_id" text NOT NULL,
	"lines" jsonb NOT NULL,
	"updated_run_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_readings_user_id_doc_id_page_id_pk" PRIMARY KEY("user_id","doc_id","page_id")
);
--> statement-breakpoint
ALTER TABLE "daily_notes" ADD CONSTRAINT "daily_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_readings" ADD CONSTRAINT "page_readings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;