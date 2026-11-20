# MALANG MAYHEM — TODO

## 완료

- [x] 기존 서버 권한형 구조와 정확히 5라운드 흐름을 유지한다.
- [x] `E`/Q 및 모바일 장난 버튼으로 2.5m 사거리·1.35초 쿨다운의 서버 판정 박치기를 구현한다.
- [x] 박치기 시 상대를 밀치고 바나나·피자·풍선·왕관 운반/소유 상태를 떨어뜨리며, 대기실에서도 방해를 허용한다.
- [x] 바나나 껍질 1.5초 미끄러짐, 끈적 젤리 웅덩이 이속 감소+2초 화면 얼룩, 뿅망치/충격파 주변 튕김, 방향 반전 2.5초를 서버 판정으로 구현한다.
- [x] 장난 성공 토스트·최근 로그와 서버 장난 점수(`prankCount`, `prankSuccesses`)를 구현한다.
- [x] 최종 시상식에 `최고의 장난꾸러기` 타이틀과 성공 횟수를 표시한다.
- [x] 제공 키비주얼을 타이틀·로비 배경과 `public/assets/share-keyvisual.png`로 연결한다.
- [x] Blender 4.0.2에서 광택/반투명 젤리, 눈·볼터치·입·귀·왕관, 장난 소품을 제작하고 Bevel/Subdivision/Smooth를 적용한다.
- [x] Blender GLB에 BananaPeel, JellyPuddle, Mallet, ReverseArrow 소품을 포함하고 Three.js GLTFLoader/SkeletonUtils로 로드한다.
- [x] 정면·측면·후면·상단·3-4 비교 렌더를 `shots/keyvisual-*.png`에 생성한다.
- [x] PC 키 가이드, 모바일/태블릿 safe-area 스틱·점프·상호작용·장난 버튼, 쿨다운·상태 HUD·장난 로그를 반영한다.
- [x] PRD/RULES/plan 문서를 업그레이드 내용으로 갱신하고 공유 favicon/OG 경로를 새 Blender 렌더로 연결한다.

## 검증 완료

- [x] `pnpm build` 통과: TypeScript, Vite, 용량 검사.
- [x] `pnpm test` 통과: 클라이언트 34개 테스트.
- [x] `pnpm --dir server test` 통과: 서버 2개 테스트.
- [x] `node --check server/authoritative_server.mjs` 통과.
- [x] 두 Socket.IO 세션에서 박치기 이벤트·쿨다운·중복 클라이언트 수신을 확인했다.
- [x] 두 Socket.IO 세션에서 게임 시작 후 `prankItems: 12`, `status` 4종, `prankCooldown` 숫자 필드를 확인했다.
- [x] GLB/BLEND/PNG 파일 형식과 최신 파일 크기를 확인했다.

## 남은 운영 작업

- [ ] 공개 Cloud Computer에 서버를 별도 배포하고 실제 도메인을 `ALLOWED_ORIGINS`에 등록한다.
- [ ] 공개 WSS 호스트에서 재접속 토큰과 장시간 5라운드 운용을 추가 검증한다.
- [ ] 저사양 모바일 GPU별 성능 프로파일링을 수행한다.


## 2026-11-20 초대·물리 고도화 완료

- [x] `?room=XXXXXX` URL 자동 방 코드 입력과 Enter 입장 흐름
- [x] Web Share API + 클립보드 fallback + 브라우저 생성 QR canvas
- [x] 대기실 LIVE 인원/준비 상태/입장 토스트/초대 패널
- [x] 데스크톱 3열 및 모바일 QR 토글 레이아웃 검증
- [x] 박치기 임펄스·바운스·650ms 무적·조건부 운반물 드롭
- [x] 바나나 관성/회전/재설치, 젤리 점성/탈출 저항/얼룩, 충격파 재설치 수치 조정
- [x] PRD/RULES 수치 표와 서버 snapshot 상태 필드 갱신
- [x] 빌드·34개 클라이언트 테스트·2개 서버 테스트·PC/모바일 smoke·2세션 동기화 검증


## 2026-11-20 1인 모드·모션 장난 완료

- [x] 타이틀 `혼자 플레이`와 쉽게/보통/어렵게 난이도 선택
- [x] 1인 시작 시 서버 봇 1/2/3명 생성, `말랑봇1` 익명 이름, 목표·아이템·장난 AI
- [x] Q 박치기, 1 꿀밤, 2 태클, 3 젤리 포옹 선택기와 모바일 선택 버튼
- [x] 서버 `stagger/knockdown/hug/spin` 상태·쿨다운·사거리·무적·드롭 판정
- [x] Three.js 절차적 스쿼시·스핀·별·태클·포옹 링 이펙트와 Blender JellyRig GLB 기본 애니메이션 결합
- [x] PRD/RULES 수치표 갱신
- [x] 1인 봇 동기화, 꿀밤 이벤트, 빌드·34개 클라이언트 테스트·2개 서버 테스트·PC/모바일 smoke 검증


## 2026-11-20 휴머노이드 아트 리빌딩 완료

- [x] 기존 젤리 블롭 대신 Blender 분리형 2.5등신 휴머노이드 토이 모델 제작
- [x] 민트·크림·코랄 팔레트, 세미매트 재질, Bevel·Subdivision·Smooth 적용
- [x] `HumanoidRig` 본 계층과 Blender `Idle/Run/Jump/Bonk/Hit` 액션 5개 GLB export
- [x] Three.js `SkeletonUtils.clone` + `AnimationMixer` 액션 cross-fade 연결
- [x] 서버 snapshot `action` 필드로 공격자 Bonk·피격자 Hit 신호 동기화
- [x] 정면·측면·후면·상단·3-4 휴머노이드 비교 렌더 생성
- [x] 매트 토이 라이팅·경기장·UI 색상 오버라이드 적용
- [x] 최종 GLB 노드·액션 검증, `pnpm build`, 34개 클라이언트 테스트, 2개 서버 테스트, PC/모바일 smoke 통과
