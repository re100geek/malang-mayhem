# MALANG MAYHEM Socket.IO 서버

`authoritative_server.mjs`는 MALANG MAYHEM의 방, 플레이어 좌석, 입력, 20Hz 시뮬레이션, 공유 오브젝트 상호작용, 라운드 타이머, 점수 계산을 소유합니다. 클라이언트가 보내는 것은 `input`뿐이며 위치·점수·라운드 전환·최종 순위는 서버 상태에서 계산됩니다.

## 실행

```bash
pnpm install
pnpm start
```

기본 포트는 `8787`이며 `/healthz`에서 `marker`, 방 수, uptime을 JSON으로 확인할 수 있습니다. `STATIC_ROOT=../dist`이면 동일 프로세스가 Vite 빌드 결과도 정적으로 제공합니다.

## Socket.IO 계약

클라이언트는 handshake auth로 `{ room, name, colorIndex, resumeToken }`을 보내고 `welcome`을 받습니다. 서버는 `{ marker: "malang-mayhem-v1", code, resumeToken, player }`를 반환합니다. 이후 `state`에는 `lobby`, `countdown`, `play`, `result`, `final` 중 하나의 phase와 현재 라운드, 플레이어 목록, 공유 오브젝트, 서버 점수가 포함됩니다.

경기 중 입력은 `{ x, z, jump, interact }`이며 서버에서 x/z를 -1~1로 clamp합니다. `toggle_ready`, `start_match`, `rematch`, `update_profile`은 로비/방장 상태를 다시 검증합니다. 연결이 끊긴 플레이어는 30초 동안 resume token으로 같은 자리를 되찾을 수 있습니다.

## 라운드

다섯 라운드는 바나나 배달, 피자 재료 협동, 왕관 쟁탈, 풍선탑 협동, 색 발판 생존 순서입니다. 개인전은 순위 점수, 협동전은 공동 달성도와 개인 기여도로 계산하며, 결과는 `round_result` 이벤트와 `result` payload로 전달합니다.

공개 배포에서는 HTTPS reverse proxy 뒤에 서버를 두고, `ALLOWED_ORIGINS=https://game.example.com`처럼 정확한 origin을 등록하십시오. 인메모리 방 상태는 프로세스 재시작 시 초기화됩니다.
