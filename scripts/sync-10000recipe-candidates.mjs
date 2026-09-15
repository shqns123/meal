#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();
const mealPath = process.env.MEAL_DB_PATH ?? path.join(root, "data", "mealplan.db");
const catalogPath = process.env.MEAL_CATALOG_DB_PATH ?? path.join(root, "data", "10000recipe-catalog.db");

if (!fs.existsSync(mealPath)) throw new Error(`식단 DB가 없습니다: ${mealPath}`);
if (!fs.existsSync(catalogPath)) throw new Error(`카탈로그 DB가 없습니다: ${catalogPath}`);

const categories = new Map([
  ["메인반찬", "주찬"],
  ["밑반찬", "부찬"],
  ["국/탕", "국/탕/찌개"],
  ["찌개", "국/탕/찌개"],
  ["면/만두", "한그릇"],
  ["밥/죽/떡", "한그릇"],
]);
const meal = new DatabaseSync(mealPath);
const catalog = new DatabaseSync(catalogPath, { readOnly: true });
try {
  const rows = catalog.prepare(
    `SELECT m."sourceCategory",m."name" AS "baseName",v."name" AS "variantName"
     FROM "RecipeCatalogMenu" m
     LEFT JOIN "RecipeCatalogVariant" v ON v."menuId"=m."id"`,
  ).all();
  const candidates = new Map();
  for (const row of rows) {
    const category = categories.get(row.sourceCategory);
    if (!category) continue;
    for (const name of [row.baseName, row.variantName]) {
      const normalized = String(name ?? "").trim().replace(/\s+/g, " ");
      if (normalized) candidates.set(`${category}|${normalized}`, { name: normalized, category });
    }
  }
  const insert = meal.prepare(
    'INSERT OR IGNORE INTO "Dish" ("id","name","category","aliases","createdAt") VALUES (?,?,?,?,?)',
  );
  const now = Date.now();
  let added = 0;
  meal.exec("BEGIN IMMEDIATE");
  try {
    for (const candidate of candidates.values()) {
      const result = insert.run(crypto.randomUUID(), candidate.name, candidate.category, "[]", now);
      added += result.changes;
    }
    meal.exec("COMMIT");
  } catch (error) {
    try { meal.exec("ROLLBACK"); } catch {}
    throw error;
  }
  console.log(JSON.stringify({ candidates: candidates.size, added, existing: candidates.size - added }, null, 2));
} finally {
  catalog.close();
  meal.close();
}
