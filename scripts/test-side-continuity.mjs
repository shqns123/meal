import assert from "node:assert/strict";
import { adjacentSidePair, previousSideBatch } from "../lib/side-continuity.mjs";

const a = ["계란찜", "멸치볶음"], b = ["두부조림", "오이무침"];
assert.deepEqual(previousSideBatch([{ date: "2026-10-03", sides: a }], "2026-10-04"), { pair: a, days: 1 });
assert.deepEqual(previousSideBatch([{ date: "2026-10-02", sides: a }, { date: "2026-10-03", sides: a }], "2026-10-04"), { pair: a, days: 2 });
assert.equal(previousSideBatch([{ date: "2026-10-01", sides: a }, { date: "2026-10-02", sides: a }, { date: "2026-10-03", sides: a }], "2026-10-04"), null);
assert.deepEqual(adjacentSidePair([{ date: "2026-10-05", sides: a }, { date: "2026-10-07", sides: a }], "2026-10-06"), [a]);
assert.deepEqual(adjacentSidePair([{ date: "2026-10-04", sides: a }, { date: "2026-10-05", sides: a }, { date: "2026-10-07", sides: a }], "2026-10-06"), []);
assert.deepEqual(adjacentSidePair([{ date: "2026-10-05", sides: a }, { date: "2026-10-07", sides: b }], "2026-10-06"), [a, b]);
assert.deepEqual(adjacentSidePair([{ date: "2026-10-03", sides: a }, { date: "2026-10-04", sides: a }, { date: "2026-10-05", sides: a }, { date: "2026-10-07", sides: b }], "2026-10-06"), [b]);
console.log("side continuity checks passed");
