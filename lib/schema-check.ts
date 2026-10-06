import { prisma } from "./db";

// Columns added after the first release, with the SQL that adds each one.
// If a deploy lands before the SQL has been run, the app shows this SQL
// instead of crashing on the first query that touches a missing column.
// Add new entries here whenever prisma/schema.prisma gains a column.
export const SCHEMA_UPDATES: { table: string; column: string; sql: string }[] = [
  { table: "RankCheck", column: "error", sql: `ALTER TABLE "RankCheck" ADD COLUMN IF NOT EXISTS "error" TEXT;` },
  {
    table: "Settings",
    column: "serpProvider",
    sql: `ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "serpProvider" TEXT NOT NULL DEFAULT 'brightdata';`,
  },
  {
    table: "Settings",
    column: "scrapingRobotToken",
    sql: `ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "scrapingRobotToken" TEXT;`,
  },
  {
    table: "Settings",
    column: "scrapingRobotRender",
    sql: `ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "scrapingRobotRender" BOOLEAN NOT NULL DEFAULT false;`,
  },
  { table: "Domain", column: "gscSiteUrl", sql: `ALTER TABLE "Domain" ADD COLUMN IF NOT EXISTS "gscSiteUrl" TEXT;` },
  { table: "Keyword", column: "serpSnapshot", sql: `ALTER TABLE "Keyword" ADD COLUMN IF NOT EXISTS "serpSnapshot" JSONB;` },
];

// Once the schema is confirmed up to date, a warm server instance never
// checks again.
let confirmedOk = false;

/** SQL statements still needed, or [] when the database is up to date (or the check itself can't run). */
export async function pendingSchemaSql(): Promise<string[]> {
  if (confirmedOk) return [];
  try {
    const rows = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name IN ('RankCheck', 'Settings', 'Domain', 'Keyword')`;
    const have = new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));
    const missing = SCHEMA_UPDATES.filter((u) => !have.has(`${u.table}.${u.column}`)).map((u) => u.sql);
    if (missing.length === 0) confirmedOk = true;
    return missing;
  } catch (err) {
    // Never block the app because the check failed — just log it.
    console.error("Schema check failed:", err);
    return [];
  }
}
