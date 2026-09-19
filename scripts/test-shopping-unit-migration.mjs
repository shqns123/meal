import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meal-shopping-migration-"));
const dbPath = path.join(tempDir, "mealplan.db");
try {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE "ShoppingItem" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "name" TEXT NOT NULL,
      "unit" TEXT NOT NULL,
      "weekId" TEXT NOT NULL
    );
    CREATE UNIQUE INDEX "ShoppingItem_weekId_name_key"
      ON "ShoppingItem"("weekId", "name");
    INSERT INTO "ShoppingItem" ("id","name","unit","weekId")
      VALUES ('one','두부','모','week-one');
  `);
  db.close();

  const run = () => spawnSync(
    process.execPath,
    ["scripts/migrate-shopping-item-unit-key.mjs"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, MEAL_DB_PATH: dbPath },
    },
  );
  const first = run();
  assert.equal(first.status, 0, first.stderr || first.stdout);
  assert.match(first.stdout, /migration applied/);

  const migrated = new DatabaseSync(dbPath);
  const indexes = new Set(
    migrated.prepare(`PRAGMA index_list("ShoppingItem")`).all().map((index) => index.name),
  );
  assert.equal(indexes.has("ShoppingItem_weekId_name_key"), false);
  assert.equal(indexes.has("ShoppingItem_weekId_name_unit_key"), true);
  migrated.prepare(
    `INSERT INTO "ShoppingItem" ("id","name","unit","weekId") VALUES (?,?,?,?)`,
  ).run("two", "두부", "개", "week-one");
  assert.throws(() => migrated.prepare(
    `INSERT INTO "ShoppingItem" ("id","name","unit","weekId") VALUES (?,?,?,?)`,
  ).run("three", "두부", "모", "week-one"));
  migrated.close();

  assert.equal(fs.readdirSync(path.join(tempDir, "backups")).length, 1);
  const second = run();
  assert.equal(second.status, 0, second.stderr || second.stdout);
  assert.match(second.stdout, /already applied/);
  assert.equal(fs.readdirSync(path.join(tempDir, "backups")).length, 1);
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log("shopping item unit-key migration tests passed");
