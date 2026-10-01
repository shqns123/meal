function addDays(date, amount) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

export function namedSidePair(value) {
  const sides = Array.isArray(value) ? value.map((name) => String(name || "").trim()) : [];
  return sides.length === 2 && sides.every(Boolean) && sides[0] !== sides[1] ? sides : null;
}

function key(pair) {
  return namedSidePair(pair)?.slice().sort().join("\u0000") ?? null;
}

function runLength(byDate, startDate, step, signature) {
  let count = 0;
  for (let date = startDate; key(byDate.get(date)) === signature; date = addDays(date, step)) {
    count += 1;
    if (count >= 4) break;
  }
  return count;
}

export function previousSideBatch(plans, firstDate) {
  const byDate = new Map(plans.map((plan) => [plan.date, plan.sides]));
  const previousDate = addDays(firstDate, -1);
  const pair = namedSidePair(byDate.get(previousDate));
  if (!pair) return null;
  const days = runLength(byDate, previousDate, -1, key(pair));
  return days < 3 ? { pair, days } : null;
}

export function adjacentSidePair(plans, date) {
  const byDate = new Map(plans.map((plan) => [plan.date, plan.sides]));
  const before = addDays(date, -1), after = addDays(date, 1);
  const previous = namedSidePair(byDate.get(before));
  const next = namedSidePair(byDate.get(after));
  const previousDays = previous ? runLength(byDate, before, -1, key(previous)) : 0;
  const nextDays = next ? runLength(byDate, after, 1, key(next)) : 0;
  if (previous && next && key(previous) === key(next))
    return previousDays + nextDays < 3 ? [previous] : [];
  return [previousDays < 3 ? previous : null, nextDays < 3 ? next : null].filter(Boolean);
}
