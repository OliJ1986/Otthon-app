CREATE TABLE "external_price_observations" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"source" text NOT NULL,
	"source_product_id" text,
	"chain_name" text NOT NULL,
	"price" numeric(14, 2) NOT NULL,
	"promotion_price" numeric(14, 2),
	"promotion_label" text,
	"unit_price" numeric(14, 2),
	"unit" text,
	"observed_on" date NOT NULL,
	"valid_from" date,
	"valid_until" date,
	"source_url" text,
	"location_label" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_products" (
	"product_id" text PRIMARY KEY NOT NULL,
	"barcode" text,
	"product_name" text NOT NULL,
	"brand" text,
	"quantity" text,
	"package_size" numeric(14, 4),
	"unit" text,
	"category_name" text DEFAULT 'Egyéb' NOT NULL,
	"image_url" text,
	"source" text NOT NULL,
	"source_product_id" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shopping_items" ADD COLUMN "product_id" text;--> statement-breakpoint
ALTER TABLE "external_price_observations" ADD CONSTRAINT "external_price_observations_product_id_external_products_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."external_products"("product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_price_observations" ADD CONSTRAINT "external_price_observations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "external_price_daily_idx" ON "external_price_observations" USING btree ("product_id","source","chain_name","observed_on");--> statement-breakpoint
CREATE INDEX "external_price_product_idx" ON "external_price_observations" USING btree ("product_id","observed_on");--> statement-breakpoint
CREATE INDEX "external_products_name_idx" ON "external_products" USING btree ("product_name");--> statement-breakpoint
CREATE INDEX "external_products_barcode_idx" ON "external_products" USING btree ("barcode");