#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { scheduledWeekFor, nextScheduledRequest } from "../lib/scheduled-week.mjs";

const root = process.env.MEAL_PLAN_ROOT || process.cwd();
const dbPath = process.env.MEAL_DB_PATH || path.join(root, "data", "mealplan.db");
const intervalMs = 60_000;

while (!fs.existsSync(dbPath))
  await new Promise((resolve) => setTimeout(resolve, 2_000));

const db = new DatabaseSync(dbPath);
db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = DELETE; PRAGMA busy_timeout = 5000;");

async function check(now = new Date()) {
  db.prepare(
    `UPDATE "AgentJob" SET "status"='FAILED',"error"='백그라운드 작업이 중단되었습니다.',"completedAt"=?
     WHERE "status"='RUNNING' AND "createdAt"<?`,
  ).run(Date.now(), Date.now() - 30 * 60_000);
  const current = kstParts(now);

  // Catch up after a restart during Saturday evening, through the following Sunday.
  const weekStart = scheduledWeekFor(current);
  if (weekStart) {
    const count = db.prepare('SELECT COUNT(*) AS "count" FROM "MealPlan" WHERE "date">=? AND "date"<?')
      .get(Date.parse(`${weekStart}T00:00:00+09:00`), Date.parse(`${addDays(weekStart, 7)}T00:00:00+09:00`)).count;
    if (count === 0)
      queueOnce({
        requestId: "scheduled-week-plan-" + weekStart,
        action: "PUBLISH_WEEK",
        weekStart,
        prompt: "다음 주 일요일부터 토요일까지 주간 식단을 생성하고 검증 후 저장해줘. 레시피와 장보기는 생성하지 마.",
      });
    else if (count === 7 && process.env.OPENROUTER_API_KEY?.trim() && process.env.OPENROUTER_MODEL?.trim())
      queueOnce({
        requestId: "scheduled-week-review-" + weekStart,
        action: "REVIEW_WEEK",
        weekStart,
        prompt: "저장된 주간 점검 정보, 보유 재료와 날짜별 가족 식사 여부를 기준으로 다음 주 식단을 검토해줘. 특이사항이 없으면 유지하고, 조정이 필요할 때만 검증 후 반영해줘.",
      });
    else if (count > 0 && count < 7)
      console.error(`${weekStart} 주차에 ${count}일의 식단만 있어 자동 생성을 건너뜁니다. 누락된 날짜를 확인해 주세요.`);
  }
}

function queueOnce(task) {
  let requestId;
  db.exec("BEGIN IMMEDIATE");
  try {
    const attempts = db.prepare('SELECT "status","createdAt","completedAt" FROM "AgentJob" WHERE "requestId"=? OR "requestId" LIKE ? ORDER BY "createdAt"')
      .all(task.requestId, `${task.requestId}-retry-%`);
    requestId = nextScheduledRequest(task.requestId, attempts);
    if (requestId)
      db.prepare('INSERT INTO "AgentJob" ("id","requestId","weekStart","action","status","createdAt") VALUES (?,?,?,?,?,?)')
        .run("scheduled-" + requestId, requestId, Date.parse(task.weekStart + "T00:00:00+09:00"), task.action, "RUNNING", Date.now());
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }
  if (!requestId) return;
  try {
    const directory = path.join(root, "data", "agent-requests");
    fs.mkdirSync(directory, { recursive: true });
    const requestPath = path.join(directory, "planner-" + requestId + "-" + randomUUID() + ".json");
    fs.writeFileSync(requestPath, JSON.stringify({ kind: "planner", ...task, requestId }), { encoding: "utf8", mode: 0o600 });
    const worker = spawn(process.execPath, [path.join(root, "scripts", "openrouter-agent.mjs"), requestPath], {
      cwd: root,
      detached: true,
      stdio: "ignore",
      env: { ...process.env, MEAL_PLAN_ROOT: root },
    });
    worker.once("error", (error) => {
      db.prepare('UPDATE "AgentJob" SET "status"=?,"error"=?,"completedAt"=? WHERE "requestId"=? AND "status"=?')
        .run("FAILED", String(error.message).slice(0, 2000), Date.now(), requestId, "RUNNING");
      console.error("Scheduled worker failed to start:", error);
    });
    worker.unref();
    console.log("Queued scheduled OpenRouter task:", requestId);
  } catch (error) {
    db.prepare('UPDATE "AgentJob" SET "status"=?,"error"=?,"completedAt"=? WHERE "requestId"=? AND "status"=?')
      .run("FAILED", String(error).slice(0, 2000), Date.now(), requestId, "RUNNING");
    throw error;
  }
}

function kstParts(value) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  const date = get("year") + "-" + get("month") + "-" + get("day");
  return {
    date,
    hour: Number(get("hour")),
    weekday: new Date(date + "T00:00:00Z").getUTCDay(),
  };
}

function addDays(date, amount) {
  const value = new Date(date + "T00:00:00Z");
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}
await check().catch((error) => console.error("Scheduled task check failed:", error));
const timer = setInterval(
  () => check().catch((error) => console.error("Scheduled task check failed:", error)),
  intervalMs,
);

for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    clearInterval(timer);
    db.close();
    process.exit(0);
  });
