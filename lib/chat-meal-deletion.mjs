const DAY = 24 * 60 * 60 * 1000;

function addDays(date, amount) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + amount * DAY).toISOString().slice(0, 10);
}

function realDate(year, month, day) {
  const value = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

export function requestsMealDeletion(message) {
  const text = String(message || "");
  if (/(?:식단에서|식단의)[^\n]{0,30}(?:메뉴|주찬|부찬|반찬)/.test(text)) return false;
  return /(?:식단|끼니|식사\s*계획)/.test(text) && /(?:삭제|지워|없애)/.test(text);
}

export function ambiguousOldConfirmation(message, conversation = []) {
  if (!/^(?:응|네|예|맞아|맞아요|확인|그래)(?:요|\.|!)?$/.test(String(message || "").trim())) return false;
  const answer = conversation.at(-1);
  return answer?.role === "assistant" && /(?:식단|레시피)[^\n]{0,80}삭제할까요\?/.test(String(answer.content || ""))
    && !String(answer.content).startsWith("삭제 확인:");
}

export function confirmedFollowup(message, conversation = []) {
  if (!/^(?:응|네|예|맞아|맞아요|확인|동의|진행해|삭제해|그래|좋아|그렇게\s*해)(?:요|줘|주세요|\.|!)?$/.test(String(message || "").trim())) return null;
  const recent = conversation.slice(-4);
  const answer = recent.at(-1);
  const request = recent.at(-2);
  if (answer?.role !== "assistant" || request?.role !== "user") return null;
  if (String(answer.content).startsWith("삭제 확인:") && requestsMealDeletion(request.content)) {
    const count = /식단 (\d+)일/.exec(String(answer.content));
    return count ? { message: request.content, confirmed: true, expectedCount: Number(count[1]) } : null;
  }
  if (String(answer.content).includes("레시피를 모두 삭제하면") && /레시피/.test(request.content) && /삭제/.test(request.content))
    return { message: request.content, confirmed: true };
  return null;
}

function mentionedDates(text, today) {
  const dates = [];
  let lastMonth = null;
  const pattern = /(20\d{2})-(\d{2})-(\d{2})|(?:(20\d{2})\s*년\s*)?(?:(\d{1,2})\s*월\s*)?(\d{1,2})\s*일/g;
  for (const match of text.matchAll(pattern)) {
    const year = Number(match[1] || match[4] || today.slice(0, 4));
    const month = Number(match[2] || match[5] || lastMonth);
    const day = Number(match[3] || match[6]);
    if (!month) return [];
    const date = realDate(year, month, day);
    if (!date) return [];
    dates.push(date);
    lastMonth = month;
  }
  return dates;
}

export function mealDeletionScope(message, conversation = [], today) {
  let text = String(message || "");
  if (/해당\s*기간|그\s*기간|그때/.test(text)) {
    const previous = [...conversation].reverse().find((item) => item.role === "user" && mentionedDates(item.content, today).length >= 2);
    if (!previous) return null;
    text = `${previous.content} ${text}`;
  }
  const dates = mentionedDates(text, today);
  if (dates.length > 2) return null;
  if (dates.length === 2) {
    if (dates[0] > dates[1] || !/(?:부터|에서).*(?:까지|사이)/.test(text)) return null;
    return { from: dates[0], to: dates[1] };
  }
  if (dates.length === 1) {
    if (/이후/.test(text)) return { from: addDays(dates[0], 1), to: null };
    if (/이전/.test(text)) return null;
    if (/부터/.test(text) && /(?:전부|모두|전체|미래|앞으로)/.test(text)) return { from: dates[0], to: null };
    if (/부터|까지/.test(text)) return null;
    return { from: dates[0], to: dates[0] };
  }
  const week = /(?:이번|다음)\s*주/.exec(text);
  if (week) {
    const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
    const sunday = addDays(today, -weekday + (week[0].includes("다음") ? 7 : 0));
    return { from: sunday, to: addDays(sunday, 6) };
  }
  const month = /(?:(20\d{2})\s*년\s*)?(\d{1,2})\s*월\s*(?:한\s*달|전체|식단)/.exec(text);
  if (month) {
    const year = Number(month[1] || today.slice(0, 4));
    const number = Number(month[2]);
    if (number < 1 || number > 12) return null;
    const from = realDate(year, number, 1);
    const nextMonth = number < 12 ? realDate(year, number + 1, 1) : realDate(year + 1, 1, 1);
    return { from, to: addDays(nextMonth, -1) };
  }
  return null;
}
