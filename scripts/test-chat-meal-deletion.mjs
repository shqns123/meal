import assert from "node:assert/strict";
import { ambiguousOldConfirmation, confirmedFollowup, mealDeletionScope, requestsMealDeletion } from "../lib/chat-meal-deletion.mjs";

const today = "2026-10-01";
assert.equal(requestsMealDeletion("10월 3일 이후 식단 다 삭제해줘"), true);
assert.equal(requestsMealDeletion("10월 3일 레시피 삭제해줘"), false);
assert.equal(requestsMealDeletion("10월 3일 식단에서 부찬 메뉴 삭제해줘"), false);
assert.deepEqual(mealDeletionScope("10월 3일 이후 식단 다 삭제해줘", [], today),
  { from: "2026-10-04", to: null });
assert.deepEqual(mealDeletionScope("2026년 10월 4일부터 10월 31일까지 식단 삭제해줘", [], today),
  { from: "2026-10-04", to: "2026-10-31" });
assert.deepEqual(mealDeletionScope("2026-10-04부터 2026-10-31까지 식단 삭제해줘", [], today),
  { from: "2026-10-04", to: "2026-10-31" });
assert.deepEqual(mealDeletionScope("해당기간 식단 삭제해줘", [
  { role: "user", content: "10월 4일부터 10월 31일까지 식단" },
  { role: "assistant", content: "생성할 주차를 선택해 주세요." },
], today), { from: "2026-10-04", to: "2026-10-31" });
assert.equal(mealDeletionScope("식단 삭제해줘", [], today), null);
assert.deepEqual(confirmedFollowup("응", [
  { role: "user", content: "10월 3일 이후 식단 다 삭제해줘" },
  { role: "assistant", content: "삭제 확인: 2026-10-04부터 저장된 모든 미래 날짜의 식단 7일을 삭제할까요?" },
]), { message: "10월 3일 이후 식단 다 삭제해줘", confirmed: true, expectedCount: 7 });
assert.equal(confirmedFollowup("응", [
  { role: "user", content: "식단 삭제해줘" },
  { role: "assistant", content: "날짜를 알려주세요." },
]), null);
assert.equal(ambiguousOldConfirmation("응", [
  { role: "user", content: "식단 삭제해줘" },
  { role: "assistant", content: "10월 25일부터 31일까지 식단 전체를 삭제할까요?" },
]), true);
console.log("chat meal deletion checks passed");
