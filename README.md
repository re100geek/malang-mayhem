# MALANG MAYHEM — 말랑말랑 대환장 파티

친구 2~8명이 함께하는 3D 온라인 토이 휴머노이드 파티 게임입니다. 민트·크림·코랄 팔레트의 2.5등신 마스코트를 Blender에서 분리형 파츠와 Armature로 제작해 GLB로 내보내고, Node.js + Express + Socket.IO 서버가 방과 점수, 라운드 결과, 박치기와 장난 아이템을 권한형으로 관리합니다.

## 설치

```bash
pnpm install
pnpm --dir server install --frozen-lockfile
```

캐릭터 GLB를 다시 만들려면 (Blender 4.2 LTS, headless):

```bash
blender --background --factory-startup --python scripts/blender/build_humanoid_creature.py
python3 scripts/blender/verify_glb_structure.py public/assets/models/malang_mayhem.glb
```

`build_humanoid_creature.py`는 기존 GLB의 아레나·소품은 그대로 두고 `HumanoidRig`(12본)와
`Idle`/`Run`/`Jump`/`Bonk`/`Hit` 5개 클립만 새로 구워 `public/assets/models/malang_mayhem.glb`에 덮어씁니다.
`verify_glb_structure.py`는 Blender 없이 GLB 바이너리를 직접 파싱해 접지(y=0)·정면(+Z)·좌우 대칭·클립 폭을 확인합니다.

## 캐릭터 리그와 모션 (`src/engine/character.ts`)

- GLB의 `HumanoidRig`를 `SkeletonUtils.clone`으로 플레이어·AI 봇마다 복제하고, `AnimationMixer`로 5개 클립을 재생합니다.
  원샷 클립(Bonk/Hit)은 끝나면 자동으로 달리기·대기로 돌아옵니다.
- 클립만으로 부족한 부분은 매 프레임 본 회전을 덧입혀 보강합니다: 달리기 다리·팔 스윙, 점프 스트레치,
  착지 스쿼시, 꿀밤·피격 흔들림, 대기 시 숨쉬기. 이동 방향으로 몸을 돌리고 발밑 접지 그림자를 함께 그립니다.
- 좌표 규칙은 **정면 +Z, 위 +Y, 발바닥 y=0**입니다. 모델을 눕히거나 축을 돌리는 보정은 넣지 않습니다.
- HUD는 `.hud-top`(라운드/타이머/초대) · `.hud-panels`(그리드: 목표·비밀 미션·점수·상태) · `.hud-bottom`(조작 힌트·장난 픽커)로
  나뉘어 있어 데스크톱과 모바일 어느 쪽에서도 패널이 겹치지 않습니다. `?debug`를 붙이면 `window.__mm.debugSnapshot()`으로
  본 회전·클립·화면 좌표를 확인할 수 있습니다.

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

## 협동 기믹: 고무줄 짝꿍 · 2인 합동 운반 · 2초 리스폰 · 대환장 어워드

- **고무줄 짝꿍**: 협동 라운드(피자 공장·풍선탑)에서 좌석 순서대로 2명씩 짝이 되고, 서버가 두 캐릭터를 탄성 스프링으로 묶습니다(휴식 길이 3.4m, 최대 6.6m).
  멀어지면 서로 끌어당겨지고, 한 명이 점프하면 고무줄이 팡 튀어 둘 다 휘청합니다(`tether` 이벤트). 1인 모드에서는 AI 봇이 짝이 됩니다.
- **2인 합동 운반**: 협동 라운드마다 `초대형 황금 피자`(피자 라운드)·`황금 트로피`(풍선 라운드)가 스폰됩니다. 혼자 `E`로 들면 34% 속도로 질질 끌리고, 둘이 함께 들면 86% 속도로 빨라지며 배달 보너스가 90P → 420P로 커집니다.
- **2초 리스폰**: 아레나 밖 낙하·장외·안내 색 발판 이탈 시 2초 카운트다운 뒤 안전 위치로 즉시 복귀하고 1.4초 무적 깜빡임이 붙습니다(관전 대기 없음).
- **대환장 어워드**: 서버가 매치 동안 장난 성공·리스폰·고무줄 팽·바나나/젤리 피해·합동 운반·배달을 집계해 최종 시상식에 실제 수치 기반 어워드 2~4개와 하이라이트 카드를 보여 줍니다.

## 행동별 쿨타임

`Q` 박치기 1.5초, `1` 꿀밤 2.0초, `2` 태클 2.8초, `3` 포옹 2.5초, `E` 잡기/던지기 0.8초, 점프 0.18초로 각각 독립된 서버 쿨타임을 가집니다. 쿨타임 중 입력은 버려지며, 남은 시간이 스냅샷 `cooldowns`로 내려와 PC 픽커·모바일 버튼에 초 단위로 표시됩니다. `1`/`2`/`3`과 픽커 버튼은 선택과 동시에 즉시 발동합니다.

## 대기실 닉네임 변경

대기실 상단 인라인 입력에서 닉네임을 바꾸면 `update_profile`로 서버가 검증(공백 제거·14자 제한)한 뒤 방 전체 명단과 인게임 이름표에 즉시 반영되고 `localStorage`에도 저장됩니다. 게임 중에는 변경이 무시됩니다.

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
pnpm smoke         # Chromium 데스크톱·모바일 스모크 (pnpm build 먼저)
```

테스트 전용 서버 환경변수(프로덕션 기본값에는 영향 없음): `MM_START_ROUND`, `MM_ROUND_MS`, `MM_COUNTDOWN_MS`, `MM_RESULT_MS`.
