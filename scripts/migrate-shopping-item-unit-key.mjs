import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = process.env.MEAL_PLAN_ROOT ?? process.cwd();
const dbPath = process.env.MEAL_DB_PATH ?? path.join(root, "data", "mealplan.db");

if (!fs.existsSync(dbPath)) {
  console.log(`Shopping item unit-key migration skipped; database does not exist yet: ${dbPath}`);
  process.exit(0);
}

let db = new DatabaseSync(dbPath);
db.exec("PRAGMA busy_timeout = 5000;");
const shoppingTable = db.prepare(
  `SELECT 1 AS "exists" FROM "sqlite_master" WHERE "type"='table' AND "name"='ShoppingItem'`,
).get();
if (!shoppingTable) {
  db.close();
  console.log(`Shopping item unit-key migration skipped; table does not exist yet: ${dbPath}`);
  process.exit(0);
}

const indexes = new Set(
  db.prepare(`PRAGMA index_list("ShoppingItem")`).all().map((index) => index.name),
);
const oldIndex = "ShoppingItem_weekId_name_key";
const newIndex = "ShoppingItem_weekId_name_unit_key";
if (indexes.has(newIndex) && !indexes.has(oldIndex)) {
  db.close();
  console.log(`Shopping item unit-key migration already applied: ${dbPath}`);
  process.exit(0);
}

const duplicates = db.prepare(
  `SELECT "weekId","name","unit",COUNT(*) AS "count"
   FROM "ShoppingItem"
   GROUP BY "weekId","name","unit"
   HAVING COUNT(*) > 1
   LIMIT 10`,
).all();
db.close();
if (duplicates.length) {
  throw new Error(
    `ShoppingItem has duplicate week/name/unit rows; migration stopped: ${JSON.stringify(duplicates)}`,
  );
}

const backupDir = path.join(path.dirname(dbPath), "backups");
fs.mkdirSync(backupDir, { recursive: true });
const backupPath = path.join(
  backupDir,
  `mealplan-before-shopping-unit-key-${new Date().toISOString().replace(/[:.]/g, "-")}.db`,
);
fs.copyFileSync(dbPath, backupPath, fs.constants.COPYFILE_EXCL);

db = new DatabaseSync(dbPath);
db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE;");
try {
  db.exec(`
    DROP INDEX IF EXISTS "${oldIndex}";
    CREATE UNIQUE INDEX IF NOT EXISTS "${newIndex}"
      ON "ShoppingItem"("weekId", "name", "unit");
  `);
  db.exec("COMMIT");
} catch (error) {
  try { db.exec("ROLLBACK"); } catch {}
  throw error;
} finally {
  db.close();
}

console.log(`Shopping item unit-key migration applied: ${dbPath}`);
console.log(`Database backup: ${backupPath}`);
