# Hermes 채팅 연결

사이드바 하단의 **Hermes에게 물어보기**는 식단 데이터를 읽어 답하고, 필요한 경우 공개 웹 자료도 찾아볼 수 있는 읽기 전용 채팅입니다. 캘린더·레시피·장보기 데이터를 변경하지 않습니다.

## 1. Meal 앱 환경 변수

Meal 프로젝트의 `.env`에 아래 값을 넣습니다. `AGENT_CHAT_WEBHOOK_TOKEN`은 길고 무작위인 별도 키를 사용하세요.

```env
AGENT_CHAT_WEBHOOK_URL="http://192.168.0.18:8644/webhooks/meal-chat"
AGENT_CHAT_WEBHOOK_TOKEN="여기에-별도-랜덤-키"
```

`docker-compose.yml`은 위 두 변수를 컨테이너에 전달하도록 이미 준비되어 있습니다.

## 2. Hermes skill 마운트

현재 `meal-planner`를 마운트한 방식과 동일하게 `meal-chat` 폴더도 Hermes 컨테이너에 읽기 전용으로 추가합니다.

```yaml
- /volume1/docker/Meal/hermes/skills/meal-chat:/workspace/meal/hermes/skills/meal-chat:ro
```

현재 Hermes가 기존 `meal-planner`를 읽는 경로가 다르면, 같은 부모 경로 아래에 `meal-chat`을 추가하면 됩니다.

## 3. `/opt/data/config.yaml` 웹훅 경로 추가

기존 `platforms.webhook.extra.routes` 아래에 다음을 추가합니다. `secret`은 Meal `.env`의 `AGENT_CHAT_WEBHOOK_TOKEN`과 정확히 같아야 합니다.

```yaml
meal-chat:
  secret: "여기에-별도-랜덤-키"
  skills: [meal-chat]
  prompt: |
    meal-chat 스킬을 사용해 읽기 전용 질문을 처리한다.
    요청 ID: {requestId}
    사용자 질문: {message}
    이전 대화: {conversation}
    식단·레시피·장보기·보유재료·일정은 절대 변경하지 않는다.
    답변을 완성한 뒤 mealctl.mjs reply-chat 명령으로 요청 ID에 답변을 기록한다.
  deliver: log
```

예시 전체 구조는 다음과 같습니다.

```yaml
platforms:
  webhook:
    enabled: true
    extra:
      port: 8644
      secret: "기존-전역-키"
      routes:
        meal-plan:
          secret: "기존-식단-키"
          skills: [meal-planner]
        meal-chat:
          secret: "Meal-.env의-AGENT_CHAT_WEBHOOK_TOKEN과-같은-키"
          skills: [meal-chat]
          prompt: |
            meal-chat 스킬을 사용해 읽기 전용 질문을 처리한다.
            요청 ID: {requestId}
            사용자 질문: {message}
            이전 대화: {conversation}
            식단·레시피·장보기·보유재료·일정은 절대 변경하지 않는다.
            답변을 완성한 뒤 mealctl.mjs reply-chat 명령으로 요청 ID에 답변을 기록한다.
          deliver: log
```

## 4. 재시작과 확인

Hermes 컨테이너를 재시작한 뒤 Meal 프로젝트에서 다음을 실행합니다.

```bash
docker compose up -d --build
docker compose logs --tail 100
```

이후 사이트 사이드바 아래 말풍선 버튼에서 “오늘 저녁 칼로리는 몇이야?”처럼 물어보면 됩니다. 답변에 웹 자료를 사용했을 때만 출처 링크가 표시됩니다.
