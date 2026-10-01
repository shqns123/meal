import assert from "node:assert/strict";
import { requestsMealDataChange, requestsSelectedWeekRegeneration } from "../lib/chat-mutation-intent.mjs";

for (const message of ["이번주 식단 재구성해줘", "이번 주 식단 다시 구성해줘", "주간 식단 새로 짜줘", "오늘 부찬 바꿔줘"])
  assert.equal(requestsMealDataChange(message), true, message);
assert.equal(requestsMealDataChange("김치찌개 기본메뉴 선택 확률 50%로 설정해줘"), true);
assert.equal(requestsMealDataChange("이번 주 장보기 다시 계산해줘"), true);
assert.equal(requestsMealDataChange("10월 4일 식단 수정 부탁해"), true);
for (const message of ["이번 주 식단 알려줘", "식단은 어떻게 구성돼 있어?", "메뉴 추천해줘"])
  assert.equal(requestsMealDataChange(message), false, message);
assert.equal(requestsSelectedWeekRegeneration("이번주 식단 재구성해줘"), true);
assert.equal(requestsSelectedWeekRegeneration("이번 주 식단 다시 구성해줘"), true);
assert.equal(requestsSelectedWeekRegeneration("이번 주 수요일 식단 다시 구성해줘"), false);
console.log("chat mutation intent checks passed");
