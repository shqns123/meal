# 우리집 식탁

Next.js 15 + React 19 기반의 가족 식단 플래너입니다. Notion에서 영감받은 따뜻한 종이 질감의 shadcn 스타일 UI와 NAS에 파일로 보관할 수 있는 SQLite 데이터 모델을 포함합니다.

## 포함 기능

- 사이드바 기반의 월간/주간 식단 플래너
- 레시피 및 장보기 목록 UI
- 가족 구성원, 레시피, 재료, 식단을 위한 Prisma/SQLite 스키마
- 외부 Hermes/Codex 에이전트를 위한 `POST /api/agent/meal-plan` 웹훅 어댑터

## 로컬 실행

```bash
npm install
copy .env.example .env
npx prisma generate
npm run dev
```

## Docker 실행

```bash
docker compose up --build
```

앱은 `http://localhost:3000`에서 열립니다. SQLite 파일은 호스트의 `./data/mealplan.db`에 생성되므로 NAS 공유 폴더에 이 프로젝트를 두면 식단 데이터도 NAS에 보관됩니다. 컨테이너 시작 시 스키마가 자동 적용됩니다.

```bash
docker compose exec app npx prisma db push
```

## 에이전트 연결

`AGENT_WEBHOOK_URL`에 Hermes 또는 Codex를 호출하는 중계 서버 URL을 넣습니다. 요청은 `task: "create_meal_plan"`, 사용자 프롬프트, 가족 정보, 시작일과 일수를 JSON으로 보냅니다. 웹훅이 비어 있으면 개발용 식단 미리보기를 반환합니다.
