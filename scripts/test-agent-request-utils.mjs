import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { selectedMutationMonth } from "../lib/agent-request-utils.mjs";

assert.equal(selectedMutationMonth("다음 달 식단 다시 짜줘", "2026-09"), "2026-10");
assert.equal(selectedMutationMonth("다다음달 식단을 구성해줘", "2026-11"), "2027-01");
assert.equal(selectedMutationMonth("지난달 메뉴를 보여줘", "2026-01"), "2025-12");
assert.equal(selectedMutationMonth("2027년 3월 식단", "2026-09"), "2027-03");
assert.equal(selectedMutationMonth("4월 식단", "2026-09"), "2026-04");

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meal-agent-guards-"));
const databasePath = path.join(tempRoot, "mealplan.db");
const database = new DatabaseSync(databasePath);
database.exec(`CREATE TABLE "PantryItem" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL UNIQUE,
  "quantity" REAL NOT NULL,
  "unit" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "expiresAt" INTEGER,
  "updatedAt" INTEGER NOT NULL
);
CREATE TABLE "FamilyMember" (
  "id" TEXT PRIMARY KEY,
  "allergies" TEXT NOT NULL DEFAULT ''
)`);

function pantry(action) {
  const inputPath = path.join(tempRoot, `action-${Date.now()}-${Math.random()}.json`);
  fs.writeFileSync(inputPath, JSON.stringify(action));
  const result = spawnSync(
    process.execPath,
    [path.join(projectRoot, "scripts", "mealctl.mjs"), "manage-pantry", "--input", inputPath],
    {
      cwd: projectRoot,
      encoding: "utf8",
      env: { ...process.env, MEAL_PLAN_ROOT: tempRoot, MEAL_DB_PATH: databasePath },
    },
  );
  fs.rmSync(inputPath, { force: true });
  return result;
}

function assertSuccess(result) {
  assert.equal(result.status, 0, String(result.stderr || result.stdout));
}

try {
  assertSuccess(pantry({ operation: "upsert", name: "감자", quantity: 500, unit: "g", category: "냉장" }));
  assertSuccess(pantry({ operation: "adjust", name: "감자", quantity: 1, unit: "kg", category: "냉장" }));
  assert.equal(database.prepare('SELECT "quantity","unit" FROM "PantryItem" WHERE "name"=?').get("감자").quantity, 1500);
  assert.notEqual(pantry({ operation: "adjust", name: "감자", quantity: 1, unit: "L", category: "냉장" }).status, 0);
  assert.equal(database.prepare('SELECT "quantity" FROM "PantryItem" WHERE "name"=?').get("감자").quantity, 1500);
} finally {
  database.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log("AI 요청 안전장치 검증 통과: 상대 월 해석, 연도 경계, 재료 단위 환산과 비호환 단위 차단.");
