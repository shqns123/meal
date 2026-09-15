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
    "dishPreferences의 lastPlannedAt은 해당 메뉴가 식단에 마지막으로 편성된 날짜다. 새 식단을 만들 때 최근 편성 메뉴의 반복 간격을 판단하는 참고 자료로 사용하되, 허용 여부·알레르기·사용자 요청보다 우선하지 않는다.",
    "월간 컨텍스트의 menuCatalog는 만개의레시피에서 수집한 식사형태·조리계열·기본 메뉴·세부 메뉴 계층이다. selectionPreview는 AVOID 메뉴를 제외하고 ALLOW와 UNKNOWN 세부메뉴를 대상으로 최근 식단을 반영해 고른 후보이다. UNKNOWN은 미확인 상태 그대로 저장할 수 있으며 ALLOW로 추정하지 않는다. 기본 메뉴별 동일한 기본 확률과 세부 메뉴 30일·기본 메뉴 10~14일·유사메뉴그룹 5~8일·조리계열/주재료 2일 쿨다운을 참고한다. 월간 완성본에서는 이름만 다른 비슷한 주찬의 근접 반복, 조리법·주재료의 3일 연속 반복과 주간 쏠림을 피한다. 부찬 조합을 2~3일 유지하는 것은 의도된 반복이다.",
    "카탈로그의 정확한 세부메뉴명을 사용한다. selectionPreview의 sides는 3일 조리 묶음 후보이며 부찬 조합을 유지하는 데 참고한다. 가족 기피(AVOID), 이번 주 기피, 알레르기와 금지 식재료는 선택하지 않는다. 기본메뉴의 취향을 세부메뉴로 자동 전파하지 않는다. cookingMethods와 ingredientCategories는 만개의레시피 상단 기본메뉴 태그에 직접 표시된 값만 담는다. 태그가 빈 항목의 조리계열·주재료는 식단 선택 단계의 임시 추정값이며 원본 태그나 정확한 레시피 재료·알레르기 판정 근거가 아니다. 세부메뉴의 실제 레시피 재료·조리법이 확인되면 그 정보를 우선한다.",
    "월간 식단은 먼저 mealStyle을 배치하고 메뉴를 선택한다. MAIN_DISH는 주찬 중심, SOUP_MEAL은 soup에 국/탕/찌개와 main에 간단한 주찬을 모두 넣는다. NOODLE_DUMPLING과 RICE_PORRIDGE_TTEOK는 main에 한그릇 메뉴를 둔다. soup은 SOUP_MEAL에서만 넣는다.",
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
function normalizeMonthPayload(payload, month) {
  return {
    ...(payload && typeof payload === "object" ? payload : {}),
    schemaVersion: "meal-month.v1",
    month,
  };
}
function normalizeMonthSideBatches(payload, fromDate = null) {
  const changes = Array.isArray(payload?.mealChanges)
    ? [...payload.mealChanges].sort((left, right) =>
        String(left?.date || "").localeCompare(String(right?.date || "")),
      )
    : [];
  const eligible = changes.filter(
    (change) =>
      (!fromDate || String(change?.date || "") >= fromDate) &&
      Array.isArray(change?.sides) &&
      change.sides.length === 2,
  );
  for (let index = 0; index < eligible.length;) {
    const remaining = eligible.length - index;
    const size = remaining === 4 ? 2 : Math.min(3, remaining);
    const sides = [...eligible[index].sides];
    for (const change of eligible.slice(index, index + size))
      change.sides = [...sides];
    index += size;
  }
  return { ...payload, mealChanges: changes };
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
  if (/(앞으로|다음에도|먹어봤|생소|익숙|취향|넣어도|피해주세요|좋아(?:해|요)?|싫어(?:해|요)?)/.test(String(message || ""))) return true;
  const text = String(message || "").replace(/\s+/g, " ");
  const mentionsMealData =
    /(월간|주간|식단|메뉴|주찬|부찬|반찬|점심|저녁|레시피|장보기|외식|미식사|식사\s*여부|집에서\s*(?:먹|식사)|냉장고|펜트리|보유\s*재료|재고|가족|알레르기|선호|기피|씹기|매운맛|주간\s*점검|일정|출근|출장|부재|회사\s*식사)/.test(text);
  const asksToChange =
    /(바꿔|바꾸어|바꿔\s*달|변경\s*해|수정\s*해|교체\s*해|삭제|지워|추가|등록|재생성|재설정|초기화|새로\s*(?:짜|만들)|짜\s*줘|만들어\s*줘|반영\s*해|저장\s*해|구매\s*(?:완료|취소)|미식사|외식|넣어|빼\s*줘|남았|소진|다\s*먹|없어졌|출근|출장|부재|회사\s*식사)/.test(text);
  return mentionsMealData && asksToChange;
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
  const confirmed = /(확인했|확인\s*후|동의|진행\s*해|실행\s*해|그래\s*,?\s*해|정말\s*삭제)/.test(
    String(instruction || ""),
  );
  if (confirmed) return null;
  const broad = decisions.find(
    (decision) =>
      decision.intent === "RESET_MONTH" ||
      decision.intent === "DELETE_RECIPE" && decision.all === true,
  );
  if (!broad) return null;
  if (broad.intent === "RESET_MONTH" && explicitMonthReplacement(instruction))
    return null;
  return broad.intent === "RESET_MONTH"
    ? `${broad.month} 식단을 재설정하면 해당 범위의 기존 메뉴·레시피·자동 장보기가 교체됩니다. 계속하려면 ‘확인했어, 진행해줘’라고 답해 주세요.`
    : `${broad.weekStart} 주차의 레시피를 모두 삭제하면 자동 장보기도 다시 계산됩니다. 계속하려면 ‘확인했어, 진행해줘’라고 답해 주세요.`;
}
function explicitMonthReplacement(instruction) {
  const text = String(instruction || "").replace(/\s+/g, " ");
  return /(재설정|다시\s*(?:짜|만들|구성)|새로\s*(?:짜|만들|구성)|처음부터|갈아엎|전체(?:를|적으로)?\s*(?:바꿔|변경|교체)|전부\s*(?:바꿔|변경|교체)|(?:부터|이후).*(?:바꿔|변경|교체|다시))/.test(text);
}
function isExplicitMonthReplacementRequest(instruction) {
  const text = String(instruction || "").replace(/\s+/g, " ");
  const mentionsWholeMonth = /(?:월간\s*(?:식단|메뉴)|(?:20\d{2}\s*년\s*)?\d{1,2}\s*월(?:의)?\s*(?:전체\s*)?(?:식단|메뉴)|(?:이번|다음)\s*달(?:의)?\s*(?:식단|메뉴))/.test(text);
  return mentionsWholeMonth && explicitMonthReplacement(text);
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
  if (
    /(?:예산|식비)[^\n]{0,30}\d[\d,]*(?:만\s*)?원[^\n]{0,20}(?:안으로|이하|넘지|맞춰)/.test(String(task.message || "")) &&
    /(?:식단|메뉴|짜|구성|만들)/.test(String(task.message || ""))
  )
    return [{
      intent: "CLARIFY",
      answer: "현재는 식재료의 실제 판매 가격 데이터가 없어 정확한 금액 상한을 보장할 수 없습니다. 저렴한 재료 중심으로 구성할 수는 있지만, 금액 제한을 적용하려면 기준 가격이나 최근 장보기 가격이 필요합니다.",
    }];
  if (validMonth(targetMonth) && isExplicitMonthReplacementRequest(task.message))
    return [{ intent: "RESET_MONTH", month: targetMonth, weekStart: task.weekStart }];
  const result = await ask(
    systemPrompt(ruleFiles) +
      `\n\n사용자의 변경 요청을 실행 순서대로 하나 이상의 앱 기능으로 분류한다. 실제 변경은 하지 말고 아래 JSON만 반환한다.
intent는 UPDATE_MEALS, GENERATE_MONTH, RESET_MONTH, REGENERATE_RECIPES, ADD_RECIPE, DELETE_RECIPE, REGENERATE_GROCERY, ADD_GROCERY, DELETE_GROCERY, SET_GROCERY_PURCHASED, MANAGE_PANTRY, UPDATE_FAMILY, UPDATE_WEEKLY_REVIEW, UPDATE_PREFERENCE, UPDATE_ATTENDANCE, CLARIFY 중 하나다.
월간 식단이 없는 달을 만들어 달라는 요청은 GENERATE_MONTH다. 이미 식단이 있는 달을 다시 짜기·새로 만들기·바꾸기·교체하기·처음부터 구성하기처럼 요청하면 특정 단어 사용 여부와 관계없이 RESET_MONTH다.
레시피 추가는 반드시 현재 식단에 있는 메뉴의 레시피를 보충하는 의미다. 레시피 삭제는 제목이 특정되어야 한다.
냉장고·펜트리·보유 재료의 추가·수정·증감·삭제는 MANAGE_PANTRY다. 가족의 알레르기·씹기·매운맛·선호 메모 변경은 UPDATE_FAMILY다. 이번 주만 먹고 싶은 음식·피할 음식·주간 메모 저장은 UPDATE_WEEKLY_REVIEW다. 이 경우 지속 취향을 변경하지 않는다.
구체적인 메뉴에 대해 앞으로 넣어줘·앞으로 빼줘·먹어봤어·생소해처럼 지속 취향이나 익숙함을 알려주면 UPDATE_PREFERENCE다. 식단 편성이나 레시피 존재로 취향을 추론하지 않는다. usage와 familiarity는 독립이며 사용자가 말한 필드만 포함한다. 가족 대상이 생략된 일반 요청은 family, 아기만 등의 명시가 있으면 해당 role이다. 오늘 메뉴·이것 등의 지시어는 현재 컨텍스트로 단일 메뉴를 식별할 수 없으면 CLARIFY다. 취향 저장만 요청했으면 UPDATE_MEALS를 추가하지 않는다. '잘 먹었어'만으로 ALLOW를 기록하지 않는다. 메뉴 구분은 현재 후보로 확인하고 여러 구분에 있으면 CLARIFY다.
날짜·제목·품목이 불명확하여 여러 대상을 바꿀 수 있으면 CLARIFY와 자연스러운 한국어 answer를 반환한다.
이번 주는 ${task.weekStart}, 선택 월은 ${targetMonth}, 오늘은 ${currentKstDate()}다.
레시피를 모두·전부·전체 삭제하라는 명시적 요청에만 all을 true로 한다.
서로 독립된 변경이 여러 개면 actions에 각각 넣는다. 한 작업의 대상이 모호하면 CLARIFY 하나만 반환한다. 최대 20개다. 가격 데이터가 없는 상태에서 정확한 예산 상한을 요구하면 저장하지 말고 CLARIFY로 현재는 금액 준수를 보장할 수 없다고 답한다.
형식: {"actions":[{"intent":"...","answer":"확인 질문 또는 빈 문자열","month":"YYYY-MM","weekStart":"YYYY-MM-DD 일요일","date":"YYYY-MM-DD 또는 null","dates":["YYYY-MM-DD"],"title":"레시피 제목 또는 null","category":"주찬|반찬|점심|null","all":false,"groceryName":"품목명 또는 null","quantity":1,"unit":"개","groceryCategory":"기타","purchased":true,"pantry":{"operation":"upsert|adjust|delete","name":"재료명","quantity":1,"unit":"g|kg|ml|L|개|팩|봉|병|캔|모|단|통|장|마리","category":"냉장|냉동|실온|기타","expiresAt":"YYYY-MM-DD 또는 null"},"preference":{"name":"정확한 메뉴명","category":"주찬|부찬|국/탕/찌개|한그릇|점심|아기","scope":"family|father|mother|child","usage":"UNKNOWN|ALLOW|AVOID (사용 여부를 말한 경우만)","familiarity":"UNKNOWN|FAMILIAR|UNFAMILIAR (익숙함을 말한 경우만)","note":"명시한 메모만"},"familyUpdate":{"role":"father|mother|child","name":null,"allergies":null,"chewingAbility":null,"spiceTolerance":null,"dietaryNotes":null},"weeklyReview":{"referenceDate":"YYYY-MM-DD","wantedFoods":null,"avoidFoods":null,"note":null},"dinnerDiningOut":null,"attendance":[{"role":"father|mother","lunchNotAtHome":true,"dinnerNotAtHome":false,"isWorking":null,"eatsAtCompany":null,"isAway":null,"note":null}]}]}`,
    `[사용자 요청]\n${task.message}\n[현재 주간 컨텍스트]\n${JSON.stringify(context(task.weekStart))}`,
    false,
  );
  const classified = modelJson(result.content);
  const allowed = new Set([
    "UPDATE_MEALS", "GENERATE_MONTH", "RESET_MONTH", "REGENERATE_RECIPES",
    "ADD_RECIPE", "DELETE_RECIPE", "REGENERATE_GROCERY", "ADD_GROCERY",
    "DELETE_GROCERY", "SET_GROCERY_PURCHASED", "MANAGE_PANTRY",
    "UPDATE_FAMILY", "UPDATE_WEEKLY_REVIEW", "UPDATE_PREFERENCE", "UPDATE_ATTENDANCE", "CLARIFY",
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
      if (
        decision.intent === "GENERATE_MONTH" &&
        validMonth(decision.month) &&
        monthContext(decision.month).existingMonthMeals?.length
      ) decision.intent = "RESET_MONTH";
      return decision;
    });
  return decisions.length
    ? decisions
    : [{ intent: "CLARIFY", answer: "어떤 항목을 어떻게 변경할지 조금 더 구체적으로 알려주세요." }];
}
function selectedResetStartDate(message, month) {
  const text = String(message || "");
  if (!/(?:부터|이후)/.test(text)) return null;
  const full = text.match(
    /(20\d{2})\s*[년./-]\s*(1[0-2]|0?[1-9])\s*[월./-]\s*(3[01]|[12]?\d)\s*일?\s*(?:부터|이후)/,
  );
  const candidate = full
    ? `${full[1]}-${String(Number(full[2])).padStart(2, "0")}-${String(Number(full[3])).padStart(2, "0")}`
    : (() => {
        const day = text.match(/(3[01]|[12]?\d)\s*일\s*(?:부터|이후)/);
        return day
          ? `${month}-${String(Number(day[1])).padStart(2, "0")}`
          : null;
      })();
  return candidate && validDate(candidate) && candidate.startsWith(`${month}-`)
    ? candidate
    : null;
}
function preserveMonthBefore(payload, current, fromDate) {
  if (!fromDate) return payload;
  const preserved = (current.existingMonthMeals || [])
    .filter((meal) => meal.date < fromDate)
    .map((meal) => ({
      date: meal.date,
      lunch: meal.lunchPlan,
      main: meal.mainDish,
      soup: meal.soupDish || undefined,
      mealStyle: meal.mealStyle || "MAIN_DISH",
      sides: meal.sides,
      baby: meal.babyMenu || undefined,
      note: meal.cookingNote || undefined,
    }));
  const replacements = Array.isArray(payload?.mealChanges)
    ? payload.mealChanges.filter((meal) => String(meal?.date || "") >= fromDate)
    : [];
  return {
    ...payload,
    mealChanges: [...preserved, ...replacements].sort((a, b) =>
      String(a.date).localeCompare(String(b.date)),
    ),
  };
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
  for (const change of changes) {
    const weekStart = sundayForDate(change.date);
    const current = context(weekStart);
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

async function runChatMonthAction(ruleFiles, decision) {
  const month = validMonth(decision.month) ? decision.month : task.targetMonth;
  if (!validMonth(month))
    return { answer: "생성하거나 재설정할 연도와 월을 알려주세요.", sources: [] };
  const current = monthContext(month);
  const replacing = decision.intent === "RESET_MONTH";
  const replaceFrom = replacing
    ? selectedResetStartDate(task.message, month)
    : null;
  if (current.existingMonthMeals?.length && !replacing)
    return {
      answer: `${month} 월간 식단이 이미 있습니다. 전체를 다시 짤지, 특정 날짜부터 바꿀지 알려주세요.`,
      sources: [],
    };
  const result = await ask(
    systemPrompt(ruleFiles),
    `[월간 컨텍스트]\n${JSON.stringify(current)}\n[사용자 요청]\n${task.message}\n` +
      `${month}의 모든 날짜를 한 번씩 포함한 meal-month.v1 JSON만 반환한다. ` +
      (replaceFrom
        ? `${replaceFrom} 이전 식단은 existingMonthMeals와 완전히 동일하게 유지하고, ${replaceFrom}부터 월말까지만 새로 구성한다. `
        : "") +
      "각 날짜에 mealStyle을 반드시 넣는다. 메인반찬 중심 4일, 국/탕/찌개 중심 1~2일, 면/만두 1일을 주간 출발점으로 사용하고 남은 날은 밥/죽/떡으로 채우되, 월간 날짜 수에 맞춰 고르게 배치한다. 부찬 2개는 동일한 조합을 2~3일 연속 유지하고 특별한 이유 없이 매일 바꾸지 않는다. 레시피와 장보기는 만들지 않는다. 기존 월을 교체하더라도 날짜 상세의 가족 일정은 유지한다.",
    false,
  );
  const scope = `${month}의 모든 날짜를 한 번씩 포함하며 ${replaceFrom ? `${replaceFrom} 이전은 유지하고 그날부터 월말까지만 교체하는` : "월 전체를 교체하는"} 월간 식단이다. 각 날짜에 유효한 mealStyle을 넣고, SOUP_MEAL에는 soup과 간단한 main을 모두 넣는다. AVOID 메뉴는 저장하지 않으며 UNKNOWN 메뉴는 사용할 수 있다. 부찬 조합은 2~3일씩 유지하며 레시피와 장보기는 만들지 않는다.`;
  const normalizeCandidate = (candidate) => normalizeMonthSideBatches(
    preserveMonthBefore(
      normalizeMonthPayload(candidate, month),
      current,
      replaceFrom,
    ),
    replaceFrom,
  );
  let payload = normalizeCandidate(modelJson(result.content));
  payload = await completePayload(
    payload,
    current,
    ruleFiles,
    scope,
    (candidate) => validate(
      "validate-month",
      normalizeCandidate(candidate),
      ["--month", month, ...(replacing ? ["--replace", "true"] : []), ...(replaceFrom ? ["--replace-from", replaceFrom] : [])],
    ),
    false,
    6,
    true,
    task.message,
  );
  payload = normalizeCandidate(payload);
  const published = publish(
    "publish-month",
    writeInput(`chat-month-${month}`, payload),
    [
      "--month",
      month,
      ...(replacing ? ["--replace", "true"] : []),
      ...(replaceFrom ? ["--replace-from", replaceFrom] : []),
    ],
  );
  const publishResult = JSON.parse(String(published));
  const remainingWarnings = Array.isArray(publishResult.warnings) ? publishResult.warnings : [];
  return {
    answer: (replacing
      ? `${replaceFrom ?? month}부터 월말까지 식단을 새 구성으로 재설정했습니다. 변경 범위의 기존 레시피와 자동 장보기 항목은 정리했으며 이전 식단과 날짜별 가족 일정은 유지했습니다.`
      : `${month} 월간 식단을 생성했습니다.`)
      + (remainingWarnings.length ? ` 식단 품질 경고 ${remainingWarnings.length}건이 남았습니다(점수 ${publishResult.qualityScore}/100): ${remainingWarnings.slice(0, 2).join("; ")}` : ""),
    sources: [],
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
    "월간 식단 메뉴는 바꾸지 않는다. mealChanges는 빈 배열이다. 선택 주의 저녁 주찬·부찬과 집에서 먹는 주말 점심 레시피를 빠짐없이 준비한다. " +
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
    const matches = (current.shoppingItems || []).filter(
      (item) => item.name === name || item.name.includes(name) || name.includes(item.name),
    );
    if (matches.length !== 1)
      return {
        answer: matches.length
          ? `품목이 여러 개 검색됐습니다: ${matches.map((item) => item.name).join(", ")}. 정확한 이름을 알려주세요.`
          : `${weekStart} 주차 장보기에서 '${name}'을 찾지 못했습니다.`,
        sources: [],
      };
    name = matches[0].name;
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
  if (["GENERATE_MONTH", "RESET_MONTH"].includes(decision.intent))
    return runChatMonthAction(ruleFiles, decision);
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
      "\n" + task.targetMonth + "의 모든 날짜를 포함한 meal-month.v1 JSON만 반환한다. 부찬 2개는 같은 조합을 2~3일 연속 유지하며 하루마다 바꾸지 않는다. 레시피·장보기는 만들지 않는다.");
    const scope = task.targetMonth + "의 모든 날짜를 한 번씩 포함하고 부찬 조합은 2~3일씩 유지하는 월간 식단이며 레시피와 장보기는 만들지 않는다.";
    const normalizeCandidate = (candidate) => normalizeMonthSideBatches(
      normalizeMonthPayload(candidate, task.targetMonth),
    );
    let payload = normalizeCandidate(modelJson(result.content));
    payload = await completePayload(
      payload,
      current,
      ruleFiles,
      scope,
      (candidate) => validate(
        "validate-month",
        normalizeCandidate(candidate),
        ["--month", task.targetMonth],
      ),
    false,
    6,
    true,
  );
    payload = normalizeCandidate(payload);
    publish("publish-month", writeInput("month-" + task.targetMonth, payload),
      ["--month", task.targetMonth, "--request-id", task.requestId]);
    notify(); return;
  }

  const current = context(task.weekStart);
  if (task.action === "REVIEW_WEEK") {
    const result = await ask(
      systemPrompt(ruleFiles) + "\n\n주간 점검이다. referenceDate부터 토요일까지만 판단한다. 유지하면 {\"decision\":\"maintain\",\"summary\":\"...\"}; 수정하면 {\"decision\":\"change\",\"changeReason\":\"...\",\"mealChanges\":[...]}를 반환한다. 레시피는 후속 작업에서 별도로 생성한다.",
      "[주간 컨텍스트]\n" + JSON.stringify(current) + "\n[사용자 점검 정보]\n" + task.prompt,
      false,
    );
    let payload = modelJson(result.content);
    if (payload.decision === "maintain") {
      ctl("record-review", "--week", task.weekStart, "--summary", String(payload.summary || "현재 식단을 유지합니다."), "--request-id", task.requestId);
      notify(); return;
    }
    if (payload.decision !== "change" || !Array.isArray(payload.mealChanges) || !payload.mealChanges.length)
      throw new Error("주간 점검 결과 형식이 올바르지 않습니다.");
    for (const change of payload.mealChanges) {
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
        true,
        `${task.prompt || ""}\n${current.weeklyReview?.wantedFoods || ""}`,
      );
      dayPayload.recipes = [];
      publish("publish-day", writeInput("review-" + change.date, dayPayload),
        ["--week", task.weekStart, "--date", change.date]);
    }
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
    ctl("record-review", "--week", task.weekStart, "--summary", summary, "--request-id", task.requestId);
    notify(); return;
  }

  const isDaily = task.action === "UPDATE_DAY";
  const scope = isDaily
    ? "선택 날짜 " + task.date + " 식단만 변경한다. mealChanges는 그 날짜 하나만 포함하고 recipes는 빈 배열로 둔다."
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
