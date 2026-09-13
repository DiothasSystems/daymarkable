CREATE TABLE "ops_settings" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"anthropic_balance_usd" numeric(12, 2),
	"balance_as_of" timestamp with time zone,
	"warn_days" integer DEFAULT 14 NOT NULL,
	"warn_email" text DEFAULT 'diothassystems@gmail.com' NOT NULL,
	"last_warned_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
