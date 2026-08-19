import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const globalForDb = globalThis as typeof globalThis & {
  otthonSql?: ReturnType<typeof postgres>;
};

export function getSql() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL nincs beállítva.");
  if (!globalForDb.otthonSql) {
    globalForDb.otthonSql = postgres(connectionString, {
      max: 5,
      idle_timeout: 20,
      connect_timeout: 15,
      prepare: false,
    });
  }
  return globalForDb.otthonSql;
}

export function getDb() {
  return drizzle(getSql(), { schema });
}
