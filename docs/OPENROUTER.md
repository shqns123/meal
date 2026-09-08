# OpenRouter 연결

Meal 앱은 Hermes 웹훅 없이 OpenRouter를 직접 호출한다. 식단·레시피 작업은 백그라운드 프로세스에서 실행되며, 모델 결과는 `mealctl` 검증을 통과해야 SQLite에 저장된다.

## 필수 환경 변수

```env
OPENROUTER_API_KEY="발급받은 API 키"
OPENROUTER_MODEL="openai/gpt-5.6-luna"
```

선택 환경 변수:

```env
# false일 때 레시피와 채팅의 웹 검색을 끈다. 기본값은 true다.
OPENROUTER_ENABLE_WEB_SEARCH="true"
# false로 설정하면 앱 내부 예약 실행을 끈다. 기본값은 true다.
OPENROUTER_SCHEDULER_ENABLED="true"
# OpenRouter 요청 출처 표시에만 사용한다.
OPENROUTER_SITE_URL="https://meal.example.com"
```

## 처리 범위

- 월간 식단 생성은 웹 검색 없이 메뉴만 생성한다.
- 주간 레시피는 SQLite에서 출처 검증이 끝난 동일 메뉴를 먼저 재사용한다.
- 재사용할 레시피가 없는 메뉴만 네이버 블로그·티스토리를 검색한다.
- 일일 식단 수정은 해당 날짜의 메뉴·레시피·장보기만 갱신한다.
- 장보기 재생성은 AI를 호출하지 않고 저장된 레시피와 보유 재료만 합산한다.
- AI 채팅은 읽기 전용이며 식단 데이터를 수정하지 않는다.
- 매주 토요일 20:00에는 다음 주 식단을 자동 점검한다.
- 다음 달 첫날이 포함된 달력 주의 직전 금요일 18:00에는 다음 달 월간 식단을 자동 생성한다.

OpenRouter 결과가 불완전하면 `mealctl` 검증 오류를 포함해 최대 두 번 보완한다. 끝까지 검증을 통과하지 못하면 SQLite는 변경하지 않고 작업을 실패 처리한다.

## Docker 적용

```bash
docker compose up -d --build
```

앱 컨테이너만 재빌드하면 된다. Hermes 컨테이너나 공유 마운트는 필요하지 않다.
