CREATE TABLE "device_logins" (
	"secret_hash" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"session_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "client" text;--> statement-breakpoint
ALTER TABLE "device_logins" ADD CONSTRAINT "device_logins_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_logins_token" ON "device_logins" USING btree ("token_hash");