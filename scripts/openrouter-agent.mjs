#!/usr/bin/env node
/**
 * Direct OpenRouter worker. Every database mutation remains behind mealctl so
 * validation, scoped publishing, backups, and browser notifications survive
 * the provider change.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.env.MEAL_PLAN_ROOT || process.cwd();
const queuedPath = process.argv[2];
if (!queuedPath) throw new Error("Queued request file is required.");
const task = JSON.parse(fs.readFileSync(queuedPath, "utf8"));
const apiKey = process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY.trim();
const model = process.env.OPENROUTER_MODEL && process.env.OPENROUTER_MODEL.trim();
if (!apiKey || !model) {
  fail("OpenRouter API 키 또는 모델이 설정되지 않았습니다.");
  process.exit(1);
}

function runCtl(args, allowFailure = false) {
  const result = spawnSync(process.execPath, ["scripts/mealctl.mjs", ...args], {
    cwd: root, encoding: "utf8", env: process.env, timeout: 120000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (!allowFailure && result.status !== 0)
    throw new Error(String(result.stderr || result.stdout || result.error?.message || "mealctl 실행 실패").trim().slice(0, 2000));
  return result;
}
function ctl(...args) {
  return runCtl(args).stdout;
}
function context(week) { return JSON.parse(ctl("context", "--week", week)); }
function monthContext(month) { return JSON.parse(ctl("context-month", "--month", month)); }
function rules() {
  return {
    agents: fs.readFileSync(path.join(root, "AGENTS.md"), "utf8"),
    meal: fs.readFileSync(path.join(root, "MEAL.md"), "utf8"),
  };
}
function modelJson(content) {
  const text = String(content || "").trim();
  const match = text.match(/\`\`\`(?:json)?\s*([\s\S]*?)\`\`\`/i);
  const value = match ? match[1] : text;
  const first = value.indexOf("{"), last = value.lastIndexOf("}");
  if (first < 0 || last < first) throw new Error("OpenRouter가 JSON 결과를 반환하지 않았습니다.");
  try { return JSON.parse(value.slice(first, last + 1)); }
  catch { throw new Error("OpenRouter 결과 JSON을 해석하지 못했습니다."); }
}
async function ask(system, user, search = false, searchBudget = 12) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json",
      "HTTP-Referer": (process.env.OPENROUTER_SITE_URL && process.env.OPENROUTER_SITE_URL.trim()) || "http://localhost:3000",
      // Node's HTTP header implementation accepts ByteString only.
      "X-Title": "Table for Us",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      temperature: 0.25,
      max_tokens: 16000,
      stream: false,
      response_format: { type: "json_object" },
      plugins: [{ id: "response-healing" }],
      ...(search && process.env.OPENROUTER_ENABLE_WEB_SEARCH !== "false"
        ? {
            // Recipes must be grounded in Korean blog originals. Domain limits
            // also nudge desktop Naver URLs toward their mobile counterpart.
            tools: [{
              type: "openrouter:web_search",
              parameters: {
                engine: "auto",
                max_results: 3,
                max_uses: searchBudget,
                max_total_results: Math.min(searchBudget * 3, 45),
                search_context_size: "medium",
                allowed_domains: ["m.blog.naver.com", "blog.naver.com", "*.tistory.com"],
              },
            }, { type: "openrouter:web_fetch" }],
            max_tool_calls: Math.min(searchBudget * 2 + 4, 30),
          }
        : {}),
    }),
    signal: AbortSignal.timeout(300000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const errorValue = data && data.error && data.error.message;
    throw new Error(String(errorValue || "OpenRouter 요청 실패 (" + response.status + ")").slice(0, 2000));
  }
  const message = data && data.choices && data.choices[0] && data.choices[0].message;
  if (!message || !message.content) throw new Error("OpenRouter가 비어 있는 응답을 반환했습니다.");
  return { content: message.content, annotations: message.annotations || [] };
}
function systemPrompt(ruleFiles) {
  return [
    "당신은 가족 식단 앱의 자동 게시 작업자입니다. 설명 없이 유효한 JSON 객체만 반환합니다.",
    "레시피가 필요하면 반드시 OpenRouter 웹 검색과 웹 본문 읽기를 먼저 사용한다. 모바일 네이버 블로그(m.blog.naver.com)를 우선하고, 네이버 블로그 또는 티스토리 원문을 실제로 확인한 뒤에만 sourceUrl, sourceTitle, sourceAuthor, sourceCheckedAt을 넣는다. URL을 추측하거나 만들지 않는다.",
    "블로그 문장과 이미지는 복사하지 말고 가족 기준의 재료·조리법으로 구조화한다.",
    "입력 컨텍스트의 outputContract를 정확히 지키고, 수량은 숫자와 단위로, 조리 단계는 '1. '부터 시작한다. 브로콜리·파프리카·피망은 재료뿐 아니라 메뉴명·출처 제목·메모를 포함한 저장 JSON 어디에도 넣지 않는다. 같은 주의 같은 재료는 반드시 한 가지 단위만 사용한다(예: 당근은 모두 g, 애호박은 모두 g).",
    "[AGENTS.md]", ruleFiles.agents, "[MEAL.md]", ruleFiles.meal,
  ].join("\n");
}
function writeInput(label, payload) {
  const dir = path.join(root, "data", "agent-inputs");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, label + "-" + Date.now() + ".json");
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
  return file;
}
function publish(command, input, args) {
  try { return ctl(command, "--input", input, ...args); }
  finally { fs.rmSync(input, { force: true }); }
}
function validate(command, payload, args) {
  const input = writeInput("validate", payload);
  try {
    const result = runCtl([command, "--input", input, ...args], true);
    const output = String(result.stdout || "").trim();
    if (!output) throw new Error(String(result.stderr || "검증 결과가 비어 있습니다.").trim());
    return JSON.parse(output);
  } finally {
    fs.rmSync(input, { force: true });
  }
}
function notify() {
  try {
    ctl("notify-web", ...(task.kind === "chat" ? ["--chat-id", task.requestId] : ["--request-id", task.requestId]));
  } catch (error) {
    console.warn("Notification skipped:", error.message);
  }
}
function fail(message) {
  try {
    if (task && task.kind === "chat") {
      ctl("fail-chat", "--id", task.requestId, "--error", String(message).slice(0, 2000));
    } else if (task && task.requestId) {
      ctl("fail-job", "--request-id", task.requestId, "--error", String(message).slice(0, 2000));
    }
  } catch (error) { console.error("Could not record failure:", error.message); }
}
function citations(annotations) {
  return annotations.map((value) => value && value.url_citation).filter((value) => value && value.url && /^https?:\/\//.test(value.url)).slice(0, 8)
    .map((value) => ({ title: value.title || undefined, url: value.url }));
}
function requestsMealDataChange(message) {
  const text = String(message || "").replace(/\s+/g, " ");
  const mentionsMealData =
    /(식단|메뉴|주찬|부찬|반찬|점심|저녁|레시피|장보기)/.test(text);
  const asksToChange =
    /(바꿔|바꾸어|바꿔\s*달|변경\s*해|수정\s*해|교체\s*해|삭제\s*해|추가\s*해|재생성\s*해|반영\s*해|저장\s*해)/.test(text);
  return mentionsMealData && asksToChange;
}
function selectedMutationMonth(message, fallbackMonth) {
  const text = String(message || "");
  const full = text.match(/(20\d{2})\s*[년./-]\s*(1[0-2]|0?[1-9])\s*월?/);
  if (full) return `${full[1]}-${String(Number(full[2])).padStart(2, "0")}`;
  const monthOnly = text.match(/(?:^|\s)(1[0-2]|0?[1-9])\s*월/);
  if (monthOnly && /^\d{4}-\d{2}$/.test(fallbackMonth || ""))
    return `${fallbackMonth.slice(0, 4)}-${String(Number(monthOnly[1])).padStart(2, "0")}`;
  return fallbackMonth;
}
function sundayForDate(date) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - value.getUTCDay());
  return value.toISOString().slice(0, 10);
}
async function runChatMealChange(ruleFiles) {
  const targetMonth = selectedMutationMonth(task.message, task.targetMonth);
  if (!/^\d{4}-\d{2}$/.test(targetMonth || ""))
    throw new Error("변경할 연도와 월을 확인할 수 없습니다. 예: ‘2026년 9월 7일부터 9일까지 부찬을 바꿔줘’처럼 적어 주세요.");
  const month = monthContext(targetMonth);
  if (!month.existingMonthMeals?.length)
    throw new Error(`${targetMonth}에는 변경할 식단이 없습니다.`);
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const result = await ask(
    systemPrompt(ruleFiles) +
      "\n\n이번 작업은 AI 채팅에서 받은 실제 식단 변경 요청이다. 요청한 날짜만 바꾸고 날짜가 불명확하면 mealChanges를 비운 채 answer에 확인 질문을 작성한다. '7일부터 9일까지'는 선택 월의 7·8·9일을 모두 뜻한다. 각 mealChanges에는 기존 값을 유지하는 항목도 포함해 date, lunch, main, sides 두 개를 완전하게 반환한다. 변경된 각 날짜의 주찬·부찬·필요한 주말 점심을 모두 덮는 recipes를 만든다. 같은 메뉴를 여러 변경 날짜에 먹으면 레시피 하나의 plannedDates에 해당 날짜를 모두 넣되, 요청하지 않은 날짜는 넣지 않는다. JSON: {\"answer\":\"처리 결과 또는 확인 질문\",\"changeReason\":\"변경 이유\",\"mealChanges\":[...],\"recipes\":[...]}",
    `[오늘]\n${today}\n[선택 월]\n${targetMonth}\n[월간 컨텍스트]\n${JSON.stringify(month)}\n[사용자 요청]\n${task.message}`,
    true,
    12,
  );
  const requested = modelJson(result.content);
  const changes = Array.isArray(requested.mealChanges)
    ? requested.mealChanges
    : [];
  if (!changes.length) {
    return {
      answer:
        String(requested.answer || "").trim() ||
        "변경할 날짜나 내용을 확인하지 못했습니다. 연도·월·날짜와 바꿀 메뉴를 함께 적어 주세요.",
      sources: citations(result.annotations),
    };
  }
  if (changes.length > 7)
    throw new Error("채팅에서는 한 번에 최대 7일까지만 변경할 수 있습니다.");
  const dates = changes.map((change) => String(change.date || ""));
  if (
    new Set(dates).size !== dates.length ||
    dates.some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(date) || !date.startsWith(`${targetMonth}-`))
  )
    throw new Error(`변경 날짜는 ${targetMonth} 안에서 중복 없이 지정해야 합니다.`);
  const weeks = new Set(dates.map(sundayForDate));
  if (weeks.size !== 1)
    throw new Error("한 번의 채팅 요청에서는 같은 일요일~토요일 주차의 날짜만 함께 변경할 수 있습니다.");
  const weekStart = [...weeks][0];
  const current = context(weekStart);
  const existingDates = new Set(current.meals.map((meal) => meal.date));
  if (dates.some((date) => !existingDates.has(date)))
    throw new Error("요청한 날짜 중 저장된 식단이 없는 날이 있습니다.");
  let payload = {
    schemaVersion: "meal-week.v1",
    weekStart,
    changeReason: String(requested.changeReason || task.message).slice(0, 1000),
    mealChanges: changes,
    recipes: Array.isArray(requested.recipes) ? requested.recipes : [],
  };
  payload = mergeReusableRecipes(payload, current);
  payload = await completePayload(
    payload,
    compactPlannerContext(current),
    ruleFiles,
    `${dates.join(", ")}만 변경하고 같은 주의 다른 날짜는 유지한다. 변경 날짜의 레시피와 해당 주 장보기를 함께 갱신한다.`,
    (candidate) => validate("validate-week", candidate, ["--week", weekStart]),
    true,
    8,
  );
  publish(
    "publish-week",
    writeInput("chat-change-" + task.requestId, payload),
    ["--week", weekStart],
  );
  return {
    answer:
      String(requested.answer || "").trim() ||
      `${dates.join(", ")} 식단과 관련 레시피·장보기를 변경했습니다.`,
    sources: citations(result.annotations),
  };
}
function compactPlannerContext(current) {
  return {
    ...current,
    reusableRecipes: (current.reusableRecipes || []).map((recipe) => ({
      title: recipe.title,
      category: recipe.category,
      plannedDates: recipe.plannedDates,
      sourceUrl: recipe.sourceUrl,
    })),
  };
}
function mergeReusableRecipes(payload, current) {
  const recipes = new Map();
  for (const recipe of payload.recipes || [])
    recipes.set(recipe.category + "|" + recipe.title, recipe);
  // A verified exact-title SQLite recipe wins over newly generated content.
  for (const recipe of current.reusableRecipes || [])
    recipes.set(recipe.category + "|" + recipe.title, recipe);
  return { ...payload, recipes: [...recipes.values()] };
}
async function completePayload(payload, current, ruleFiles, scope, runValidation, search, searchBudget = 6) {
  let candidate = payload;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const validation = runValidation(candidate);
    if (validation.valid) return candidate;
    const problems = Array.isArray(validation.errors)
      ? validation.errors
      : ["저장 검증을 통과하지 못했습니다."];
    const result = await ask(
      systemPrompt(ruleFiles) + "\n\n직전 JSON이 저장 검증에 실패했다. 아래 오류를 모두 해결한 완전한 교체 JSON만 반환한다. 레시피 출처 오류가 있으면 웹 검색과 원문 읽기로 확인하고, 확인하지 못한 URL을 추측해서 채우면 안 된다.",
      "[현재 컨텍스트]\n" + JSON.stringify(current) + "\n[작업 범위]\n" + scope + "\n[검증 오류]\n" + problems.join("\n") + "\n[수정할 JSON]\n" + JSON.stringify(candidate),
      search,
      searchBudget,
    );
    candidate = modelJson(result.content);
  }
  const validation = runValidation(candidate);
  throw new Error("AI 결과가 저장 검증을 통과하지 못했습니다: " + String(validation.errors || "알 수 없는 검증 오류").slice(0, 1800));
}

async function runChat() {
  const ruleFiles = rules();
  if (requestsMealDataChange(task.message)) {
    const response = await runChatMealChange(ruleFiles);
    publish(
      "reply-chat",
      writeInput("chat-" + task.requestId, response),
      ["--id", task.requestId],
    );
    notify();
    return;
  }
  const current = context(task.weekStart);
  const result = await ask(
    systemPrompt(ruleFiles) + "\n\n이번 작업은 읽기 전용 채팅이다. 데이터 변경 요청은 수행하지 말고 앱의 식단 수정 기능으로 안내한다. 칼로리는 정확한 중량이 없으면 추정 범위와 가정을 밝힌다. JSON: {\"answer\":\"한국어 답변\",\"sources\":[{\"title\":\"출처\",\"url\":\"https://...\"}]}",
    "[현재 주 컨텍스트]\n" + JSON.stringify(current) + "\n[대화 기록]\n" + JSON.stringify(task.conversation || []) + "\n[질문]\n" + task.message,
    true,
    3,
  );
  const payload = modelJson(result.content);
  if (!String(payload.answer || "").trim())
    payload.answer =
      "질문을 처리했지만 AI 답변 형식이 올바르지 않았습니다. 내용을 조금 다르게 적어 다시 질문해 주세요.";
  if (!Array.isArray(payload.sources) || !payload.sources.length) payload.sources = citations(result.annotations);
  publish("reply-chat", writeInput("chat-" + task.requestId, payload), ["--id", task.requestId]);
  notify();
}

async function runPlanner() {
  if (task.action === "REGENERATE_GROCERY") {
    ctl("rebuild-shopping", "--week", task.weekStart, "--request-id", task.requestId);
    notify(); return;
  }
  const ruleFiles = rules();
  if (task.action === "PUBLISH_MONTH") {
    const current = monthContext(task.targetMonth);
    if (current.existingMonthMeals?.length)
      throw new Error(task.targetMonth + " 월간 식단은 이미 저장되어 있어 덮어쓰지 않습니다.");
    const result = await ask(systemPrompt(ruleFiles),
      "[월간 컨텍스트]\n" + JSON.stringify(current) + "\n[요청]\n" + task.prompt +
      "\n" + task.targetMonth + "의 모든 날짜를 포함한 meal-month.v1 JSON만 반환한다. 레시피·장보기는 만들지 않는다.");
    const scope = task.targetMonth + "의 모든 날짜를 한 번씩 포함하는 월간 식단이며 레시피와 장보기는 만들지 않는다.";
    let payload = modelJson(result.content);
    payload = await completePayload(
      payload,
      current,
      ruleFiles,
      scope,
      (candidate) => validate("validate-month", candidate, ["--month", task.targetMonth]),
      false,
    );
    publish("publish-month", writeInput("month-" + task.targetMonth, payload),
      ["--month", task.targetMonth, "--request-id", task.requestId]);
    notify(); return;
  }

  const current = context(task.weekStart);
  if (task.action === "REVIEW_WEEK") {
    const result = await ask(
      systemPrompt(ruleFiles) + "\n\n주간 점검이다. referenceDate부터 토요일까지만 판단한다. 유지하면 {\"decision\":\"maintain\",\"summary\":\"...\"}; 수정하면 {\"decision\":\"change\",\"changeReason\":\"...\",\"mealChanges\":[...],\"recipes\":[...]}를 반환한다. 수정 레시피는 변경 날짜만 포함하고 plannedDates는 정확히 한 날짜여야 한다.",
      "[주간 컨텍스트]\n" + JSON.stringify(current) + "\n[사용자 점검 정보]\n" + task.prompt, true, 8);
    let payload = modelJson(result.content);
    if (payload.decision === "maintain") {
      ctl("record-review", "--week", task.weekStart, "--summary", String(payload.summary || "현재 식단을 유지합니다."), "--request-id", task.requestId);
      notify(); return;
    }
    if (payload.decision !== "change" || !Array.isArray(payload.mealChanges) || !payload.mealChanges.length)
      throw new Error("주간 점검 결과 형식이 올바르지 않습니다.");
    for (let index = 0; index < payload.mealChanges.length; index += 1) {
      const change = payload.mealChanges[index];
      const recipes = (payload.recipes || []).filter((recipe) =>
        Array.isArray(recipe.plannedDates) && recipe.plannedDates.every((date) => date === change.date));
      let dayPayload = { schemaVersion: "meal-week.v1", weekStart: task.weekStart,
        changeReason: String(payload.changeReason || "주간 점검 결과 식단을 조정했습니다."),
        mealChanges: [change], recipes };
      const scope = change.date + " 하루만 변경하며 레시피 plannedDates도 이 날짜만 포함한다.";
      dayPayload = await completePayload(
        dayPayload,
        compactPlannerContext(context(task.weekStart)),
        ruleFiles,
        scope,
        (candidate) => validate("validate-day", candidate, ["--week", task.weekStart, "--date", change.date]),
        true,
        6,
      );
      const requestIdArgs = index === payload.mealChanges.length - 1 ? ["--request-id", task.requestId] : [];
      publish("publish-day", writeInput("review-" + change.date, dayPayload),
        ["--week", task.weekStart, "--date", change.date, ...requestIdArgs]);
    }
    notify(); return;
  }

  const isDaily = task.action === "UPDATE_DAY";
  const scope = isDaily
    ? "선택 날짜 " + task.date + "만 변경한다. mealChanges는 그 날짜 하나만, 모든 recipes.plannedDates도 그 날짜 하나만 포함한다."
    : task.action === "REGENERATE_RECIPES"
      ? "월간 캘린더 메뉴는 절대 바꾸지 않는다. mealChanges는 빈 배열이다. 선택 주의 저녁 주찬·부찬과 집에서 먹는 주말 점심 레시피를 모두 만든다."
      : "월간 캘린더 메뉴는 절대 바꾸지 않는다. mealChanges는 빈 배열이다. 선택 주의 레시피를 모두 만들고 장보기에 쓸 수 있게 한다.";

  if (!isDaily && current.reusableRecipes?.length) {
    const reusablePayload = {
      schemaVersion: "meal-week.v1",
      weekStart: task.weekStart,
      changeReason: "SQLite에서 검증된 동일 메뉴 레시피를 재사용했습니다.",
      mealChanges: [],
      recipes: current.reusableRecipes,
    };
    if (validate("validate-week", reusablePayload, ["--week", task.weekStart]).valid) {
      const input = writeInput("reused-week-" + task.weekStart, reusablePayload);
      if (task.action === "REGENERATE_RECIPES")
        publish("publish-recipes", input, ["--week", task.weekStart, "--request-id", task.requestId]);
      else
        publish("publish-week", input, ["--week", task.weekStart, "--request-id", task.requestId]);
      notify();
      return;
    }
  }

  const modelContext = compactPlannerContext(current);
  const reuseInstruction = !isDaily && current.reusableRecipes?.length
    ? "\n[재사용 규칙]\n컨텍스트의 reusableRecipes는 SQLite에서 검증된 정확히 같은 메뉴다. 이 메뉴들은 recipes에 다시 생성하지 말고 누락된 메뉴만 검색한다. 앱이 검증된 레시피를 최종 JSON에 자동으로 합친다."
    : "";
  const searchBudget = isDaily
    ? 4
    : Math.min(20, Math.max(4, 22 - (current.reusableRecipes?.length || 0)));
  const result = await ask(systemPrompt(ruleFiles),
    "[주간 컨텍스트]\n" + JSON.stringify(modelContext) + "\n[사용자 요청]\n" + task.prompt + "\n[작업 범위]\n" + scope + reuseInstruction + "\nmeal-week.v1 JSON만 반환한다.", true, searchBudget);
  let payload = modelJson(result.content);
  if (!isDaily) payload = mergeReusableRecipes(payload, current);
  payload = await completePayload(
    payload,
    modelContext,
    ruleFiles,
    scope,
    (candidate) => isDaily
      ? validate("validate-day", candidate, ["--week", task.weekStart, "--date", task.date])
      : validate("validate-week", candidate, ["--week", task.weekStart]),
    true,
    searchBudget,
  );
  const input = writeInput((isDaily ? "day-" + task.date : "week-" + task.weekStart), payload);
  if (isDaily) publish("publish-day", input, ["--week", task.weekStart, "--date", task.date, "--request-id", task.requestId]);
  else if (task.action === "REGENERATE_RECIPES") publish("publish-recipes", input, ["--week", task.weekStart, "--request-id", task.requestId]);
  else publish("publish-week", input, ["--week", task.weekStart, "--request-id", task.requestId]);
  notify();
}

try {
  if (task.kind === "chat") await runChat();
  else await runPlanner();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  fail(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  fs.rmSync(queuedPath, { force: true });
}
