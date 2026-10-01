function addDays(date, amount) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

export function scheduledWeekFor(current) {
  if (current.weekday === 6 && current.hour >= 20) return addDays(current.date, 1);
  if (current.weekday === 0) return current.date;
  return null;
}

export function nextScheduledRequest(requestId, attempts, now = Date.now()) {
  if (attempts.some((job) => job.status === "COMPLETED" || job.status === "RUNNING")) return null;
  if (attempts.length >= 3) return null;
  const latest = attempts.at(-1);
  if (latest && now - Number(latest.completedAt || latest.createdAt) < 5 * 60_000) return null;
  return attempts.length ? `${requestId}-retry-${attempts.length + 1}` : requestId;
}
