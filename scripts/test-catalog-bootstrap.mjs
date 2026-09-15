import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { catalogCounts } from "./catalog-seed.mjs";

const sourceRoot = process.cwd();
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meal-catalog-bootstrap-"));
try {
  fs.mkdirSync(path.join(temporaryRoot, "seed"));
  fs.copyFileSync(path.join(sourceRoot, "seed", "10000recipe-catalog.db.gz"),
    path.join(temporaryRoot, "seed", "10000recipe-catalog.db.gz"));
  const run = () => {
    const env = { ...process.env, MEAL_PLAN_ROOT: temporaryRoot };
    delete env.MEAL_CATALOG_DB_PATH;
    return spawnSync(process.execPath, [path.join(sourceRoot, "scripts", "ensure-catalog.mjs")], {
      cwd: path.join(temporaryRoot, "seed"), env, encoding: "utf8",
    });
  };
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  assert.equal(JSON.parse(first.stdout).created, true);
  const catalogPath = path.join(temporaryRoot, "data", "10000recipe-catalog.db");
  const counts = catalogCounts(catalogPath);
  assert.ok(counts.menus > 0 && counts.variants > 0);
  const before = fs.statSync(catalogPath).mtimeMs;
  const second = run();
  assert.equal(second.status, 0, second.stderr);
  assert.equal(JSON.parse(second.stdout).created, false);
  assert.deepEqual(catalogCounts(catalogPath), counts);
  assert.equal(fs.statSync(catalogPath).mtimeMs, before);
  fs.writeFileSync(catalogPath, "잘못된 카탈로그 파일");
  const repaired = run();
  assert.equal(repaired.status, 0, repaired.stderr);
  const repairResult = JSON.parse(repaired.stdout);
  assert.equal(repairResult.created, true);
  assert.ok(fs.existsSync(repairResult.invalidBackup));
  assert.deepEqual(catalogCounts(catalogPath), counts);
  console.log("Catalog bootstrap tests passed.");
} finally {
  const resolvedRoot = fs.realpathSync(temporaryRoot);
  const resolvedTemporaryDirectory = fs.realpathSync(os.tmpdir());
  if (!resolvedRoot.startsWith(`${resolvedTemporaryDirectory}${path.sep}`))
    throw new Error(`정리 경로가 임시 디렉터리 밖입니다: ${resolvedRoot}`);
  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}
