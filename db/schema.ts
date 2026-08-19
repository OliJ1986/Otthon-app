import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  serial,
  text,
  time,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    username: text("username").notNull(),
    displayName: text("display_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("users_username_idx").on(table.username)],
);

export const sessions = pgTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("sessions_user_idx").on(table.userId), index("sessions_expiry_idx").on(table.expiresAt)],
);

export const familyMembers = pgTable(
  "family_members",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    tone: text("tone").notNull().default("violet"),
    memberType: text("member_type").notNull().default("child"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("family_members_name_idx").on(table.name)],
);

export const familyEvents = pgTable(
  "family_events",
  {
    id: serial("id").primaryKey(),
    date: date("date", { mode: "string" }).notNull(),
    startTime: time("start_time", { withTimezone: false }).notNull(),
    departureTime: time("departure_time", { withTimezone: false }),
    title: text("title").notNull(),
    person: text("person").notNull().default("Család"),
    driver: text("driver").notNull().default("Egyeztetésre vár"),
    place: text("place").notNull().default("Helyszín nélkül"),
    tone: text("tone").notNull().default("violet"),
    kind: text("kind").notNull().default("other"),
    repeatRule: text("repeat_rule").notNull().default("none"),
    reminderMinutes: integer("reminder_minutes").notNull().default(1440),
    reminderEnabled: boolean("reminder_enabled").notNull().default(true),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("family_events_date_idx").on(table.date)],
);

export const chores = pgTable("chores", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  room: text("room").notNull().default("Otthon"),
  assignee: text("assignee").notNull().default("Közös"),
  dueLabel: text("due_label").notNull().default("Ma"),
  repeatRule: text("repeat_rule").notNull().default("none"),
  done: boolean("done").notNull().default(false),
  completedOn: date("completed_on", { mode: "string" }),
  tone: text("tone").notNull().default("mint"),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const shoppingItems = pgTable("shopping_items", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  quantity: text("quantity").notNull().default("1 db"),
  category: text("category").notNull().default("Egyéb"),
  checked: boolean("checked").notNull().default(false),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("push_subscriptions_endpoint_idx").on(table.endpoint)],
);

export const notificationLog = pgTable(
  "notification_log",
  {
    id: serial("id").primaryKey(),
    notificationKey: text("notification_key").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("notification_log_key_idx").on(table.notificationKey)],
);

export const schemaVersion = pgTable("schema_version", {
  key: text("key").primaryKey().default("main"),
  migratedAt: timestamp("migrated_at", { withTimezone: true }).notNull().default(sql`now()`),
});
