# 우리집 식탁

Next.js 15 + React 19 기반의 가족 식단 플래너입니다. Notion에서 영감받은 따뜻한 종이 질감의 shadcn 스타일 UI와 NAS에 파일로 보관할 수 있는 SQLite 데이터 모델을 포함합니다.

## 포함 기능

- 사이드바 기반의 월간/주간 식단 플래너
- 레시피 및 장보기 목록 UI
- 가족 구성원, 레시피, 재료, 식단을 위한 Prisma/SQLite 스키마
- OpenRouter 직접 연동 식단 작업·웹 검색 레시피 검증·관리형 AI 채팅

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

Docker Compose로 실행한 앱은 `http://localhost:7000`에서 열립니다. SQLite 파일은 호스트의 `./data/mealplan.db`에 생성되므로 NAS 공유 폴더에 이 프로젝트를 두면 식단 데이터도 NAS에 보관됩니다. 컨테이너 시작 시 스키마가 자동 적용됩니다.

```bash
docker compose exec app npx prisma db push
```

## AI 연결

`.env`에 `OPENROUTER_API_KEY`와 `OPENROUTER_MODEL`을 설정하면 식단 생성·수정, 레시피 재생성, 장보기 재생성, 주간 점검과 관리형 AI 채팅을 앱에서 직접 처리합니다. 채팅에서도 월간 식단 생성·재설정, 날짜별 식단 변경, 레시피 추가·삭제, 장보기와 식사 일정을 관리할 수 있습니다. 레시피 생성과 일반 질문에는 필요할 때 OpenRouter 웹 검색·본문 읽기를 함께 요청합니다.

모든 SQLite 변경은 모델이 직접 하지 않고 앱의 `mealctl` 검증·게시 절차를 통과한 경우에만 반영됩니다. 따라서 이 앱 동작에 Hermes 컨테이너, 웹훅 route, Docker 소켓, Hermes 마운트는 필요하지 않습니다.

환경 변수와 처리 범위는 [OpenRouter 연결 안내](docs/OPENROUTER.md)를 참고하세요.
