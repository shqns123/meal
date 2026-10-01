#!/usr/bin/env node
/**
 * Direct OpenRouter worker. Every database mutation remains behind mealctl so
 * validation, scoped publishing, backups, and browser notifications survive
 * the provider change.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { selectedMutationMonth } from "../lib/agent-request-utils.mjs";
import { assertReviewDates } from "../lib/review-scope.mjs";
import { requestsMealDataChange, requestsSelectedWeekRegeneration } from "../lib/chat-mutation-intent.mjs";
import { ambiguousOldConfirmation, confirmedFollowup, mealDeletionScope, requestsMealDeletion } from "../lib/chat-meal-deletion.mjs";

const root = process.env.MEAL_PLAN_ROOT || process.cwd();
const queuedPath = process.argv[2];
if (!queuedPath) throw new Error("Queued request file is required.");
const task = JSON.parse(fs.readFileSync(queuedPath, "utf8"));
const apiKey = process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY.trim();
const model = process.env.OPENROUTER_MODEL && process.env.OPENROUTER_MODEL.trim();
if ((!apiKey || !model) && task.action !== "PUBLISH_WEEK") {
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
            // Recipe ingredients and steps must be grounded in an opened
            // 10000recipe individual recipe page.
            tools: [{
              type: "openrouter:web_search",
              parameters: {
                engine: "auto",
                max_results: 3,
                max_uses: searchBudget,
                max_total_results: Math.min(searchBudget * 3, 45),
                search_context_size: "medium",
                allowed_domains: ["www.10000recipe.com", "m.10000recipe.com"],
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
    "레시피가 필요하면 반드시 OpenRouter 웹 검색과 웹 본문 읽기를 먼저 사용한다. 메뉴명과 일치하는 만개의레시피의 개별 레시피 페이지를 실제로 열고, 그 페이지의 재료명·재료량·인분·조리 순서를 확인한 뒤에만 sourceUrl, sourceTitle, sourceAuthor, sourceCheckedAt을 넣는다. sourceUrl은 https://www.10000recipe.com/recipe/{숫자} 또는 같은 형태의 모바일 주소여야 하며 검색 결과·카테고리 페이지 URL은 저장하지 않는다. URL을 추측하거나 만들지 않는다.",
    "만개의레시피 원문의 재료와 분량을 가족의 실제 식사 인원에 맞게 환산하고 단위를 구조화한다. 원문 문장과 이미지는 복사하지 말고 조리 순서를 의미가 유지되는 범위에서 다시 작성한다. 정확한 세부메뉴와 일치하는 개별 레시피를 찾지 못하면 비슷한 메뉴로 대체하지 말고 출처 검증 실패로 남긴다.",
    "입력 컨텍스트의 outputContract를 정확히 지키고, 수량은 숫자와 단위로, 조리 단계는 '1. '부터 시작한다. 브로콜리·파프리카·피망은 재료뿐 아니라 메뉴명·출처 제목·메모를 포함한 저장 JSON 어디에도 넣지 않는다. 같은 주의 같은 재료는 반드시 한 가지 단위만 사용한다(예: 당근은 모두 g, 애호박은 모두 g).",
    "dishPreferences의 lastPlannedAt은 해당 메뉴가 식단에 마지막으로 편성된 날짜다. 새 식단을 만들 때 최근 편성 메뉴의 반복 간격을 판단하는 참고 자료로 사용하되, 허용 여부·알레르기·사용자 요청보다 우선하지 않는다.",
    "menuCatalog는 만개의레시피에서 수집한 식사형태·조리계열·기본 메뉴·세부 메뉴 계층이다. selectionPreview는 AVOID 메뉴를 제외하고 ALLOW와 UNKNOWN 세부메뉴를 대상으로 최근 식단을 반영해 고른 후보이다. UNKNOWN은 미확인 상태 그대로 저장할 수 있으며 ALLOW로 추정하지 않는다. 기본 메뉴별 동일한 기본 확률과 세부 메뉴 30일·기본 메뉴 10~14일·유사메뉴그룹 5~8일·조리계열/주재료 2일 쿨다운을 참고한다. 주간 완성본에서는 이름만 다른 비슷한 주찬의 근접 반복, 조리법·주재료의 3일 연속 반복과 주간 쏠림을 피한다. 부찬 조합을 2~3일 유지하는 것은 의도된 반복이다.",
    "카탈로그의 정확한 세부메뉴명을 사용한다. selectionPreview의 sides는 3일 조리 묶음 후보이며 부찬 조합을 유지하는 데 참고한다. 가족 기피(AVOID), 이번 주 기피, 알레르기와 금지 식재료는 선택하지 않는다. 기본메뉴의 취향을 세부메뉴로 자동 전파하지 않는다. cookingMethods와 ingredientCategories는 만개의레시피 상단 기본메뉴 태그에 직접 표시된 값만 담는다. 태그가 빈 항목의 조리계열·주재료는 식단 선택 단계의 임시 추정값이며 원본 태그나 정확한 레시피 재료·알레르기 판정 근거가 아니다. 세부메뉴의 실제 레시피 재료·조리법이 확인되면 그 정보를 우선한다.",
    "주간 식단은 먼저 mealStyle을 배치하고 메뉴를 선택한다. MAIN_DISH는 주찬 중심, SOUP_MEAL은 soup에 국/탕/찌개와 main에 간단한 주찬을 모두 넣는다. NOODLE_DUMPLING과 RICE_PORRIDGE_TTEOK는 main에 한그릇 메뉴를 둔다. soup은 SOUP_MEAL에서만 넣는다.",
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
function validationProblems(validation) {
  if (Array.isArray(validation?.errors)) {
    const errors = validation.errors
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    if (errors.length) return errors;
  }
  if (typeof validation?.error === "string" && validation.error.trim())
    return [validation.error.trim()];
  return ["검증기가 실패했지만 상세 오류를 반환하지 않았습니다. 컨테이너 로그를 확인해 주세요."];
}
function catalogDinnerForDate(change, current = null) {
  const contextForDate = current ?? monthContext(String(change?.date || "").slice(0, 7));
  const selection = (contextForDate?.menuCatalog?.selectionPreview || []).find((entry) => entry.date === change.date);
  if (!selection) throw new Error(`${change.date}의 카탈로그 메뉴 후보를 읽지 못했습니다.`);
  const { baby, ...withoutAutoBaby } = change;
  return {
    ...withoutAutoBaby,
    mealStyle: selection.mealStyle,
    main: selection.main?.name || change.main,
    soup: selection.soup?.name || null,
    sides: (selection.sides || []).map((item) => item.name).filter(Boolean),
    note: [change.note, "카탈로그 세부메뉴 자동 선택"].filter(Boolean).join(" · "),
  };
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
function effectiveMutationInstruction() {
  if (requestsMealDataChange(task.message)) return task.message;
  const followUp = /(그걸|그렇게|이걸|앞에서|방금|해\s*줘|해주세요|부터|까지|전부|모두)/.test(
    String(task.message || ""),
  );
  if (!followUp) return null;
  const recent = (task.conversation || []).slice(-4);
  const previousRequest = [...recent]
    .reverse()
    .find((item) => item.role === "user" && requestsMealDataChange(item.content));
  if (previousRequest)
    return `[이전 요청]\n${previousRequest.content}\n[현재 후속 요청]\n${task.message}`;
  const previousAnswer = [...recent]
    .reverse()
    .find((item) => item.role === "assistant" && String(item.content || "").trim());
  return previousAnswer
    ? `[직전 AI 답변]\n${previousAnswer.content}\n[현재 사용자의 실행 요청]\n${task.message}`
    : null;
}
function confirmationQuestion(decisions, instruction) {
  if (task.confirmedFollowup) return null;
  const confirmed = /(확인했|확인\s*후|동의|진행\s*해|실행\s*해|그래\s*,?\s*해|정말\s*삭제)/.test(
    String(instruction || ""),
  );
  if (confirmed) return null;
  const broad = decisions.find((decision) => decision.intent === "DELETE_RECIPE" && decision.all === true);
  if (!broad) return null;
  return `${broad.weekStart} 주차의 레시피를 모두 삭제하면 자동 장보기도 다시 계산됩니다. 계속하려면 ‘확인했어, 진행해줘’라고 답해 주세요.`;
}
function currentKstDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
function validMonth(value) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || ""));
}
function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}
function validWeek(value) {
  return validDate(value) && new Date(`${value}T00:00:00Z`).getUTCDay() === 0;
}
async function classifyChatMutations(ruleFiles) {
  const targetMonth = selectedMutationMonth(task.message, task.targetMonth);
  if (requestsMealDeletion(task.message)) {
    if (/(?:재구성|재생성|새로\s*만들|장보기|재고|가중치|선택\s*확률|취향)/.test(task.message))
      return [{ intent: "CLARIFY", answer: "식단 삭제와 다른 변경은 한 번에 실행하지 않습니다. 삭제할 날짜 범위를 먼저 요청해 주세요." }];
    return [{ intent: "DELETE_MEALS" }];
  }
  if (requestsSelectedWeekRegeneration(task.message))
    return [{ intent: "REGENERATE_WEEK", weekStart: task.weekStart }];
  if (
    /(?:예산|식비)[^\n]{0,30}\d[\d,]*(?:만\s*)?원[^\n]{0,20}(?:안으로|이하|넘지|맞춰)/.test(String(task.message || "")) &&
    /(?:식단|메뉴|짜|구성|만들)/.test(String(task.message || ""))
  )
    return [{
      intent: "CLARIFY",
      answer: "현재는 식재료의 실제 판매 가격 데이터가 없어 정확한 금액 상한을 보장할 수 없습니다. 저렴한 재료 중심으로 구성할 수는 있지만, 금액 제한을 적용하려면 기준 가격이나 최근 장보기 가격이 필요합니다.",
    }];
  if (/(?:월간\s*(?:식단|메뉴)|(?:20\d{2}\s*년\s*)?\d{1,2}\s*월(?:의)?\s*(?:전체\s*)?(?:식단|메뉴)|(?:이번|다음)\s*달(?:의)?\s*(?:식단|메뉴))/.test(String(task.message || "")))
    return [{ intent: "CLARIFY", answer: "월간 식단 생성은 종료했습니다. 구성할 주차의 날짜를 알려주세요." }];
  const result = await ask(
    systemPrompt(ruleFiles) +
      `\n\n사용자의 변경 요청을 실행 순서대로 하나 이상의 앱 기능으로 분류한다. 실제 변경은 하지 말고 아래 JSON만 반환한다.
intent는 UPDATE_MEALS, DELETE_MEALS, GENERATE_WEEK, REGENERATE_WEEK, REGENERATE_RECIPES, ADD_RECIPE, DELETE_RECIPE, REGENERATE_GROCERY, ADD_GROCERY, DELETE_GROCERY, SET_GROCERY_PURCHASED, MANAGE_PANTRY, UPDATE_FAMILY, UPDATE_WEEKLY_REVIEW, UPDATE_PREFERENCE, UPDATE_ATTENDANCE, SET_CATALOG_WEIGHT, CLARIFY 중 하나다.
식단이 없는 특정 주를 만들어 달라는 요청은 GENERATE_WEEK, 이미 있는 주 전체를 다시 구성하라는 요청은 REGENERATE_WEEK다. 월간 생성은 지원하지 않으며 월 전체 요청에는 주차를 물어보는 CLARIFY를 반환한다.
레시피 추가는 반드시 현재 식단에 있는 메뉴의 레시피를 보충하는 의미다. 레시피 삭제는 제목이 특정되어야 한다.
냉장고·펜트리·보유 재료의 추가·수정·증감·삭제는 MANAGE_PANTRY다. 가족의 알레르기·씹기·매운맛·선호 메모 변경은 UPDATE_FAMILY다. 이번 주만 먹고 싶은 음식·피할 음식·주간 메모 저장은 UPDATE_WEEKLY_REVIEW다. 이 경우 지속 취향을 변경하지 않는다.
카탈로그 기본메뉴의 선택 확률·가중치를 0~500% 정수로 지정하면 SET_CATALOG_WEIGHT다. 정확한 기본메뉴명 또는 퍼센트가 없으면 CLARIFY다. 기존 식단은 바꾸지 않는다.
구체적인 메뉴에 대해 앞으로 넣어줘·앞으로 빼줘·먹어봤어·생소해처럼 지속 취향이나 익숙함을 알려주면 UPDATE_PREFERENCE다. 식단 편성이나 레시피 존재로 취향을 추론하지 않는다. usage와 familiarity는 독립이며 사용자가 말한 필드만 포함한다. 가족 대상이 생략된 일반 요청은 family, 아기만 등의 명시가 있으면 해당 role이다. 오늘 메뉴·이것 등의 지시어는 현재 컨텍스트로 단일 메뉴를 식별할 수 없으면 CLARIFY다. 취향 저장만 요청했으면 UPDATE_MEALS를 추가하지 않는다. '잘 먹었어'만으로 ALLOW를 기록하지 않는다. 메뉴 구분은 현재 후보로 확인하고 여러 구분에 있으면 CLARIFY다.
날짜·제목·품목이 불명확하여 여러 대상을 바꿀 수 있으면 CLARIFY와 자연스러운 한국어 answer를 반환한다.
이번 주는 ${task.weekStart}, 선택 월은 ${targetMonth}, 오늘은 ${currentKstDate()}다.
레시피를 모두·전부·전체 삭제하라는 명시적 요청에만 all을 true로 한다.
서로 독립된 변경이 여러 개면 actions에 각각 넣는다. 한 작업의 대상이 모호하면 CLARIFY 하나만 반환한다. 최대 20개다. 가격 데이터가 없는 상태에서 정확한 예산 상한을 요구하면 저장하지 말고 CLARIFY로 현재는 금액 준수를 보장할 수 없다고 답한다.
형식: {"actions":[{"intent":"...","answer":"확인 질문 또는 빈 문자열","month":"YYYY-MM","weekStart":"YYYY-MM-DD 일요일","date":"YYYY-MM-DD 또는 null","dates":["YYYY-MM-DD"],"title":"레시피 제목 또는 null","category":"주찬|반찬|점심|null","all":false,"catalogBaseName":"정확한 기본메뉴명 또는 null","sourceCategory":"카탈로그 원본 분류 또는 null","weightPercent":100,"groceryName":"품목명 또는 null","quantity":1,"unit":"개","groceryCategory":"기타","purchased":true,"pantry":{"operation":"upsert|adjust|delete","name":"재료명","quantity":1,"unit":"g|kg|ml|L|개|팩|봉|병|캔|모|단|통|장|마리","category":"냉장|냉동|실온|기타","expiresAt":"YYYY-MM-DD 또는 null"},"preference":{"name":"정확한 메뉴명","category":"주찬|부찬|국/탕/찌개|한그릇|점심|아기","scope":"family|father|mother|child","usage":"UNKNOWN|ALLOW|AVOID (사용 여부를 말한 경우만)","familiarity":"UNKNOWN|FAMILIAR|UNFAMILIAR (익숙함을 말한 경우만)","note":"명시한 메모만"},"familyUpdate":{"role":"father|mother|child","name":null,"allergies":null,"chewingAbility":null,"spiceTolerance":null,"dietaryNotes":null},"weeklyReview":{"referenceDate":"YYYY-MM-DD","wantedFoods":null,"avoidFoods":null,"note":null},"dinnerDiningOut":null,"attendance":[{"role":"father|mother","lunchNotAtHome":true,"dinnerNotAtHome":false,"isWorking":null,"eatsAtCompany":null,"isAway":null,"note":null}]}]}`,
    `[사용자 요청]\n${task.message}\n[현재 주간 컨텍스트]\n${JSON.stringify(context(task.weekStart))}`,
    false,
  );
  const classified = modelJson(result.content);
  const allowed = new Set([
    "UPDATE_MEALS", "DELETE_MEALS", "GENERATE_WEEK", "REGENERATE_WEEK", "REGENERATE_RECIPES",
    "ADD_RECIPE", "DELETE_RECIPE", "REGENERATE_GROCERY", "ADD_GROCERY",
    "DELETE_GROCERY", "SET_GROCERY_PURCHASED", "MANAGE_PANTRY",
    "UPDATE_FAMILY", "UPDATE_WEEKLY_REVIEW", "UPDATE_PREFERENCE", "UPDATE_ATTENDANCE", "SET_CATALOG_WEIGHT", "CLARIFY",
  ]);
  const rawDecisions = Array.isArray(classified.actions)
    ? classified.actions
    : [classified];
  if (rawDecisions.length > 20)
    return [{ intent: "CLARIFY", answer: "한 번에 처리할 변경이 20개를 넘습니다. 날짜나 항목을 나누어 요청해 주세요." }];
  const decisions = rawDecisions
    .map((decision) => {
      if (!decision || !allowed.has(decision.intent))
        return { intent: "CLARIFY", answer: "어떤 항목을 어떻게 변경할지 조금 더 구체적으로 알려주세요." };
      decision.month = validMonth(decision.month) ? decision.month : targetMonth;
      decision.weekStart = validWeek(decision.weekStart)
        ? decision.weekStart
        : validDate(decision.date)
          ? sundayForDate(decision.date)
          : task.weekStart;
      return decision;
    });
  return decisions.length
    ? decisions
    : [{ intent: "CLARIFY", answer: "어떤 항목을 어떻게 변경할지 조금 더 구체적으로 알려주세요." }];
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
      "\n\n이번 작업은 AI 채팅에서 받은 실제 식단 변경 요청이다. 요청한 날짜만 바꾸고 날짜가 불명확하면 mealChanges를 비운 채 answer에 확인 질문을 작성한다. '7일부터 9일까지'는 선택 월의 7·8·9일을 모두 뜻한다. 각 mealChanges에는 기존 값을 유지하는 항목도 포함해 date, mealStyle, lunch, main, soup(국/탕/찌개 중심일 때), sides 두 개를 완전하게 반환한다. 레시피는 후속 작업에서 별도로 생성하므로 recipes는 만들지 않는다. JSON: {\"answer\":\"처리 결과 또는 확인 질문\",\"changeReason\":\"변경 이유\",\"mealChanges\":[...]}",
    `[오늘]\n${today}\n[선택 월]\n${targetMonth}\n[월간 컨텍스트]\n${JSON.stringify(month)}\n[사용자 요청]\n${task.message}`,
    false,
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
  if (changes.length > 31)
    throw new Error("채팅에서는 한 번에 최대 31일까지만 변경할 수 있습니다.");
  const dates = changes.map((change) => String(change.date || ""));
  if (
    new Set(dates).size !== dates.length ||
    dates.some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(date) || !date.startsWith(`${targetMonth}-`))
  )
    throw new Error(`변경 날짜는 ${targetMonth} 안에서 중복 없이 지정해야 합니다.`);
  const existingDates = new Set(month.existingMonthMeals.map((meal) => meal.date));
  if (dates.some((date) => !existingDates.has(date)))
    throw new Error("요청한 날짜 중 저장된 식단이 없는 날이 있습니다.");
  const validatedChanges = [];
  const expectedRevisions = {};
  for (const change of changes) {
    const weekStart = sundayForDate(change.date);
    const current = context(weekStart);
    expectedRevisions[change.date] = current.meals?.find((meal) => meal.date === change.date)?.revision;
    let dayPayload = {
      schemaVersion: "meal-week.v1",
      weekStart,
      changeReason: String(requested.changeReason || task.message).slice(0, 1000),
      mealChanges: [change],
      recipes: [],
    };
    dayPayload = await completePayload(
      dayPayload,
      compactPlannerContext(current),
      ruleFiles,
      `${change.date} 식단만 변경하고 레시피는 만들지 않는다.`,
      (candidate) => validate(
        "validate-day",
        { ...candidate, recipes: [] },
        ["--week", weekStart, "--date", change.date],
      ),
      false,
    );
    dayPayload.recipes = [];
    validatedChanges.push(dayPayload.mealChanges[0]);
  }
  const combinedPayload = {
    schemaVersion: "meal-days.v1",
    changeReason: String(requested.changeReason || task.message).slice(0, 1000),
    mealChanges: validatedChanges,
    expectedRevisions,
  };
  const publishResult = JSON.parse(String(publish("publish-days", writeInput("chat-days", combinedPayload), [])));
  const weeks = [...new Set(dates.map(sundayForDate))];
  const failedRecipeWeeks = [];
  for (const weekStart of weeks) {
    try {
      await generateWeekRecipes(
        ruleFiles,
        weekStart,
        `${dates.filter((date) => sundayForDate(date) === weekStart).join(", ")} 변경 메뉴의 레시피를 보충하고 기존에 검증된 레시피는 재사용한다.`,
      );
    } catch (error) {
      failedRecipeWeeks.push(weekStart);
      console.warn("Meal changes were saved but recipe refresh failed:", error instanceof Error ? error.message : error);
    }
  }
  const recipeStatus = failedRecipeWeeks.length
    ? `식단은 모두 저장했지만 ${failedRecipeWeeks.join(", ")} 주차의 레시피와 장보기 갱신은 완료하지 못했습니다.`
    : "관련 레시피와 장보기도 다시 계산했습니다.";
  return {
    answer: `${String(requested.answer || "").trim() || `${dates.join(", ")} 식단을 변경했습니다.`} ${recipeStatus}`
      + (publishResult.overallQuality?.highWarnings?.length
        ? ` 최종 식단 품질 ${publishResult.overallQuality.score}/100이며 높은 경고 ${publishResult.overallQuality.highWarnings.length}건이 남았습니다.` : ""),
    sources: citations(result.annotations),
  };
}

function recipeRequirement(current, title, requestedDates = []) {
  const normalized = String(title || "").trim();
  if (!normalized) return null;
  const matches = [];
  for (const meal of current.meals || []) {
    if (meal.main === normalized)
      matches.push({ date: meal.date, category: "주찬" });
    if ((meal.sides || []).includes(normalized))
      matches.push({ date: meal.date, category: "반찬" });
    const day = new Date(`${meal.date}T00:00:00Z`).getUTCDay();
    if ([0, 6].includes(day) && meal.lunch === normalized)
      matches.push({ date: meal.date, category: "점심" });
  }
  const dateSet = new Set((requestedDates || []).filter(validDate));
  const scoped = dateSet.size
    ? matches.filter((match) => dateSet.has(match.date))
    : matches;
  if (!scoped.length) return null;
  return {
    title: normalized,
    category: scoped[0].category,
    plannedDates: [...new Set(scoped.map((match) => match.date))].sort(),
  };
}

async function generateWeekRecipes(ruleFiles, weekStart, instruction) {
  if (!validWeek(weekStart))
    return { answer: "레시피를 만들 주차를 확인하지 못했습니다.", sources: [] };
  const current = context(weekStart);
  if (!current.meals?.length)
    return { answer: `${weekStart} 주차에는 저장된 식단이 없습니다.`, sources: [] };
  const modelContext = compactPlannerContext(current);
  const reuseInstruction = current.reusableRecipes?.length
    ? "\n[재사용 규칙]\n컨텍스트의 reusableRecipes는 SQLite에서 검증된 정확히 같은 메뉴다. 이 레시피는 다시 검색하지 말고 그대로 포함하며, 누락된 메뉴만 검색한다."
    : "";
  const searchBudget = Math.min(
    20,
    Math.max(4, 22 - (current.reusableRecipes?.length || 0)),
  );
  const scope =
    "주간 식단 메뉴는 바꾸지 않는다. mealChanges는 빈 배열이다. 선택 주의 저녁 주찬·부찬과 집에서 먹는 주말 점심 레시피를 빠짐없이 준비한다. " +
    instruction;
  const result = await ask(
    systemPrompt(ruleFiles),
    `[주간 컨텍스트]\n${JSON.stringify(modelContext)}\n[사용자 요청]\n${task.message || task.prompt || instruction}\n[작업 범위]\n${scope}${reuseInstruction}\nmeal-week.v1 JSON만 반환한다.`,
    true,
    searchBudget,
  );
  let payload = mergeReusableRecipes(modelJson(result.content), current);
  payload = await completePayload(
    payload,
    modelContext,
    ruleFiles,
    scope,
    (candidate) => validate("validate-week", candidate, ["--week", weekStart]),
    true,
    searchBudget,
  );
  payload.expectedRevisions = Object.fromEntries(current.meals.map((meal) => [meal.date, meal.revision]));
  publish(
    "publish-recipes",
    writeInput(`chat-recipes-${weekStart}`, payload),
    ["--week", weekStart],
  );
  return {
    answer: `${weekStart} 주차의 식단에 맞춰 레시피를 저장했습니다. 식단 메뉴는 변경하지 않았습니다.`,
    sources: citations(result.annotations),
  };
}

async function runChatRecipeAction(ruleFiles, decision) {
  const weekStart = decision.weekStart;
  if (!validWeek(weekStart))
    return { answer: "레시피를 관리할 주차나 날짜를 알려주세요.", sources: [] };
  const current = context(weekStart);
  const title = String(decision.title || "").trim();
  if (decision.intent === "DELETE_RECIPE") {
    const deleteAll = decision.all === true;
    if (!title && !deleteAll)
      return { answer: "삭제할 레시피 이름을 알려주세요.", sources: [] };
    if (deleteAll) {
      if (!(current.existingRecipes || []).length)
        return { answer: `${weekStart} 주차에는 삭제할 레시피가 없습니다.`, sources: [] };
      ctl("delete-recipe", "--week", weekStart, "--all", "true");
      return {
        answer: `${weekStart} 주차의 레시피를 모두 삭제하고 장보기 항목을 다시 계산했습니다. 식단 메뉴는 유지했습니다.`,
        sources: [],
      };
    }
    const candidates = (current.existingRecipes || []).filter(
      (recipe) =>
        recipe.title === title ||
        recipe.title.includes(title) ||
        title.includes(recipe.title),
    );
    const categoryMatches = decision.category
      ? candidates.filter((recipe) => recipe.category === decision.category)
      : candidates;
    if (categoryMatches.length !== 1)
      return {
        answer: categoryMatches.length
          ? `같은 이름의 레시피가 여러 개입니다. 주찬·반찬·점심 중 종류와 날짜를 함께 알려주세요: ${categoryMatches.map((item) => `${item.title}(${item.category})`).join(", ")}`
          : `${weekStart} 주차에서 '${title}' 레시피를 찾지 못했습니다.`,
        sources: [],
      };
    const recipe = categoryMatches[0];
    ctl(
      "delete-recipe",
      "--week", weekStart,
      "--title", recipe.title,
      "--category", recipe.category,
      ...(validDate(decision.date) ? ["--date", decision.date] : []),
    );
    return {
      answer: `${formatDateLabel(recipe.plannedDates)} ${recipe.title}(${recipe.category}) 레시피를 삭제하고 해당 주 장보기를 다시 계산했습니다.`,
      sources: [],
    };
  }
  if (decision.intent === "ADD_RECIPE") {
    const requirement = recipeRequirement(
      current,
      title,
      Array.isArray(decision.dates)
        ? decision.dates
        : validDate(decision.date)
          ? [decision.date]
          : [],
    );
    if (!requirement)
      return {
        answer: `'${title || "요청한 메뉴"}'는 ${weekStart} 주차 식단에서 찾지 못했습니다. 먼저 식단에 메뉴를 추가하거나 정확한 메뉴명과 날짜를 알려주세요.`,
        sources: [],
      };
    const alreadyExists = (current.existingRecipes || []).some(
      (recipe) =>
        recipe.title === requirement.title &&
        recipe.category === requirement.category &&
        requirement.plannedDates.every((date) =>
          parseStoredDates(recipe.plannedDates).includes(date),
        ),
    );
    if (alreadyExists)
      return {
        answer: `${requirement.title} 레시피는 이미 ${weekStart} 주차에 저장되어 있습니다. 새 내용으로 바꾸려면 ‘${requirement.title} 레시피를 재생성해줘’라고 요청해 주세요.`,
        sources: [],
      };
    return generateWeekRecipes(
      ruleFiles,
      weekStart,
      `${requirement.title}(${requirement.category})의 ${requirement.plannedDates.join(", ")} 레시피를 반드시 보충한다.`,
    );
  }
  return generateWeekRecipes(
    ruleFiles,
    weekStart,
    "기존에 검증된 동일 메뉴 레시피는 재사용하고 누락된 레시피만 검색해 보충한다.",
  );
}

function parseStoredDates(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function formatDateLabel(value) {
  const dates = parseStoredDates(value);
  return dates.length ? dates.join(", ") : "선택한 주차의";
}

function runChatGroceryAction(decision) {
  const weekStart = decision.weekStart;
  if (!validWeek(weekStart))
    return { answer: "장보기를 관리할 주차나 날짜를 알려주세요.", sources: [] };
  if (decision.intent === "REGENERATE_GROCERY") {
    ctl("rebuild-shopping", "--week", weekStart);
    return { answer: `${weekStart} 주차의 검증된 레시피를 기준으로 장보기를 다시 계산했습니다.`, sources: [] };
  }
  const current = context(weekStart);
  let name = String(decision.groceryName || "").trim();
  if (!name)
    return { answer: "관리할 장보기 품목명을 알려주세요.", sources: [] };
  if (decision.intent !== "ADD_GROCERY") {
    const candidates = (current.shoppingItems || []).filter(
      (item) => item.name === name || item.name.includes(name) || name.includes(item.name),
    );
    const matches = candidates.filter(
      (item) => `${item.name} ${item.quantity}${item.unit}` === name,
    );
    if (!matches.length) matches.push(...candidates);
    if (matches.length !== 1)
      return {
        answer: matches.length
          ? `품목이 여러 개 검색됐습니다: ${matches.map((item) => `${item.name} ${item.quantity}${item.unit}`).join(", ")}. 정확한 이름과 단위를 알려주세요.`
          : `${weekStart} 주차 장보기에서 '${name}'을 찾지 못했습니다.`,
        sources: [],
      };
    name = matches[0].name;
    decision.unit = matches[0].unit;
  }
  const operation =
    decision.intent === "ADD_GROCERY"
      ? "add"
      : decision.intent === "DELETE_GROCERY"
        ? "delete"
        : "set_purchased";
  const payload = {
    operation,
    name,
    quantity: decision.quantity,
    unit: decision.unit,
    category: decision.groceryCategory,
    purchased: Boolean(decision.purchased),
  };
  const input = writeInput(`chat-grocery-${task.requestId}`, payload);
  try { ctl("manage-grocery", "--week", weekStart, "--input", input); }
  finally { fs.rmSync(input, { force: true }); }
  const verb = operation === "add" ? "추가" : operation === "delete" ? "삭제" : payload.purchased ? "구매 완료 처리" : "구매 미완료로 변경";
  return { answer: `${weekStart} 주차 장보기에서 '${name}'을 ${verb}했습니다.`, sources: [] };
}

function runChatAttendanceAction(decision) {
  if (!validDate(decision.date))
    return { answer: "식사 여부를 변경할 정확한 날짜를 알려주세요.", sources: [] };
  const payload = {
    dinnerDiningOut:
      typeof decision.dinnerDiningOut === "boolean"
        ? decision.dinnerDiningOut
        : undefined,
    attendance: Array.isArray(decision.attendance) ? decision.attendance : [],
  };
  if (payload.dinnerDiningOut === undefined && !payload.attendance.length)
    return { answer: "누가 어느 끼니를 집에서 먹지 않는지 알려주세요.", sources: [] };
  const input = writeInput(`chat-attendance-${task.requestId}`, payload);
  try { ctl("update-attendance", "--date", decision.date, "--input", input); }
  finally { fs.rmSync(input, { force: true }); }
  return { answer: `${decision.date}의 외식·가족 식사 여부를 날짜 상세에 반영했습니다.`, sources: [] };
}

function runChatPantryAction(decision) {
  const pantry = decision.pantry && typeof decision.pantry === "object"
    ? decision.pantry
    : null;
  if (!pantry || !String(pantry.name || "").trim())
    return { answer: "관리할 냉장고·펜트리 재료 이름과 수량을 알려주세요.", sources: [] };
  const input = writeInput(`chat-pantry-${task.requestId}`, pantry);
  try { ctl("manage-pantry", "--input", input); }
  finally { fs.rmSync(input, { force: true }); }
  const verb = pantry.operation === "delete"
    ? "삭제"
    : pantry.operation === "adjust"
      ? "수량 조정"
      : "저장";
  return { answer: `보유 재료 '${pantry.name}'을 ${verb}했습니다.`, sources: [] };
}

function runChatFamilyAction(decision) {
  const update = decision.familyUpdate && typeof decision.familyUpdate === "object"
    ? Object.fromEntries(
        Object.entries(decision.familyUpdate).filter(
          ([key, value]) => key === "role" || value !== null && value !== undefined,
        ),
      )
    : null;
  if (!update || !["father", "mother", "child"].includes(update.role))
    return { answer: "변경할 가족 구성원과 알레르기·식사 특성을 알려주세요.", sources: [] };
  const input = writeInput(`chat-family-${task.requestId}`, update);
  try { ctl("manage-family", "--input", input); }
  finally { fs.rmSync(input, { force: true }); }
  return { answer: `${update.role === "father" ? "아빠" : update.role === "mother" ? "엄마" : "아기"}의 가족 정보를 변경했습니다.`, sources: [] };
}

function runChatReviewAction(decision) {
  if (!validWeek(decision.weekStart))
    return { answer: "주간 점검을 저장할 주차나 날짜를 알려주세요.", sources: [] };
  const review = decision.weeklyReview && typeof decision.weeklyReview === "object"
    ? decision.weeklyReview
    : null;
  if (!review)
    return { answer: "먹고 싶은 음식, 피할 음식 또는 주간 메모를 알려주세요.", sources: [] };
  const input = writeInput(`chat-review-${task.requestId}`, review);
  try { ctl("manage-review", "--week", decision.weekStart, "--input", input); }
  finally { fs.rmSync(input, { force: true }); }
  return { answer: `${decision.weekStart} 주차의 점검 정보를 저장했습니다.`, sources: [] };
}

function runChatPreferenceAction(decision) {
  const input = writeInput(`chat-preference-${task.requestId}`, decision.preference);
  let saved;
  try { saved = JSON.parse(ctl("manage-preference", "--input", input)); }
  finally { fs.rmSync(input, { force: true }); }
  const scope = {family: "가족 전체", father: "아빠", mother: "엄마", child: "아기"}[saved.scope];
  return { answer: `${saved.name}의 ${scope} 취향을 저장했습니다. 기존 식단은 유지하고 이후 생성·재구성부터 반영합니다.`, sources: [] };
}

async function dispatchChatMutation(ruleFiles, decision) {
  if (decision.intent === "UPDATE_PREFERENCE") return runChatPreferenceAction(decision);
  if (decision.intent === "CLARIFY")
    return {
      answer: String(decision.answer || "변경할 날짜와 항목을 조금 더 구체적으로 알려주세요."),
      sources: [],
    };
  if (decision.intent === "UPDATE_MEALS") return runChatMealChange(ruleFiles);
  if (decision.intent === "SET_CATALOG_WEIGHT") {
    if (!String(decision.catalogBaseName || "").trim() || !Number.isInteger(decision.weightPercent))
      return { answer: "설정할 정확한 기본메뉴명과 0~500% 사이의 가중치를 알려주세요.", sources: [] };
    const result = JSON.parse(ctl("manage-catalog-weight", "--name", decision.catalogBaseName,
      "--weight", String(decision.weightPercent), ...(decision.sourceCategory ? ["--category", decision.sourceCategory] : [])));
    return { answer: `${result.sourceCategory}의 ${result.baseName} 선택 가중치를 ${result.weightPercent}%로 저장했습니다. 기존 식단은 유지하고 이후 생성부터 적용합니다.`, sources: [] };
  }
  if (decision.intent === "DELETE_MEALS") {
    const scope = mealDeletionScope(task.message, task.conversation || [], currentKstDate());
    if (!scope) return { answer: "삭제할 식단 날짜 범위를 정확히 알려주세요. 예: ‘2026년 10월 4일부터 10월 31일까지 식단 삭제해줘’. ", sources: [] };
    const args = ["--from", scope.from, ...(scope.to ? ["--to", scope.to] : [])];
    const preview = JSON.parse(ctl("delete-meals", ...args, "--preview", "true"));
    const range = scope.to ? `${scope.from}부터 ${scope.to}까지` : `${scope.from}부터 저장된 모든 미래 날짜`;
    if (!preview.deletedMeals) return { answer: `${range}에 저장된 식단이 없어 삭제할 내용이 없습니다.`, sources: [] };
    if (task.confirmedDeleteCount !== undefined && task.confirmedDeleteCount !== preview.deletedMeals)
      return { answer: `삭제 확인: 확인 후 대상이 ${task.confirmedDeleteCount}일에서 변경됐습니다. ${range}의 식단 ${preview.deletedMeals}일을 삭제할까요? 맞으면 ‘응’이라고 답해 주세요.`, sources: [] };
    if (!task.confirmedFollowup) return { answer: `삭제 확인: ${range}의 식단 ${preview.deletedMeals}일과 해당 날짜의 레시피 연결을 삭제할까요? 삭제 전 SQLite 백업을 만듭니다. 맞으면 ‘응’이라고 답해 주세요.`, sources: [] };
    const result = JSON.parse(ctl("delete-meals", ...args, "--confirm", "true"));
    const missing = Object.values(result.missingByWeek ?? {}).flat();
    return { answer: `${range}의 식단 ${result.deletedMeals}일을 삭제했습니다. 연결된 레시피 ${result.changedRecipes}건을 정리했고, SQLite 백업을 만들었습니다. 남은 식단의 자동 장보기를 다시 계산하고 직접 추가한 품목과 구매 완료 상태는 유지했습니다.${missing.length ? ` 레시피가 없는 메뉴 ${missing.length}개가 있어 장보기 계산은 아직 미완료입니다.` : ""}`, sources: [] };
  }
  if (decision.intent === "GENERATE_WEEK") {
    const week = decision.weekStart;
    if (context(week).meals?.length)
      return { answer: `${week} 주차 식단은 이미 있습니다. 기존 식단을 교체하려면 ‘이번 주 식단 다시 구성해줘’처럼 요청해 주세요.`, sources: [] };
    const payload = JSON.parse(ctl("generate-catalog-week", "--week", week));
    publish("publish-new-week", writeInput("chat-week-" + week, payload), ["--week", week]);
    return { answer: `${week}부터 일주일 식단을 생성했습니다. 레시피와 장보기는 별도로 준비해야 합니다.`, sources: [] };
  }
  if (decision.intent === "REGENERATE_WEEK") {
    const week = decision.weekStart;
    if (!validWeek(week))
      return { answer: "다시 구성할 주차를 확인하지 못했습니다. 날짜를 알려주세요.", sources: [] };
    const current = context(week);
    if (current.meals?.length && current.meals.length !== 7)
      return { answer: `${week} 주차는 일부 날짜만 저장되어 있어 전체를 자동으로 교체하지 않았습니다. 누락된 날짜를 먼저 확인해 주세요.`, sources: [] };
    const payload = JSON.parse(ctl("generate-catalog-week", "--week", week, "--salt", String(Date.now())));
    if (current.meals?.length) {
      payload.expectedRevisions = Object.fromEntries(current.meals.map((meal) => [meal.date, meal.revision]));
      const result = JSON.parse(publish("publish-days", writeInput("chat-regenerate-week-" + week, payload), []));
      const missing = Object.values(result.missingByWeek ?? {}).flat();
      return { answer: `${week}부터 일주일 식단을 다시 구성했습니다.${missing.length ? ` 레시피가 없는 메뉴 ${missing.length}개가 있어 장보기는 아직 미완료입니다.` : " 레시피와 장보기를 확인해 주세요."}`, sources: [] };
    }
    publish("publish-new-week", writeInput("chat-week-" + week, payload), ["--week", week]);
    return { answer: `${week}부터 일주일 식단을 생성했습니다. 레시피와 장보기는 별도로 준비해야 합니다.`, sources: [] };
  }
  if (["REGENERATE_RECIPES", "ADD_RECIPE", "DELETE_RECIPE"].includes(decision.intent))
    return runChatRecipeAction(ruleFiles, decision);
  if (["REGENERATE_GROCERY", "ADD_GROCERY", "DELETE_GROCERY", "SET_GROCERY_PURCHASED"].includes(decision.intent))
    return runChatGroceryAction(decision);
  if (decision.intent === "MANAGE_PANTRY") return runChatPantryAction(decision);
  if (decision.intent === "UPDATE_FAMILY") return runChatFamilyAction(decision);
  if (decision.intent === "UPDATE_WEEKLY_REVIEW") return runChatReviewAction(decision);
  if (decision.intent === "UPDATE_ATTENDANCE")
    return runChatAttendanceAction(decision);
  return { answer: "요청한 작업을 처리할 수 없습니다. 변경할 날짜와 항목을 다시 알려주세요.", sources: [] };
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
function mergeQualityRepair(original, revised, issues, protectedText = "", current = null) {
  const affectedDates = new Set(issues.flatMap((issue) => issue.dates ?? []));
  const revisedByDate = new Map((revised.mealChanges ?? []).map((change) => [change.date, change]));
  const protectedMenu = (name) => name && String(protectedText).includes(String(name));
  const sideSignature = (sides) => Array.isArray(sides) ? [...sides].sort().join("|") : "";
  return {
    ...original,
    mealChanges: (original.mealChanges ?? []).map((change) => {
      if (!affectedDates.has(change.date)) return change;
      const replacement = revisedByDate.get(change.date);
      if (!replacement) return change;
      const dateIssues = issues.filter((issue) => (issue.dates ?? []).includes(change.date));
      const changeMain = dateIssues.some((issue) => !issue.slot || ["main", "noodle", "rice"].includes(issue.slot));
      const changeSoup = dateIssues.some((issue) => !issue.slot || issue.slot === "soup");
      const changeSides = dateIssues.some((issue) => issue.slot === "side");
      const repeatedSidePair = (current?.meals ?? []).some((meal) =>
        meal.date !== change.date && Math.abs(Date.parse(meal.date) - Date.parse(change.date)) <= 86_400_000
          && sideSignature(meal.sides) === sideSignature(change.sides));
      return { ...change,
        mealStyle: changeMain && !protectedMenu(change.main) ? replacement.mealStyle ?? change.mealStyle : change.mealStyle,
        main: changeMain && !protectedMenu(change.main) ? replacement.main ?? change.main : change.main,
        soup: changeSoup && !protectedMenu(change.soup) ? replacement.soup ?? change.soup : change.soup,
        sides: changeSides && !repeatedSidePair && Array.isArray(replacement.sides) && change.sides?.every((name) => !protectedMenu(name))
          ? replacement.sides : change.sides,
      };
    }),
  };
}
async function completePayload(payload, current, ruleFiles, scope, runValidation, search, searchBudget = 6, repairQuality = false, protectedText = "") {
  let candidate = payload;
  let validFallback = null;
  let qualityRepairIssues = [];
  let qualityRepairTried = false;
  let errorRepairs = 0;
  while (true) {
    const validation = runValidation(candidate);
    if (validation.valid) {
      const highIssues = repairQuality && !qualityRepairTried
        ? (validation.qualityIssues ?? []).filter((issue) => issue.severity === "HIGH")
          .filter((issue) => (issue.dates ?? []).some((date) => {
            const change = (candidate.mealChanges ?? []).find((meal) => meal.date === date);
            if (!change) return false;
            if (issue.slot === "side") {
              const signature = (sides) => Array.isArray(sides) ? [...sides].sort().join("|") : "";
              return !change.sides?.some((name) => String(protectedText).includes(String(name)))
                && !(current?.meals ?? []).some((meal) => meal.date !== date
                  && Math.abs(Date.parse(meal.date) - Date.parse(date)) <= 86_400_000
                  && signature(meal.sides) === signature(change.sides));
            }
            if (issue.slot === "soup") return !change.soup || !String(protectedText).includes(change.soup);
            return !change.main || !String(protectedText).includes(change.main);
          }))
          .sort((a, b) => Number(a.slot === "side") - Number(b.slot === "side")) : [];
      if (!highIssues.length) return candidate;
      validFallback = candidate;
      qualityRepairIssues = highIssues;
      qualityRepairTried = true;
      try {
        const result = await ask(
          systemPrompt(ruleFiles) + "\n\n최종 식단은 저장 검증을 통과했지만 카탈로그 일치·역할·다양성 경고가 높다. 경고 날짜의 메뉴만 정확한 카탈로그 세부메뉴로 필요한 만큼 바꾼 완전한 JSON을 반환한다. 출처 확인된 레시피나 가족이 명시적으로 확인한 집 메뉴도 허용한다. 다른 날짜와 가족 일정, 명시적 메뉴 요청은 그대로 둔다. 부찬 2~3일 묶음은 유지하고, 이름만 바꾼 같은 유사메뉴그룹은 대체하지 않는다.",
          "[현재 컨텍스트]\n" + JSON.stringify(current) + "\n[작업 범위]\n" + scope
            + "\n[품질 점수]\n" + validation.qualityScore + "/100"
            + "\n[높은 품질 경고]\n" + JSON.stringify(highIssues.slice(0, 24))
            + "\n[보존할 명시 요청]\n" + protectedText
            + "\n[수정할 JSON]\n" + JSON.stringify(candidate),
          search,
          searchBudget,
        );
        candidate = mergeQualityRepair(validFallback, modelJson(result.content), highIssues, protectedText, current);
        continue;
      } catch {
        return validFallback;
      }
    }
    if (errorRepairs >= 2) {
      if (validFallback) return validFallback;
      throw new Error("AI 결과가 저장 검증을 통과하지 못했습니다: "
        + validationProblems(validation).join("; ").slice(0, 1800));
    }
    errorRepairs += 1;
    const problems = validationProblems(validation);
    try {
      const result = await ask(
        systemPrompt(ruleFiles) + "\n\n직전 JSON이 저장 검증에 실패했다. 아래 오류를 모두 해결한 완전한 교체 JSON만 반환한다. 레시피 출처 오류가 있으면 웹 검색과 원문 읽기로 확인하고, 확인하지 못한 URL을 추측해서 채우면 안 된다.",
        "[현재 컨텍스트]\n" + JSON.stringify(current) + "\n[작업 범위]\n" + scope + "\n[검증 오류]\n" + problems.join("\n") + "\n[수정할 JSON]\n" + JSON.stringify(candidate),
        search,
        searchBudget,
      );
      const repaired = modelJson(result.content);
      candidate = validFallback ? mergeQualityRepair(validFallback, repaired, qualityRepairIssues, protectedText, current) : repaired;
    } catch (error) {
      if (validFallback) return validFallback;
      throw error;
    }
  }
}

async function runChat() {
  const ruleFiles = rules();
  const confirmed = confirmedFollowup(task.message, task.conversation || []);
  if (!confirmed && ambiguousOldConfirmation(task.message, task.conversation || [])) {
    publish("reply-chat", writeInput("chat-" + task.requestId, {
      answer: "이전 삭제 확인은 대상 범위를 안전하게 확정할 수 없습니다. 삭제할 날짜 범위를 다시 적어 주세요. 예: ‘2026년 10월 4일부터 10월 31일까지 식단 삭제해줘’. 그러면 삭제 건수를 확인한 뒤 실행하겠습니다.",
      sources: [],
    }), ["--id", task.requestId]);
    notify();
    return;
  }
  task.confirmedFollowup = Boolean(confirmed);
  task.confirmedDeleteCount = confirmed?.expectedCount;
  if (confirmed) task.message = confirmed.message;
  const mutationInstruction = effectiveMutationInstruction();
  if (mutationInstruction) {
    task.message = mutationInstruction;
    const decisions = await classifyChatMutations(ruleFiles);
    const clarification = decisions.find((decision) => decision.intent === "CLARIFY");
    const multipleActions = !clarification && decisions.length > 1;
    const confirmation = clarification
      ? null
      : confirmationQuestion(decisions, mutationInstruction);
    const responses = [];
    if (clarification) responses.push(await dispatchChatMutation(ruleFiles, clarification));
    else if (multipleActions)
      responses.push({
        answer: `서로 독립된 변경 ${decisions.length}개가 함께 요청됐습니다. 일부만 저장되는 일을 막기 위해 한 번에 하나씩 요청해 주세요.`,
        sources: [],
      });
    else if (confirmation) responses.push({ answer: confirmation, sources: [] });
    else {
      for (const decision of decisions) {
        try {
          responses.push(await dispatchChatMutation(ruleFiles, decision));
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          responses.push({
            answer: responses.length
              ? `앞의 ${responses.length}개 변경은 저장됐지만 다음 작업은 실패했습니다: ${detail}`
              : `변경을 저장하지 못했습니다: ${detail}`,
            sources: [],
          });
          break;
        }
      }
    }
    const response = {
      answer: responses.map((item) => item.answer).filter(Boolean).join("\n"),
      sources: responses.flatMap((item) => item.sources || []).slice(0, 8),
    };
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
    systemPrompt(ruleFiles) + "\n\n이번 질문에는 저장할 변경이 명시되지 않았다. 현재 데이터를 설명하고, 변경을 원한다면 대상 날짜와 내용을 구체적으로 요청할 수 있다고 안내한다. 이 응답에서는 데이터를 저장하지 않는다. 칼로리는 정확한 중량이 없으면 추정 범위와 가정을 밝힌다. JSON: {\"answer\":\"한국어 답변\",\"sources\":[{\"title\":\"출처\",\"url\":\"https://...\"}]}",
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
  if (task.action === "PUBLISH_WEEK") {
    const current = context(task.weekStart);
    if (current.meals?.length)
      throw new Error(`${task.weekStart} 주차 식단이 이미 있어 자동 생성으로 덮어쓰지 않습니다.`);
    const input = writeInput("new-week-" + task.weekStart,
      JSON.parse(ctl("generate-catalog-week", "--week", task.weekStart)));
    publish("publish-new-week", input, ["--week", task.weekStart, "--request-id", task.requestId]);
    notify(); return;
  }
  if (task.action === "REGENERATE_GROCERY") {
    ctl("rebuild-shopping", "--week", task.weekStart, "--request-id", task.requestId);
    notify(); return;
  }
  const ruleFiles = rules();
  if (task.action === "PUBLISH_MONTH") {
    throw new Error("월간 자동 생성은 종료되었습니다. 주간 식단 생성으로 다시 요청해 주세요.");
  }

  const current = context(task.weekStart);
  if (task.action === "REVIEW_WEEK") {
    if (current.meals?.length !== 7)
      throw new Error(`${task.weekStart} 주차 식단이 7일 모두 저장된 뒤에 점검할 수 있습니다.`);
    const referenceDate = current.weeklyReview?.referenceDate || task.weekStart;
    const result = await ask(
      systemPrompt(ruleFiles) + "\n\n주간 점검이다. referenceDate부터 토요일까지만 판단한다. selectionPreview의 urgentPantryMatches는 저장된 세부메뉴 레시피 재료와 보유 재료를 대조한 결과다. 소비기한이 3일 이내인 재료가 있고 현재 식단보다 해당 재료를 자연스럽게 소진할 후보가 있으면 그 날짜의 메뉴를 변경한다. 이미 현재 메뉴로 충분히 소진하거나 기피·알레르기·반복 제한과 충돌하면 유지할 수 있다. 유지하면 {\"decision\":\"maintain\",\"summary\":\"...\"}; 수정하면 {\"decision\":\"change\",\"changeReason\":\"...\",\"mealChanges\":[...]}를 반환한다. 레시피는 후속 작업에서 별도로 생성한다.",
      "[주간 컨텍스트]\n" + JSON.stringify(current) + "\n[사용자 점검 정보]\n" + task.prompt,
      false,
    );
    let payload = modelJson(result.content);
    if (payload.decision === "maintain") {
      const latest = context(task.weekStart);
      if (latest.selectionRevision !== current.selectionRevision || latest.meals?.some((meal, index) => meal.revision !== current.meals[index]?.revision))
        throw new Error("주간 점검 중 설정 또는 식단이 변경되었습니다. 다시 점검해 주세요.");
      ctl("record-review", "--week", task.weekStart, "--summary", String(payload.summary || "현재 식단을 유지합니다."), "--request-id", task.requestId);
      notify(); return;
    }
    if (payload.decision !== "change" || !Array.isArray(payload.mealChanges) || !payload.mealChanges.length)
      throw new Error("주간 점검 결과 형식이 올바르지 않습니다.");
    assertReviewDates(payload.mealChanges, task.weekStart, referenceDate);
    const reviewedChanges = [];
    for (const rawChange of payload.mealChanges) {
      const change = catalogDinnerForDate(rawChange, current);
      let dayPayload = { schemaVersion: "meal-week.v1", weekStart: task.weekStart,
        changeReason: String(payload.changeReason || "주간 점검 결과 식단을 조정했습니다."),
        mealChanges: [change], recipes: [] };
      const scope = change.date + " 하루 식단만 변경하고 레시피는 만들지 않는다.";
      dayPayload = await completePayload(
        dayPayload,
        compactPlannerContext(context(task.weekStart)),
        ruleFiles,
        scope,
        (candidate) => validate(
          "validate-day",
          { ...candidate, recipes: [] },
          ["--week", task.weekStart, "--date", change.date],
        ),
        false,
        6,
        false,
        `${task.prompt || ""}\n${current.weeklyReview?.wantedFoods || ""}`,
      );
      dayPayload.recipes = [];
      const verified = dayPayload.mealChanges?.[0];
      if (verified?.date !== change.date)
        throw new Error("주간 점검 보정 결과가 요청 날짜를 벗어났습니다.");
      reviewedChanges.push(verified);
    }
    assertReviewDates(reviewedChanges, task.weekStart, referenceDate);
    publish("publish-days", writeInput("review-" + task.weekStart, {
      schemaVersion: "meal-days.v1", changeReason: String(payload.changeReason || "주간 점검 결과 식단을 조정했습니다."),
      mealChanges: reviewedChanges, recipes: [],
      selectionRevision: current.selectionRevision,
      expectedRevisions: Object.fromEntries(current.meals.map((meal) => [meal.date, meal.revision])),
    }), []);
    let summary = String(payload.changeReason || "주간 점검 결과 식단을 조정했습니다.");
    try {
      await generateWeekRecipes(
        ruleFiles,
        task.weekStart,
        "주간 점검으로 변경된 메뉴의 레시피를 보충하고 검증된 기존 레시피는 재사용한다.",
      );
      summary += " 관련 레시피와 장보기도 다시 계산했습니다.";
    } catch (error) {
      console.warn("Weekly meals were saved but recipe refresh failed:", error instanceof Error ? error.message : error);
      summary += " 식단은 저장했지만 레시피와 장보기 갱신은 완료하지 못했습니다.";
    }
    ctl("record-review", "--week", task.weekStart, "--summary", summary, "--request-id", task.requestId, "--changed", "true");
    notify(); return;
  }

  const isDaily = task.action === "UPDATE_DAY";
  const scope = isDaily
    ? "선택 날짜 " + task.date + " 식단만 변경한다. mealChanges는 그 날짜 하나만 포함하고 recipes는 빈 배열로 둔다."
    : task.action === "REGENERATE_RECIPES"
      ? "주간 식단 메뉴는 절대 바꾸지 않는다. mealChanges는 빈 배열이다. 선택 주의 저녁 주찬·부찬과 집에서 먹는 주말 점심 레시피를 모두 만든다."
      : "주간 식단 메뉴는 절대 바꾸지 않는다. mealChanges는 빈 배열이다. 선택 주의 레시피를 모두 만들고 장보기에 쓸 수 있게 한다.";

  if (!isDaily && current.reusableRecipes?.length) {
    const reusablePayload = {
      schemaVersion: "meal-week.v1",
      weekStart: task.weekStart,
      changeReason: "SQLite에서 검증된 동일 메뉴 레시피를 재사용했습니다.",
      mealChanges: [],
      recipes: current.reusableRecipes,
      expectedRevisions: Object.fromEntries((current.meals ?? []).map((meal) => [meal.date, meal.revision])),
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
    ? 0
    : Math.min(20, Math.max(4, 22 - (current.reusableRecipes?.length || 0)));
  const result = await ask(systemPrompt(ruleFiles),
    "[주간 컨텍스트]\n" + JSON.stringify(modelContext) + "\n[사용자 요청]\n" + task.prompt + "\n[작업 범위]\n" + scope + reuseInstruction + "\nmeal-week.v1 JSON만 반환한다.", !isDaily, searchBudget);
  let payload = modelJson(result.content);
  if (isDaily) payload.recipes = [];
  else payload = mergeReusableRecipes(payload, current);
  payload = await completePayload(
    payload,
    modelContext,
    ruleFiles,
    scope,
    (candidate) => isDaily
      ? validate("validate-day", candidate, ["--week", task.weekStart, "--date", task.date])
      : validate("validate-week", candidate, ["--week", task.weekStart]),
    !isDaily,
    searchBudget,
  );
  if (isDaily) payload.recipes = [];
  payload.expectedRevisions = Object.fromEntries((current.meals ?? []).map((meal) => [meal.date, meal.revision]));
  if (isDaily) payload.selectionRevision = current.selectionRevision;
  const input = writeInput((isDaily ? "day-" + task.date : "week-" + task.weekStart), payload);
  if (isDaily) {
    publish("publish-day", input, ["--week", task.weekStart, "--date", task.date, "--request-id", task.requestId]);
    try {
      await generateWeekRecipes(
        ruleFiles,
        task.weekStart,
        `${task.date} 변경 메뉴의 레시피를 보충하고 검증된 기존 레시피는 재사용한다.`,
      );
    } catch (error) {
      console.warn("Daily meal was saved but recipe refresh failed:", error instanceof Error ? error.message : error);
    }
  }
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
