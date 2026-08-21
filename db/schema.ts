import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
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
  dueDate: date("due_date", { mode: "string" }).notNull().default(sql`(now() AT TIME ZONE 'Europe/Budapest')::date`),
  repeatRule: text("repeat_rule").notNull().default("none"),
  done: boolean("done").notNull().default(false),
  completedOn: date("completed_on", { mode: "string" }),
  tone: text("tone").notNull().default("mint"),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("chores_due_idx").on(table.done, table.dueDate)]);

export const shoppingItems = pgTable("shopping_items", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  quantity: text("quantity").notNull().default("1 db"),
  category: text("category").notNull().default("Egyéb"),
  productId: text("product_id"),
  checked: boolean("checked").notNull().default(false),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const externalProducts = pgTable(
  "external_products",
  {
    productId: text("product_id").primaryKey(),
    barcode: text("barcode"),
    productName: text("product_name").notNull(),
    brand: text("brand"),
    quantity: text("quantity"),
    packageSize: numeric("package_size", { precision: 14, scale: 4 }),
    unit: text("unit"),
    categoryName: text("category_name").notNull().default("Egyéb"),
    imageUrl: text("image_url"),
    source: text("source").notNull(),
    sourceProductId: text("source_product_id"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("external_products_name_idx").on(table.productName),
    index("external_products_barcode_idx").on(table.barcode),
  ],
);

export const externalPriceObservations = pgTable(
  "external_price_observations",
  {
    id: serial("id").primaryKey(),
    productId: text("product_id").notNull().references(() => externalProducts.productId, { onDelete: "cascade" }),
    source: text("source").notNull(),
    sourceProductId: text("source_product_id"),
    chainName: text("chain_name").notNull(),
    price: numeric("price", { precision: 14, scale: 2 }).notNull(),
    promotionPrice: numeric("promotion_price", { precision: 14, scale: 2 }),
    promotionLabel: text("promotion_label"),
    unitPrice: numeric("unit_price", { precision: 14, scale: 2 }),
    unit: text("unit"),
    observedOn: date("observed_on", { mode: "string" }).notNull(),
    validFrom: date("valid_from", { mode: "string" }),
    validUntil: date("valid_until", { mode: "string" }),
    sourceUrl: text("source_url"),
    locationLabel: text("location_label"),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("external_price_daily_idx").on(table.productId, table.source, table.chainName, table.observedOn),
    index("external_price_product_idx").on(table.productId, table.observedOn),
  ],
);

export const priceCatalog = pgTable(
  "price_catalog",
  {
    productId: text("product_id").notNull(),
    productName: text("product_name").notNull(),
    categoryId: text("category_id").notNull(),
    categoryName: text("category_name").notNull(),
    chainName: text("chain_name").notNull(),
    unit: text("unit").notNull(),
    packageSize: numeric("package_size", { precision: 14, scale: 4 }).notNull(),
    minPrice: numeric("min_price", { precision: 14, scale: 4 }).notNull(),
    maxPrice: numeric("max_price", { precision: 14, scale: 4 }).notNull(),
    minUnitPrice: numeric("min_unit_price", { precision: 14, scale: 4 }).notNull(),
    maxUnitPrice: numeric("max_unit_price", { precision: 14, scale: 4 }).notNull(),
    storeCount: integer("store_count").notNull(),
    totalStores: integer("total_stores").notNull(),
    dataDate: date("data_date", { mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.productId, table.chainName] }),
    index("price_catalog_name_idx").on(table.productName),
    index("price_catalog_category_idx").on(table.categoryName),
  ],
);

export const priceWatches = pgTable(
  "price_watches",
  {
    id: serial("id").primaryKey(),
    shoppingItemId: integer("shopping_item_id").notNull().references(() => shoppingItems.id, { onDelete: "cascade" }),
    productId: text("product_id").notNull(),
    targetPrice: numeric("target_price", { precision: 14, scale: 2 }),
    notifyOnDrop: boolean("notify_on_drop").notNull().default(true),
    lastNotifiedPrice: numeric("last_notified_price", { precision: 14, scale: 2 }),
    createdBy: integer("created_by").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("price_watches_shopping_item_idx").on(table.shoppingItemId)],
);

export const priceWatchHistory = pgTable(
  "price_watch_history",
  {
    watchId: integer("watch_id").notNull().references(() => priceWatches.id, { onDelete: "cascade" }),
    observedOn: date("observed_on", { mode: "string" }).notNull(),
    chainName: text("chain_name").notNull(),
    minPrice: numeric("min_price", { precision: 14, scale: 4 }).notNull(),
    minUnitPrice: numeric("min_unit_price", { precision: 14, scale: 4 }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.watchId, table.observedOn, table.chainName] })],
);

export const jobState = pgTable("job_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const weatherSettings = pgTable("weather_settings", {
  id: integer("id").primaryKey().default(1),
  cityName: text("city_name").notNull().default("Tatabánya"),
  countryName: text("country_name").notNull().default("Magyarország"),
  adminArea: text("admin_area"),
  latitude: numeric("latitude", { precision: 8, scale: 5 }).notNull().default("47.58494"),
  longitude: numeric("longitude", { precision: 8, scale: 5 }).notNull().default("18.39325"),
  timezone: text("timezone").notNull().default("Europe/Budapest"),
  updatedBy: integer("updated_by").references(() => users.id, { onDelete: "set null" }),
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
