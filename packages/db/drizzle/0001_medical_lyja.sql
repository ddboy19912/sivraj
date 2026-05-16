CREATE TABLE "wallet_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"chain" text DEFAULT 'sui' NOT NULL,
	"address" text NOT NULL,
	"is_primary" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "wallet_accounts" ADD CONSTRAINT "wallet_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wallet_accounts_user_id_idx" ON "wallet_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_accounts_chain_address_idx" ON "wallet_accounts" USING btree ("chain","address");