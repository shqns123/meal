# Hermes 연결

## Synology 볼륨

실제 NAS 경로는 환경에 맞게 바꾼다. Hermes Agent는 `HERMES_HOME` 아래의 `config.yaml`과 `skills/`를 읽는다. `HERMES_HOME=/opt/data`인 Synology 컨테이너에서는 각각 `/opt/data/config.yaml`, `/opt/data/skills/`가 대상이다.

```yaml
environment:
  MEAL_PLAN_ROOT: /opt/data/meal
  MEAL_DB_PATH: /opt/data/meal/data/mealplan.db
  MEAL_APP_NOTIFY_URL: http://192.168.0.18:7000/api/push/notify
  MEAL_APP_NOTIFY_TOKEN: 앱의 MEAL_APP_NOTIFY_TOKEN과-같은-임의의-긴-값
  TZ: Asia/Seoul
volumes:
  - /volume1/docker/Meal:/opt/data/meal:ro
  - /volume1/docker/Meal/data:/opt/data/meal/data:rw
  - /volume1/docker/Meal/hermes/skills/meal-planner:/opt/data/skills/meal-planner:ro
```

Hermes를 재시작한 뒤 `meal-planner` 스킬이 검색되는지 확인한다. Hermes는 `~/.hermes/skills/` 아래의 `SKILL.md`를 스킬로 읽는다.

## 블로그 검색 도구

Hermes에서 `web`과 `terminal` 도구 모음을 활성화한다. `hermes tools`에서 Discord와 Cron 플랫폼을 각각 확인해야 한다. 웹 검색 백엔드는 본문 추출을 지원하는 Firecrawl 또는 Exa를 우선 사용한다. 무료 검색만 시험할 때는 DDGS를 사용할 수 있지만 블로그 본문 추출은 제한될 수 있다.

새 레시피는 네이버 블로그 또는 티스토리 글을 실제로 열어 확인해야 한다. 검색 결과 요약만으로 URL을 저장하지 않는다. 동일 메뉴의 검증된 출처가 SQLite에 있으면 새 검색 없이 재사용한다.

## 웹앱 요청용 Webhook

Hermes Gateway에서 webhook을 활성화한다.

```env
WEBHOOK_ENABLED=true
WEBHOOK_PORT=8644
WEBHOOK_SECRET=충분히-긴-임의의-비밀값
```

`HERMES_HOME/config.yaml`에 웹앱 전용 경로를 등록한다. 위 Synology 구성에서는 NAS의 `/volume1/docker/hermes/data/config.yaml` 파일이다.

```yaml
platforms:
  webhook:
    enabled: true
    extra:
      port: 8644
      secret: "충분히-긴-임의의-비밀값"
      routes:
        meal-plan:
          secret: "충분히-긴-임의의-비밀값"
          skills: [meal-planner]
          prompt: |
            meal-planner 스킬을 사용해 요청을 처리한다.
            작업: {task}
            날짜: {date}
            주 시작일: {weekStart}
            사용자 요청: {prompt}
          deliver: log
```

웹앱 컨테이너에는 다음 환경 변수를 설정한다. 두 컨테이너가 같은 Docker 네트워크에 있고 Hermes 서비스명이 `hermes`라고 가정한 예시다.

```env
AGENT_WEBHOOK_URL=http://hermes:8644/webhooks/meal-plan
AGENT_WEBHOOK_TOKEN=충분히-긴-임의의-비밀값
```

웹앱은 JSON 본문을 `AGENT_WEBHOOK_TOKEN`으로 HMAC-SHA256 서명해 `X-Webhook-Signature` 헤더로 보낸다. 외부 인터넷에 webhook 포트를 직접 공개하지 않는다.

날짜별 수정 요청은 `task: update_meal_day`로 전달된다. Hermes는 요청받은 날짜 하나만 `mealChanges`에 넣고 `publish-day`로 해당 날짜의 레시피·장보기만 다시 계산한다. 웹훅 처리가 끝나면 웹앱 API가 SQLite에서 같은 날짜를 다시 읽어 모달에 변경 전·후 결과를 반환한다. Hermes가 유지하기로 판단하면 두 결과가 동일하게 표시된다.

## AI 완료 푸시 알림

앱을 연 상태에서는 브라우저 권한과 무관하게 화면 오른쪽 아래에 완료 알림이 표시된다. 앱을 닫은 뒤 받는 기기 알림은 Web Push이므로 **HTTPS 주소**(또는 개발용 `localhost`)에서만 등록할 수 있다. NAS IP의 `http://192.168...` 주소로 접속하면 브라우저 보안 정책상 기기 푸시를 받을 수 없다. Synology Reverse Proxy와 인증서로 `https://식탁.도메인` 주소를 먼저 만든다.

