export function requestsMealDataChange(message) {
  const text = String(message || "").replace(/\s+/g, " ");
  if (/(앞으로|다음에도|먹어봤|생소|익숙|취향|넣어도|피해주세요|좋아(?:해|요)?|싫어(?:해|요)?)/.test(text)) return true;
  const mentionsMealData = /(월간|주간|식단|메뉴|주찬|부찬|반찬|점심|저녁|레시피|장보기|외식|미식사|식사\s*여부|집에서\s*(?:먹|식사)|냉장고|펜트리|보유\s*재료|재고|가족|알레르기|선호|기피|씹기|매운맛|주간\s*점검|일정|출근|출장|부재|회사\s*식사|가중치|선택\s*확률)/.test(text);
  const asksToChange = /(바꿔|바꾸어|변경|수정|교체|삭제|지워|추가|등록|재생성|재구성|재편성|재설정|초기화|(?:새로|다시)\s*(?:짜|만들|구성|골라|선택|계산)|(?:구성|편성|생성|작성|계산|반영|저장|설정|갱신)\s*해|짜\s*줘|만들어\s*줘|구매\s*(?:완료|취소)|미식사|외식|넣어|빼\s*줘|남았|소진|다\s*먹|없어졌|출근|출장|부재|회사\s*식사)/.test(text);
  return mentionsMealData && asksToChange;
}

export function requestsSelectedWeekRegeneration(message) {
  const text = String(message || "").replace(/\s+/g, " ");
  return /(?:이번|현재|선택한)\s*주(?:간)?\s*(?:식단|메뉴)?|주간\s*식단/.test(text)
    && /재구성|재편성|다시\s*(?:짜|만들|구성)|새로\s*(?:짜|만들|구성)/.test(text)
    && !/(?:특정|하루|요일|\d{1,2}일(?:부터|만|의)?)/.test(text);
}
