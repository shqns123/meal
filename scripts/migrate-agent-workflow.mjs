import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const dbPath = process.env.MEAL_DB_PATH ?? path.join(process.cwd(), "data", "mealplan.db");
const db = new DatabaseSync(dbPath);
db.exec(`
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = DELETE;
PRAGMA busy_timeout = 5000;
CREATE TABLE IF NOT EXISTS "AgentJob" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "weekStart" DATETIME NOT NULL,
  "action" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "inputPath" TEXT,
  "summary" TEXT,
  "error" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" DATETIME
);
CREATE INDEX IF NOT EXISTS "AgentJob_weekStart_createdAt_idx" ON "AgentJob"("weekStart", "createdAt");
`);
const recipeColumns = new Set(db.prepare('PRAGMA table_info("Recipe")').all().map((column) => column.name));
for (const [name, type] of [
  ["sourceTitle", "TEXT"],
  ["sourceAuthor", "TEXT"],
  ["sourceDomain", "TEXT"],
  ["sourceCheckedAt", "DATETIME"],
]) {
  if (!recipeColumns.has(name)) db.exec(`ALTER TABLE "Recipe" ADD COLUMN "${name}" ${type}`);
}
db.close();
console.log(`Agent workflow and recipe source schema are ready: ${dbPath}`);
