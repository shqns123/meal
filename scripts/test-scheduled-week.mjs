import assert from "node:assert/strict";
import { scheduledWeekFor, nextScheduledRequest } from "../lib/scheduled-week.mjs";

assert.equal(scheduledWeekFor({ date: "2026-10-03", weekday: 6, hour: 19 }), null);
assert.equal(scheduledWeekFor({ date: "2026-10-03", weekday: 6, hour: 20 }), "2026-10-04");
assert.equal(scheduledWeekFor({ date: "2026-10-04", weekday: 0, hour: 9 }), "2026-10-04");
assert.equal(scheduledWeekFor({ date: "2026-10-05", weekday: 1, hour: 9 }), null);
const key = "scheduled-week-plan-2026-10-04", now = 1_000_000;
assert.equal(nextScheduledRequest(key, [], now), key);
assert.equal(nextScheduledRequest(key, [{ status: "RUNNING", createdAt: now - 1000 }], now), null);
assert.equal(nextScheduledRequest(key, [{ status: "COMPLETED", createdAt: now - 400_000 }], now), null);
assert.equal(nextScheduledRequest(key, [{ status: "FAILED", createdAt: now - 1000, completedAt: now - 1000 }], now), null);
assert.equal(nextScheduledRequest(key, [{ status: "FAILED", createdAt: now - 400_000, completedAt: now - 400_000 }], now), `${key}-retry-2`);
assert.equal(nextScheduledRequest(key, Array(3).fill({ status: "FAILED", completedAt: now - 400_000 }), now), null);
console.log("scheduled weekly generation and retry checks passed");
