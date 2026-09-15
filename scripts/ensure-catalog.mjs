#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
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
  console.log(JSON.stringify({ catalogPath, created: false, ...existingCounts }));
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
