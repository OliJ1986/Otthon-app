CREATE TABLE "job_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_catalog" (
	"product_id" text NOT NULL,
	"product_name" text NOT NULL,
	"category_id" text NOT NULL,
	"category_name" text NOT NULL,
	"chain_name" text NOT NULL,
	"unit" text NOT NULL,
	"package_size" numeric(14, 4) NOT NULL,
	"min_price" numeric(14, 4) NOT NULL,
	"max_price" numeric(14, 4) NOT NULL,
	"min_unit_price" numeric(14, 4) NOT NULL,
	"max_unit_price" numeric(14, 4) NOT NULL,
	"store_count" integer NOT NULL,
	"total_stores" integer NOT NULL,
	"data_date" date NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_catalog_product_id_chain_name_pk" PRIMARY KEY("product_id","chain_name")
);
--> statement-breakpoint
CREATE TABLE "price_watch_history" (
	"watch_id" integer NOT NULL,
	"observed_on" date NOT NULL,
	"chain_name" text NOT NULL,
	"min_price" numeric(14, 4) NOT NULL,
	"min_unit_price" numeric(14, 4) NOT NULL,
	CONSTRAINT "price_watch_history_watch_id_observed_on_chain_name_pk" PRIMARY KEY("watch_id","observed_on","chain_name")
);
--> statement-breakpoint
CREATE TABLE "price_watches" (
	"id" serial PRIMARY KEY NOT NULL,
	"shopping_item_id" integer NOT NULL,
	"product_id" text NOT NULL,
	"target_price" numeric(14, 2),
	"notify_on_drop" boolean DEFAULT true NOT NULL,
	"last_notified_price" numeric(14, 2),
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "price_watch_history" ADD CONSTRAINT "price_watch_history_watch_id_price_watches_id_fk" FOREIGN KEY ("watch_id") REFERENCES "public"."price_watches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_watches" ADD CONSTRAINT "price_watches_shopping_item_id_shopping_items_id_fk" FOREIGN KEY ("shopping_item_id") REFERENCES "public"."shopping_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_watches" ADD CONSTRAINT "price_watches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "price_catalog_name_idx" ON "price_catalog" USING btree ("product_name");--> statement-breakpoint
CREATE INDEX "price_catalog_category_idx" ON "price_catalog" USING btree ("category_name");--> statement-breakpoint
CREATE UNIQUE INDEX "price_watches_shopping_item_idx" ON "price_watches" USING btree ("shopping_item_id");