#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { catalogCounts } from "./catalog-seed.mjs";

const root = process.env.MEAL_PLAN_ROOT ?? process.cwd();
const catalogPath = process.env.MEAL_CATALOG_DB_PATH ?? path.join(root, "data", "10000recipe-catalog.db");
const seedPath = path.join(root, "seed", "10000recipe-catalog.db.gz");
if (!fs.existsSync(catalogPath)) throw new Error(`카탈로그 DB가 없습니다: ${catalogPath}`);
const counts = catalogCounts(catalogPath);
fs.mkdirSync(path.dirname(seedPath), { recursive: true });
fs.writeFileSync(seedPath, gzipSync(fs.readFileSync(catalogPath), { level: 9 }));
console.log(JSON.stringify({ seedPath, ...counts, bytes: fs.statSync(seedPath).size }, null, 2));
