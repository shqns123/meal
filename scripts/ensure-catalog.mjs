#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import { catalogCounts } from "./catalog-seed.mjs";

const root = process.env.MEAL_PLAN_ROOT ?? process.cwd();
const catalogPath = process.env.MEAL_CATALOG_DB_PATH ?? path.join(root, "data", "10000recipe-catalog.db");
const seedPath = path.join(root, "seed", "10000recipe-catalog.db.gz");

let existingCounts = null;
let invalidBackup = null;
if (fs.existsSync(catalogPath)) {
  try { existingCounts = catalogCounts(catalogPath); }
  catch (error) {
    if (!fs.existsSync(seedPath)) throw error;
    invalidBackup = `${catalogPath}.invalid-${Date.now()}`;
    fs.copyFileSync(catalogPath, invalidBackup, fs.constants.COPYFILE_EXCL);
    fs.unlinkSync(catalogPath);
    console.warn(`읽을 수 없는 카탈로그를 ${invalidBackup}에 보관하고 초기 카탈로그를 설치합니다: ${error.message}`);
  }
}
if (existingCounts) {
  const recipesAdded = mergeSeedRecipes();
  console.log(JSON.stringify({ catalogPath, created: false, recipesAdded, ...existingCounts }));
} else {
  if (!fs.existsSync(seedPath)) throw new Error(`초기 카탈로그가 없습니다: ${seedPath}`);
  fs.mkdirSync(path.dirname(catalogPath), { recursive: true });
  const temporaryPath = `${catalogPath}.initializing-${process.pid}`;
  try {
    fs.writeFileSync(temporaryPath, gunzipSync(fs.readFileSync(seedPath)), { flag: "wx" });
    const counts = catalogCounts(temporaryPath);
    if (!fs.existsSync(catalogPath)) fs.renameSync(temporaryPath, catalogPath);
    else fs.unlinkSync(temporaryPath);
    console.log(JSON.stringify({ catalogPath, created: true, invalidBackup, ...counts }));
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
}

function mergeSeedRecipes() {
  if (!fs.existsSync(seedPath)) return 0;
  const seed = new DatabaseSync(":memory:");
  const catalog = new DatabaseSync(catalogPath);
  try {
    seed.deserialize(gunzipSync(fs.readFileSync(seedPath)));
    if (!seed.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='RecipeCatalogRecipe'").get()) return 0;
    const hasTable = catalog.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='RecipeCatalogRecipe'").get();
    const rows = seed.prepare('SELECT * FROM "RecipeCatalogRecipe"').all();
    const existingNames = new Set(hasTable
      ? catalog.prepare('SELECT "variantName" FROM "RecipeCatalogRecipe"').all().map((row) => row.variantName)
      : []);
    const missingRows = rows.filter((row) => !existingNames.has(row.variantName));
    if (!missingRows.length) return 0;
    const backupPath = `${catalogPath}.before-recipe-merge-${Date.now()}.db`;
    fs.copyFileSync(catalogPath, backupPath, fs.constants.COPYFILE_EXCL);
    catalog.exec("BEGIN IMMEDIATE");
    try {
      catalog.exec(`CREATE TABLE IF NOT EXISTS "RecipeCatalogRecipe" (
        "id" TEXT PRIMARY KEY, "variantName" TEXT NOT NULL UNIQUE,
        "sourceUrl" TEXT NOT NULL, "sourceTitle" TEXT NOT NULL,
        "sourceAuthor" TEXT, "servingsText" TEXT, "durationText" TEXT,
        "difficulty" TEXT, "ingredientGroups" TEXT NOT NULL,
        "instructions" TEXT NOT NULL, "sourceOrigin" TEXT NOT NULL,
        "matchScore" INTEGER NOT NULL, "sourceCheckedAt" INTEGER NOT NULL,
        "fetchedAt" INTEGER NOT NULL
      )`);
      catalog.exec('CREATE INDEX IF NOT EXISTS "RecipeCatalogRecipe_sourceUrl" ON "RecipeCatalogRecipe"("sourceUrl")');
      const insert = catalog.prepare(`INSERT OR IGNORE INTO "RecipeCatalogRecipe"
        ("id","variantName","sourceUrl","sourceTitle","sourceAuthor","servingsText","durationText","difficulty","ingredientGroups","instructions","sourceOrigin","matchScore","sourceCheckedAt","fetchedAt")
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      let added = 0;
      for (const row of missingRows) {
        added += insert.run(row.id, row.variantName, row.sourceUrl, row.sourceTitle,
          row.sourceAuthor, row.servingsText, row.durationText, row.difficulty,
          row.ingredientGroups, row.instructions, row.sourceOrigin, row.matchScore,
          row.sourceCheckedAt, row.fetchedAt).changes;
      }
      catalog.exec("COMMIT");
      console.warn(`카탈로그 레시피 ${added}개를 보충했습니다. 백업: ${backupPath}`);
      return added;
    } catch (error) {
      catalog.exec("ROLLBACK");
      throw error;
    }
  } finally {
    catalog.close();
    seed.close();
  }
}
