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

만개의레시피 메뉴 카탈로그는 앱에 포함된 초기 파일에서 서버의 `./data/10000recipe-catalog.db`로 첫 실행 시 자동 설치됩니다. `data` 폴더는 Docker 볼륨으로 유지되므로 이후 재시작·재배포에서는 기존 카탈로그를 덮어쓰지 않습니다. 카탈로그를 새로 수집해 초기 파일도 갱신하려면 로컬에서 `npm run import:10000recipe-catalog` 다음 `npm run export:10000recipe-catalog`를 실행하고 변경된 `seed` 파일을 배포하세요.
기존 카탈로그 파일을 읽을 수 없으면 원본을 `data`에 `.invalid-시각` 이름으로 보관한 뒤 초기 파일을 설치합니다.

Docker의 호스트 프로젝트 폴더에 있는 `./data/10000recipe-catalog.db`가 컨테이너의 `/app/data/10000recipe-catalog.db`에 해당합니다. Next.js standalone 서버는 `.next/standalone`로 작업 디렉터리를 변경하지만 메뉴 API는 `MEAL_PLAN_ROOT=/app`을 기준으로 이 볼륨을 읽습니다. 필터가 비어 있으면 `docker compose logs app`에서 카탈로그 경로와 읽기 오류를 확인하세요.

```bash
docker compose exec app npx prisma db push
```

## AI 연결

`.env`에 `OPENROUTER_API_KEY`와 `OPENROUTER_MODEL`을 설정하면 식단 생성·수정, 레시피 재생성, 장보기 재생성, 주간 점검과 관리형 AI 채팅을 앱에서 직접 처리합니다. 채팅에서도 월간 식단 생성·재설정, 날짜별 식단 변경, 레시피 추가·삭제, 장보기, 냉장고·펜트리 재료, 가족 식사 정보, 출근·부재 일정과 주간 점검을 관리할 수 있습니다. 여러 변경을 한 문장에 순서대로 요청하거나 이전 대화에 이어서 요청할 수 있으며, 일반 질문과 레시피 생성에는 필요할 때 OpenRouter 웹 검색·본문 읽기를 함께 사용합니다.

모든 SQLite 변경은 모델이 직접 하지 않고 앱의 `mealctl` 검증·게시 절차를 통과한 경우에만 반영됩니다. 따라서 이 앱 동작에 Hermes 컨테이너, 웹훅 route, Docker 소켓, Hermes 마운트는 필요하지 않습니다.

환경 변수와 처리 범위는 [OpenRouter 연결 안내](docs/OPENROUTER.md)를 참고하세요.

## 메뉴 취향 관리

- `우리 집 메뉴`에서 식단 사용 여부와 익숙함을 각각 선택한 뒤 저장합니다. 기존 식단·레시피는 미확인 후보로만 표시합니다.
- 가족 전체·구성원별로 설정할 수 있습니다. 가족 전체 허용보다 함께 먹는 구성원의 기피가 우선합니다.
- 날짜 상세의 `이 메뉴, 다음에도 먹을까요?`에서 가족 전체의 지속 취향을 저장합니다. 기존 식단은 자동 변경하지 않습니다.
- 이번 주만의 요청은 주간 점검에 기록합니다. 단위·보관 위치는 드롭다운으로 선택하고 기존 사용자 지정 값은 그대로 표시합니다.
- 새로운 월 생성 전에 주찬·부찬·주말 점심 후보를 확인하세요. 미확인 메뉴는 새로 편성하지 않고, 확인된 메뉴의 반복은 허용합니다.
- 스키마 변경 적용: DB 백업 후 `npx prisma db push`, `npx prisma generate`. 추가 테이블은 `Dish`, `DishPreference`이며 기존 식단은 이관·수정하지 않습니다.
- 검증: `node scripts/test-menu-preferences.mjs`, `npx prisma validate`, `npm run lint`, `npm run build`.
- 실행 중인 개발 서버와 빌드 산출물이 충돌하면 PowerShell에서 `$env:NEXT_BUILD_DIR='.next-preview'`를 설정한 뒤 빌드합니다. 기본 출력 위치는 기존 `.next`입니다.