웹앱 `.env`에 VAPID 키와 콜백 토큰을 넣는다. 키는 로컬에서 한 번만 생성하고 비밀 키는 Git에 올리지 않는다.

```bash
npm run push:keys
```

```env
NEXT_PUBLIC_VAPID_PUBLIC_KEY=생성된_publicKey
VAPID_PRIVATE_KEY=생성된_privateKey
VAPID_SUBJECT=mailto:본인@example.com
MEAL_APP_NOTIFY_TOKEN=openssl-rand-hex-32로-만든-값
```

Hermes 컨테이너에도 같은 `MEAL_APP_NOTIFY_TOKEN`과 웹앱 콜백 URL을 환경 변수로 넣는다. `meal-planner`와 `meal-chat` 스킬은 저장 성공 후 `mealctl notify-web`을 실행해 이 URL로 완료 신호를 보낸다. 콜백이 실패해도 이미 저장된 식단 작업을 되돌리지는 않는다.

## 일요일 확인 작업

Cron 플랫폼에도 `web`, `terminal`, `skills` 도구 모음을 활성화한 뒤 일요일 20시에 확인 요청을 보낸다.

```bash
hermes cron create "0 20 * * 0" \
  "다음 주 식단을 검토한다. 식비 잔액, 남은 재료, 일정, 희망·기피 메뉴, 아빠의 주말 출근 정보가 부족하면 Discord로 질문하고 아직 게시하지 않는다. 정보가 충분하면 meal-planner 스킬로 변경이 필요한 메뉴와 블로그 레시피 및 장보기를 게시한다." \
  --skill meal-planner \
  --name "주간 가족 식단 확인"
```

초기 레시피 보강처럼 검색량이 큰 작업은 Cron 한 번에 모두 처리하지 말고 10~20개씩 나눈다.

## 다음 달 월간 식단 생성

Hermes Cron에 매주 금요일 18:00(Asia/Seoul)로 한 작업을 만든다. Cron 자체는 매주 실행하지만, 아래 프롬프트가 **다음 달 1일이 포함된 달력 주의 직전 금요일**에만 월간 식단을 게시하므로 날짜를 매달 수정할 필요가 없다. 예를 들어 다음 달 첫 주가 이번 달 마지막 일요일에 시작하면 그 이틀 전 금요일에 생성된다.

- 이름: `다음 달 월간 식단 생성`
- 스케줄: `0 18 * * 5`
- 스킬: `meal-planner`
- 도구: `terminal`, `skills` (웹 검색은 이 작업에 필요 없음)

```text
Asia/Seoul 현재 날짜를 기준으로 다음 달 1일이 포함된 달력 주의 직전 금요일인지 판단한다. 해당하지 않으면 SQLite를 수정하지 말고, 실행을 건너뛴 이유만 간단히 남긴다.

해당하면 다음 달을 대상으로 meal-planner 스킬을 사용한다. AGENTS.md와 MEAL.md를 전체 읽고, context-month로 대상 월·직전 월 식단·보유 재료·가족 일정부터 확인한다. 대상 월에 식단이 이미 있으면 덮어쓰지 말고 종료한다.

대상 달의 모든 날짜에 점심, 저녁 주찬 1개, 부찬 2개, 필요한 아기 차이 메뉴와 재활용 메모를 구체적으로 구성한다. 직전 월 주찬과 중복하지 말고, 월 안에서도 주찬 중복과 인접한 단백질·조리법 편중을 피한다. 보유 재료, 가족 식사 여부, 금지 재료와 아기 분리 조리 규칙을 반영한다.

월간 캘린더만 validate-month와 publish-month로 게시한다. 이 작업에서 블로그 검색, 레시피 생성, 장보기 생성은 하지 않는다. 레시피·장보기는 기존 주간 작업에서 해당 주차별로 생성한다.
```

## 명령 확인

Hermes 컨테이너 안에서 다음을 실행한다.

```bash
cd /opt/data/meal
node scripts/mealctl.mjs context --week 2026-09-06
```

선택한 날짜는 반드시 일요일이어야 한다. `publish-week`는 검증 통과 후에만 실행되며 수정 전 DB를 `data/backups/`에 복사한다.

## 운영 원칙

- Git에는 코드, 지침, 스킬과 스크립트만 저장한다.
- `data/mealplan.db`, `data/backups/`, `.env`는 Git에서 제외한다.
- Hermes와 웹앱은 같은 `mealplan.db`를 마운트한다.
- 식단 게시 중에는 하나의 프로세스만 DB를 쓰도록 한다.
- Hermes가 원시 SQL을 실행하거나 웹앱 코드를 수정하도록 허용하지 않는다.
