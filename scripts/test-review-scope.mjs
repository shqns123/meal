import assert from "node:assert/strict";
import { assertReviewDates } from "../lib/review-scope.mjs";

const week = "2026-10-04", reference = "2026-10-07";
assert.doesNotThrow(() => assertReviewDates([{ date: "2026-10-07" }, { date: "2026-10-10" }], week, reference));
for (const changes of [
  [{ date: "2026-10-06" }],
  [{ date: "2026-10-11" }],
  [{ date: "2026-10-07" }, { date: "2026-10-07" }],
  [{ date: "2026-10-32" }],
]) assert.throws(() => assertReviewDates(changes, week, reference));
assert.throws(() => assertReviewDates([{ date: "2026-10-07" }], week, "2026-10-11"));
console.log("weekly review date scope checks passed");
