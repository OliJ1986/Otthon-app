CREATE TABLE "weather_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"city_name" text DEFAULT 'Tatabánya' NOT NULL,
	"country_name" text DEFAULT 'Magyarország' NOT NULL,
	"admin_area" text,
	"latitude" numeric(8, 5) DEFAULT '47.58494' NOT NULL,
	"longitude" numeric(8, 5) DEFAULT '18.39325' NOT NULL,
	"timezone" text DEFAULT 'Europe/Budapest' NOT NULL,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "weather_settings" ADD CONSTRAINT "weather_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;