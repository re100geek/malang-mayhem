# MALANG MAYHEM — 말랑말랑 대환장 파티

친구 2~8명이 함께하는 3D 온라인 토이 휴머노이드 파티 게임입니다. 민트·크림·코랄 팔레트의 2.5등신 마스코트를 Blender에서 분리형 파츠와 Armature로 제작해 GLB로 내보내고, Node.js + Express + Socket.IO 서버가 방과 점수, 라운드 결과, 박치기와 장난 아이템을 권한형으로 관리합니다.

## 설치

```bash
pnpm install
pnpm --dir server install --frozen-lockfile
```

Blender 에셋을 다시 만들려면:

```bash
blender -b --python assets/blender/malang_mayhem_assets.py
```

이 명령은 다음 파일을 생성합니다.

- `assets/models/malang_mayhem.glb` — Three.js 런타임 모델 라이브러리 (배포 시 `public/assets/models/`로 복사)
- `assets/blender/malang_mayhem_assets.blend` — Blender 원본
- `assets/share/favicon.png`, `assets/share/og.png` — Blender Eevee 렌더 (배포 시 `public/assets/`로 복사)
- `shots/humanoid-front.png`, `side`, `back`, `top`, `three-quarter` — 휴머노이드 레퍼런스 비교 렌더

## 개발 서버 실행

터미널 1:

```bash
pnpm dev:server
```

터미널 2:

```bash
PORT=3000 HOST=0.0.0.0 pnpm dev
```

Vite가 `/socket.io`를 `127.0.0.1:8787`로 프록시합니다. 서버는 `http://127.0.0.1:8787/healthz`에서 상태를 반환합니다.

## 두 브라우저로 멀티플레이 테스트

1. 첫 브라우저에서 `http://localhost:3000`을 열고 닉네임과 색상을 선택한 뒤 **방 만들기**를 누릅니다.
2. 방 코드 6자리를 복사합니다.
3. 두 번째 브라우저에서 같은 주소를 열고 코드를 입력해 **입장**합니다.
4. 두 명이 대기실에 나타나면 방장이 **게임 시작**을 누릅니다.
5. WASD로 이동, Space로 점프, E로 집기/배달/왕관 빼앗기, Q로 말랑 박치기를 수행합니다. 박치기는 가까운 상대를 밀치고 운반물을 떨어뜨릴 수 있으며, 라운드에는 바나나 껍질·끈적 웅덩이·뿅망치 충격파·방향 반전 장난 아이템이 스폰됩니다. 모바일에서는 safe-area 안의 가상 스틱·점프·E·장난 버튼을 사용합니다.

## 빌드

```bash
pnpm build
pnpm preview
```

`dist/`에는 클라이언트가 생성되며, Socket.IO 서버가 `STATIC_ROOT=../dist`로 이를 제공할 수 있습니다.

## 서버 설정

- `HOST` 기본값: `127.0.0.1`
- `PORT` 기본값: `8787`
- `STATIC_ROOT` 기본값: 프로젝트 `dist`
- `ALLOWED_ORIGINS`: 공개 클라이언트 origin을 쉼표로 나열. 예: `https://game.example.com`

공개 배포에서는 HTTPS 클라이언트와 WSS Socket.IO endpoint를 같은 origin 또는 TLS reverse proxy 뒤에 두고, 정확한 origin을 `ALLOWED_ORIGINS`에 추가해야 합니다. 방과 점수는 메모리에 보관되므로 서버 재시작 시 초기화됩니다.

## 현재 검증 범위와 제한

로컬 클라이언트·서버 구현, 두 Socket.IO 세션 장난 동기화, 데스크톱·모바일 Chromium 스모크, Blender 휴머노이드 GLB·5개 액션·5방향 렌더 생성까지 검증했습니다. 공개 호스트에 서버를 배포하고 서로 다른 인터넷 브라우저에서 WSS 업그레이드를 확인하는 단계는 이 샌드박스에서 대신 수행하지 않았으므로 미검증 상태입니다. 게임은 캐주얼 친구 방을 위한 MVP이며 랭크전 수준의 치팅 방지나 영속 계정은 제공하지 않습니다.

## 배포 (Render 단일 Web Service)

프론트 정적 파일(`dist`)과 Socket.IO 서버를 한 프로세스로 서빙합니다.

- Build Command: `npm i -g pnpm@10.18.0 && pnpm install --frozen-lockfile && pnpm --dir server install --frozen-lockfile && pnpm build`
- Start Command: `node server/authoritative_server.mjs`
- 환경변수: `HOST=0.0.0.0`, `NODE_ENV=production`, (선택) `ALLOWED_ORIGINS=https://<서비스>.onrender.com`
- 서버는 `PORT`(Render가 주입)로 바인딩하고 `STATIC_ROOT` 기본값은 `../dist`입니다.
- 상태 확인: `/healthz` → `{"ok":true,"marker":"malang-mayhem-v1",...}`
- 무료 플랜은 약 15분 미사용 시 슬립하며, 다음 접속에서 콜드 스타트가 걸립니다. 방 상태는 메모리에만 있으므로 재시작 시 초기화됩니다.

## 테스트

```bash
pnpm test          # 클라이언트·서버 권한 통합 테스트 (vitest)
pnpm --dir server test   # 서버 단위 테스트
```
