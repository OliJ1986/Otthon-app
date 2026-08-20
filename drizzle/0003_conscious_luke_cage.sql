ALTER TABLE "chores" ADD COLUMN "due_date" date DEFAULT (now() AT TIME ZONE 'Europe/Budapest')::date NOT NULL;--> statement-breakpoint
UPDATE "chores"
SET "due_date" = CASE
	WHEN "repeat_rule" = 'daily' AND "completed_on" IS NOT NULL THEN "completed_on" + 1
	WHEN "repeat_rule" = 'weekly' AND "completed_on" IS NOT NULL THEN "completed_on" + 7
	WHEN "repeat_rule" = 'monthly' AND "completed_on" IS NOT NULL THEN ("completed_on" + interval '1 month')::date
	ELSE "due_date"
END;--> statement-breakpoint
CREATE INDEX "chores_due_idx" ON "chores" USING btree ("done","due_date");
