function addDays(date, amount) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function realDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export function assertReviewDates(changes, weekStart, referenceDate) {
  const lastDate = addDays(weekStart, 6);
  if (!realDate(referenceDate) || referenceDate < weekStart || referenceDate > lastDate)
    throw new Error(`주간 점검 기준일은 ${weekStart}부터 ${lastDate}까지여야 합니다.`);
  if (!Array.isArray(changes) || !changes.length)
    throw new Error("주간 점검에서 변경할 날짜가 없습니다.");
  const seen = new Set();
  for (const change of changes) {
    const date = change?.date;
    if (!realDate(date) || date < referenceDate || date > lastDate || seen.has(date))
      throw new Error(`주간 점검 변경 날짜는 ${referenceDate}부터 ${lastDate}까지 중복 없이 지정해야 합니다.`);
    seen.add(date);
  }
}
