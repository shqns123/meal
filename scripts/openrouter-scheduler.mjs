#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

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
  if (!process.env.OPENROUTER_API_KEY?.trim() || !process.env.OPENROUTER_MODEL?.trim())
    return;
  const current = kstParts(now);

  if (current.weekday === 6 && current.hour === 20) {
    const weekStart = addDays(current.date, 1);
    queueOnce({
      requestId: "scheduled-week-review-" + weekStart,
      action: "REVIEW_WEEK",
      weekStart,
      prompt:
        "저장된 주간 점검 정보, 보유 재료와 날짜별 가족 식사 여부를 기준으로 다음 주 일요일부터 토요일까지 식단을 검토해줘. 특이사항이 없으면 유지하고, 조정이 필요할 때만 해당 날짜의 식단·레시피·장보기를 검증 후 반영해줘.",
    });
  }

  if (current.weekday === 5 && current.hour === 18) {
    const targetMonth = shiftMonth(current.date.slice(0, 7), 1);
    if (
      current.date === addDays(sundayFor(targetMonth + "-01"), -2) &&
      !db.prepare('SELECT 1 FROM "MealPlan" WHERE "monthKey"=? LIMIT 1').get(targetMonth)
    )
      queueOnce({
        requestId: "scheduled-month-plan-" + targetMonth,
        action: "PUBLISH_MONTH",
        weekStart: sundayFor(targetMonth + "-01"),
        targetMonth,
        prompt:
          "다음 달 월간 식단을 생성하고 검증 후 저장해줘. 레시피와 장보기는 생성하지 마.",
      });
  }
}

function queueOnce(task) {
  if (db.prepare('SELECT 1 FROM "AgentJob" WHERE "requestId"=? LIMIT 1').get(task.requestId))
    return;

  const id = "scheduled-" + task.requestId;
  db.prepare(
    'INSERT INTO "AgentJob" ("id","requestId","weekStart","action","status","createdAt") VALUES (?,?,?,?,?,?)',
  ).run(id, task.requestId, Date.parse(task.weekStart + "T00:00:00+09:00"), task.action, "RUNNING", Date.now());

  const directory = path.join(root, "data", "agent-requests");
  fs.mkdirSync(directory, { recursive: true });
  const requestPath = path.join(directory, "planner-" + task.requestId + "-" + randomUUID() + ".json");
  fs.writeFileSync(requestPath, JSON.stringify({ kind: "planner", ...task }), { encoding: "utf8", mode: 0o600 });
  const worker = spawn(process.execPath, [path.join(root, "scripts", "openrouter-agent.mjs"), requestPath], {
    cwd: root,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, MEAL_PLAN_ROOT: root },
  });
  worker.unref();
  console.log("Queued scheduled OpenRouter task:", task.requestId);
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
function sundayFor(date) {
  const value = new Date(date + "T00:00:00Z");
  value.setUTCDate(value.getUTCDate() - value.getUTCDay());
  return value.toISOString().slice(0, 10);
}
function shiftMonth(month, amount) {
  const [year, numericMonth] = month.split("-").map(Number);
  const value = new Date(Date.UTC(year, numericMonth - 1 + amount, 1));
  return value.getUTCFullYear() + "-" + String(value.getUTCMonth() + 1).padStart(2, "0");
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
