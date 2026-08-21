CREATE TABLE "stored_item_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"item_id" integer NOT NULL,
	"action" text NOT NULL,
	"from_location" text,
	"to_location" text,
	"note" text,
	"actor_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stored_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"location" text NOT NULL,
	"note" text,
	"aliases" text,
	"status" text DEFAULT 'stored' NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"stored_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_found_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stored_item_history" ADD CONSTRAINT "stored_item_history_item_id_stored_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."stored_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stored_item_history" ADD CONSTRAINT "stored_item_history_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stored_items" ADD CONSTRAINT "stored_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stored_items" ADD CONSTRAINT "stored_items_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stored_item_history_item_idx" ON "stored_item_history" USING btree ("item_id","created_at");--> statement-breakpoint
CREATE INDEX "stored_items_name_idx" ON "stored_items" USING btree ("name");--> statement-breakpoint
CREATE INDEX "stored_items_updated_idx" ON "stored_items" USING btree ("updated_at");