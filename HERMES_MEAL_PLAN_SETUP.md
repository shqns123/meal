# Hermes 식단 수정 게시 규칙

`meal-plan` 웹훅은 검색 결과를 제안만 하는 용도가 아닙니다. 실제 SQLite 변경은 Hermes가 아래 명령을 끝까지 성공시킨 뒤에만 완료됩니다.

```text
mealctl context → 레시피 확인 → mealctl validate-week → mealctl publish-week → mealctl context
```

`/opt/data/config.yaml`의 기존 `meal-plan` 경로에 아래 프롬프트를 적용하세요. 이는 Hermes가 검색만 하고 텍스트 답변으로 끝내지 않도록 강제합니다.

```yaml
meal-plan:
  secret: "기존-식단-웹훅-키"
  skills: [meal-planner]
  prompt: |
    meal-planner 스킬을 사용해 요청을 처리한다.
    작업: {task}
    날짜: {date}
    주 시작일: {weekStart}
    사용자 요청: {prompt}

    이것은 실제 SQLite 식단 변경 작업이다. 텍스트로 메뉴를 추천하거나
    '검증했다'고 답하는 것으로 끝내면 안 된다.
    첫 도구 호출은 반드시 /opt/data/meal에서 mealctl.mjs context --week {weekStart}를 실행한다.
    변경이 필요하면 JSON을 만들고 validate-week를 성공시킨 뒤 publish-week를 실행한다.
    publish-week 성공과 후속 context 확인 전에는 완료 답변을 하지 않는다.
    실패하면 실행한 명령과 실제 오류를 보고하고, 변경됐다고 말하지 않는다.
  deliver: log
```

`platform_toolsets.webhook`에는 최소 `terminal`, `web`, `skills`가 있어야 합니다. 설정을 저장한 뒤 Hermes 컨테이너를 재시작합니다.

```bash
docker restart hermes
```

웹앱에서 “Hermes가 식단을 검토했지만 SQLite에 게시 작업을 완료하지 않았습니다”라고 표시되면, 해당 요청은 실제 변경되지 않은 것입니다. 로그에서 `mealctl validate-week`와 `mealctl publish-week`가 모두 실행됐는지 확인하세요.
