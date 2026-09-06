# 로그인 설정

이 앱은 환경 변수에 지정한 단일 ID와 비밀번호로 로그인한다. 로그인 성공 뒤에는 같은 기기·브라우저에서 최대 180일 동안 유지된다.

`.env`에 아래 값을 넣는다. `AUTH_SECRET`은 비밀번호와 별개의 32바이트 이상 임의 문자열을 사용하고 Git에 올리지 않는다.

```env
APP_LOGIN_ID=원하는_ID
APP_LOGIN_PASSWORD=긴_비밀번호
AUTH_SECRET=openssl-rand-hex-32로-생성한_긴_값
AUTH_COOKIE_SECURE=false
```

NAS IP의 HTTP 주소로 접속하는 동안에는 `AUTH_COOKIE_SECURE=false`여야 쿠키가 저장된다. Synology Reverse Proxy와 HTTPS 인증서를 설정한 뒤에는 반드시 `AUTH_COOKIE_SECURE=true`로 바꾼다.

변경 후 컨테이너를 다시 빌드·재시작한다.
