import './styles/main.css'
import './styles/upgrade.css'
import './styles/invite.css'
import './styles/solo-mode.css'
import './styles/matte-art.css'
import './styles/secret-mission.css'
import './styles/tether-award.css'
import './styles/actions.css'
import { io, type Socket } from 'socket.io-client'
import QRCode from 'qrcode'
import { PartyGame, type PartyState } from './game/party-game'

const COLORS = ['#ff5d8f', '#57c7ff', '#a877ff', '#62e8aa', '#ffbd4a', '#ff7b68', '#61e0d1', '#f28dff']
const COLOR_NAMES = ['딸기', '소다', '포도', '민트', '레몬', '복숭아', '아쿠아', '라벤더']
const saved = (() => { try { return JSON.parse(localStorage.getItem('malang-mayhem') || '{}') } catch { return {} } })()
let socket: Socket | null = null
let state: PartyState | null = null
let me: any = null
let resumeToken = saved.resumeToken || ''
let roomCode = ''
let input = { x: 0, z: 0, jump: false, interact: false, prank: false, prankType: 'headbutt' }
let keys = new Set<string>()
let lastInputAt = 0
let lastFrame = performance.now()
let qrRenderedCode = ''

const canvas = document.getElementById('game') as HTMLCanvasElement
const ui = document.getElementById('ui')!
const game = new PartyGame(canvas)

document.title = 'MALANG MAYHEM — 말랑말랑 대환장 파티'
ui.innerHTML = `
  <section class="screen boot-screen is-active" data-screen="boot"><div class="loader-mark">M</div><h1>MALANG MAYHEM</h1><p>말랑말랑 대환장 파티</p><div class="loading-line"><i></i></div><small>젤리 월드 준비 중...</small></section>
  <section class="screen title-screen" data-screen="title"><div class="title-copy"><div class="eyebrow">MALANG MAYHEM / PARTY PROTOCOL 01</div><h1>MALANG<br><em>MAYHEM</em></h1><p>친구들이랑 말랑하게 부딪히고, 웃기게 우승하세요.</p><div class="title-actions"><button class="primary" data-action="create">방 만들기 <span>→</span></button><button data-action="single">혼자 플레이 <span>1인 모드</span></button><button data-action="join">방 코드로 참가</button></div><div class="single-options"><label for="bot-difficulty"><span>봇 난이도</span><select id="bot-difficulty"><option value="easy">쉽게 · 봇 1명</option><option value="normal" selected>보통 · 봇 2명</option><option value="hard">어렵게 · 봇 3명</option></select></label></div><div class="join-row"><input id="join-code" maxlength="6" placeholder="6자리 방 코드" autocomplete="off"><button data-action="join-code">입장</button></div><div class="profile-card"><label>닉네임 <input id="nickname" maxlength="14" value="${saved.name || '말랑이'}"></label><div><span>내 색상</span><div class="color-picks">${COLORS.map((c, i) => `<button class="color-pick" data-color="${i}" style="--pick:${c}" aria-label="${COLOR_NAMES[i]}"></button>`).join('')}</div></div></div></div><div class="title-badge"><b>5</b><span>ROUNDS</span><small>1–8 PLAYERS</small></div><div class="title-blob blob-a"></div><div class="title-blob blob-b"></div></section>
  <section class="screen lobby-screen" data-screen="lobby"><div class="lobby-head"><div class="room-meta"><span class="eyebrow">ROOM CODE</span><div class="room-line"><button class="room-code" data-action="copy">------ <small>복사</small></button><span class="room-live" id="room-live">● LIVE</span></div></div><div class="lobby-rounds"><b>5 ROUNDS</b><span>개인전 3 · 협동전 2</span></div></div><div class="lobby-body"><div><h2>대기실 <span id="lobby-count">0/8</span></h2><p class="muted">친구에게 방 코드를 공유하고 모두 준비하면 출발!</p><div class="lobby-rename"><label for="lobby-nickname">닉네임</label><input id="lobby-nickname" maxlength="14" autocomplete="off" placeholder="닉네임"><button data-action="rename">변경</button><div class="lobby-colors">${COLORS.map((c, i) => `<button class="color-pick" data-color="${i}" style="--pick:${c}" aria-label="${COLOR_NAMES[i]}"></button>`).join('')}</div></div><div class="player-list" id="player-list"></div></div><aside class="rules-card"><span class="eyebrow">NEXT UP</span><h3 id="next-title">미끄덩 바나나 배달</h3><p id="next-desc">바나나를 들고 배달존까지 미끄러져 가세요. 제일 많이 배달한 사람이 웃음 포인트를 가져갑니다.</p><div class="mini-stats" id="next-stats"><span>75 SEC</span><span>SOLO</span><span>WASD + E</span></div><button class="primary wide" data-action="ready" id="ready-btn">준비 완료</button><button class="text-btn" data-action="start" id="start-btn">방장으로 게임 시작</button></aside><div class="invite-panel"><div><span class="eyebrow">INVITE FRIENDS</span><h3>친구를 바로 초대</h3><p>링크를 누르거나 QR을 스캔하면 방 코드가 자동으로 채워져요.</p><input id="invite-link" readonly><div class="invite-actions"><button class="primary" data-action="share">공유하기</button><button data-action="copy-invite">링크 복사</button><button data-action="toggle-qr">QR 보기</button></div></div><canvas id="qr-code" width="156" height="156" aria-label="방 초대 QR 코드"></canvas></div></div><button class="leave-link" data-action="leave">← 타이틀로 돌아가기</button></section>
  <section class="screen hud-screen" data-screen="hud"><div class="hud-top"><div class="hud-center"><div class="round-pill"><span id="round-count">ROUND 1 / 5</span><b id="round-title">미끄덩 바나나 배달</b></div><div class="timer" id="timer">75</div></div><button class="hud-btn" data-action="copy">초대 링크</button></div><div class="hud-panels"><div class="objective"><span class="eyebrow">OBJECTIVE</span><b id="objective-text">바나나를 들고 배달존으로!</b><div class="progress-track"><i id="progress-bar"></i></div><span id="progress-text">0 / 18</span><span id="tether-line" class="tether-line"></span></div><div class="secret-mission" id="secret-mission"><span class="eyebrow">SECRET PRANK</span><b>미션을 불러오는 중…</b><small>달성 시 +250P</small></div><div class="score-stack" id="score-stack"></div><div class="status-stack" id="status-stack"></div></div><div class="prank-log" id="prank-log"></div><div class="event-toast" id="event-toast"></div><div class="hud-bottom"><div class="controls-hint"><kbd>W A S D</kbd> 이동 <kbd>SPACE</kbd> 점프 <kbd>E</kbd> 잡기/줍기 <kbd>Q</kbd> 장난 · <kbd>1</kbd> 꿀밤 <kbd>2</kbd> 태클 <kbd>3</kbd> 포옹</div><div class="prank-picker" id="prank-picker"><button data-prank="headbutt"><span class="pk-key">Q</span><span class="pk-name">박치기</span><i class="pk-cd"></i></button><button data-prank="bonk"><span class="pk-key">1</span><span class="pk-name">꿀밤</span><i class="pk-cd"></i></button><button data-prank="tackle"><span class="pk-key">2</span><span class="pk-name">태클</span><i class="pk-cd"></i></button><button data-prank="hug"><span class="pk-key">3</span><span class="pk-name">포옹</span><i class="pk-cd"></i></button></div></div><div class="mobile-controls" id="mobile-controls"><div class="stick" id="stick"><i></i></div><button class="action-round jump" id="jump-btn" type="button" data-label="점프"><span class="ar-icon">⬆</span><span class="ar-label">점프</span><i class="cd-veil"></i></button><button class="action-round pink grab" id="interact-btn" type="button" data-label="잡기"><span class="ar-icon">✋</span><span class="ar-label">잡기</span><i class="cd-veil"></i></button><button class="action-round prank" id="prank-btn" type="button"><span class="ar-icon">😈</span><span class="ar-label" id="prank-btn-label" data-prank-label="박치기">박치기</span><i class="cd-veil"></i></button></div></section>
  <section class="screen result-screen" data-screen="result"><div class="result-card"><span class="eyebrow" id="result-kicker">ROUND COMPLETE</span><h2 id="result-title">라운드 결과</h2><p id="result-summary">말랑한 결과가 도착했어요.</p><div id="recap-list" class="recap-list"></div><div id="result-list" class="result-list"></div><button class="primary" data-action="result-close">다음 라운드로 →</button></div></section>
  <section class="screen final-screen" data-screen="final"><div class="confetti confetti-a"></div><div class="final-card"><span class="eyebrow">MALANG CHAMPIONSHIP</span><h2>최종 시상식</h2><p>오늘의 젤리 챔피언은...</p><div id="final-winner" class="winner-name">공동 우승!</div><div id="best-prankster" class="prank-award">최고의 장난꾸러기 — 아직 미정</div><div class="award-board" id="award-board"></div><div class="highlight-list" id="highlight-list"></div><div id="final-list" class="final-list"></div><button class="primary" data-action="rematch">다시 말랑하게!</button><button class="text-btn" data-action="leave">타이틀로</button></div></section>
  <div class="toast" id="toast"></div>
  <div class="respawn-hud" id="respawn-hud"></div>
`

function show(name: string) {
  document.body.dataset.screen = name
  document.querySelectorAll<HTMLElement>('[data-screen]').forEach(el => el.classList.toggle('is-active', el.dataset.screen === name))
  // 모바일 인게임에서는 토스트가 캐릭터 얼굴을 가리지 않게 픽커 위로 비켜 둔다(CSS 특이도 문제를 피해 인라인으로 지정).
  const toastEl = document.getElementById('toast')
  if (toastEl) {
    const mobileHud = name === 'hud' && innerWidth <= 800
    toastEl.style.top = mobileHud ? 'auto' : ''
    toastEl.style.bottom = mobileHud ? 'calc(248px + env(safe-area-inset-bottom,0px))' : ''
  }
}
function profile() { const name = (document.getElementById('nickname') as HTMLInputElement).value.trim() || '말랑이'; const selected = document.querySelector<HTMLElement>('.color-pick.is-selected'); return { name, colorIndex: Number(selected?.dataset.color || 0) } }
function persist() { const p = profile(); localStorage.setItem('malang-mayhem', JSON.stringify({ ...saved, ...p, resumeToken, room: roomCode })) }
function toast(message: string) { const el = document.getElementById('toast')!; el.textContent = message; el.classList.add('is-visible'); setTimeout(() => el.classList.remove('is-visible'), 2300) }
function connect(code: string, single = false) {
  roomCode = code || randomCode(); persist()
  socket?.disconnect()
  const botDifficulty = (document.getElementById('bot-difficulty') as HTMLSelectElement | null)?.value || 'normal'
  socket = io({ path: '/socket.io', transports: ['websocket', 'polling'], auth: { room: roomCode, resumeToken, botDifficulty, ...profile() } })
  socket.on('connect_error', () => toast('서버에 연결할 수 없어요. 게임 서버가 실행 중인지 확인하세요.'))
  socket.on('welcome', message => { if (message.marker !== 'malang-mayhem-v1') return; roomCode = message.code; resumeToken = message.resumeToken; me = message.player; game.setPlayerId(me.id); persist(); show('lobby'); toast(message.resumed ? '다시 접속했어요!' : `${me.name}님, 입장 완료!`); if (single) setTimeout(() => socket?.emit('start_single', botDifficulty), 180) })
  socket.on('state', next => { state = next; game.setState(next); renderState() })
  socket.on('event', event => { toast(event.text); addPrankLog(event.text, event.type); game.showPrankEffect(effectFor(event), event.x || 0, event.z || 0); if (event.type === 'round_result') show('result'); if (event.type === 'final') show('final') })
  socket.on('room_error', err => { toast(err.message || '방에 들어갈 수 없어요.'); socket?.disconnect() })
}
function randomCode() { const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('') }
function inviteUrl() { return `${location.origin}${location.pathname}?room=${encodeURIComponent(roomCode)}` }
async function renderInvite(code: string) {
  const url = inviteUrl()
  const inputEl = document.getElementById('invite-link') as HTMLInputElement | null
  if (inputEl) inputEl.value = url
  if (qrRenderedCode === code) return
  const canvasEl = document.getElementById('qr-code') as HTMLCanvasElement | null
  if (!canvasEl) return
  await QRCode.toCanvas(canvasEl, url, { width: 156, margin: 1, color: { dark: '#17152f', light: '#fff9e8' } })
  qrRenderedCode = code
}
async function copyInvite() {
  try { await navigator.clipboard.writeText(inviteUrl()); toast('초대 링크를 복사했어요!') } catch { toast(`방 코드 ${roomCode}를 친구에게 보내세요.`) }
}
async function shareInvite() {
  const url = inviteUrl()
  if (navigator.share) { try { await navigator.share({ title: 'MALANG MAYHEM 초대', text: `${roomCode} 방으로 놀러 오세요!`, url }); toast('초대 공유창을 열었어요!'); return } catch (error) { if ((error as DOMException).name === 'AbortError') return } }
  await copyInvite()
}
function renderState() {
  if (!state) return
  document.querySelector('.room-code')!.innerHTML = `${state.code} <small>복사</small>`
  roomCode = state.code
  void renderInvite(state.code)
  const list = document.getElementById('player-list')!
  document.getElementById('lobby-count')!.textContent = `${state.players.filter(p => p.connected).length}/8`
  document.getElementById('room-live')!.textContent = `● LIVE · ${state.players.filter(p => p.connected).length}/8`
  list.innerHTML = state.players.map(p => `<div class="player-row ${p.id === me?.id ? 'mine' : ''}"><i style="--player:${p.color}"></i><span>${escapeHtml(p.name)}</span>${p.host ? '<b class="host-tag">HOST</b>' : ''}<em>${p.ready ? 'READY' : '대기 중'}</em></div>`).join('')
  // 대기실 NEXT UP 카드는 이번 매치 1라운드(랜덤 셔플 결과)를 그대로 보여 준다.
  const nextRound = (state as any).plan?.[0]
  if (nextRound) {
    const nextTitle = document.getElementById('next-title')
    const nextDesc = document.getElementById('next-desc')
    const nextStats = document.getElementById('next-stats')
    if (nextTitle) nextTitle.textContent = nextRound.title
    if (nextDesc) nextDesc.textContent = `${nextRound.short} ${nextRound.mode === 'coop' ? '· 짝꿍과 함께 협동전!' : '· 개인전, 5라운드 중 첫 판!'}`
    if (nextStats) nextStats.innerHTML = `<span>${Math.round((nextRound.duration || 75) / 1)} SEC</span><span>${nextRound.mode === 'coop' ? 'CO-OP' : 'SOLO'}</span><span>${nextRound.mode === 'coop' ? 'PAIR + E' : 'WASD + E'}</span>`
  }
  const host = state.hostId === me?.id
  const myName = state.players.find(p => p.id === me?.id)?.name || ''
  const lobbyName = document.getElementById('lobby-nickname') as HTMLInputElement | null
  if (lobbyName && document.activeElement !== lobbyName) lobbyName.value = myName
  const titleName = document.getElementById('nickname') as HTMLInputElement | null
  if (titleName && document.activeElement !== titleName && myName) titleName.value = myName
  const lobbyColors = document.querySelectorAll<HTMLElement>('.lobby-colors .color-pick')
  if (lobbyColors.length) {
    const mineColor = state.players.find(p => p.id === me?.id)?.color
    lobbyColors.forEach(el => el.classList.toggle('is-selected', me ? COLORS[Number(el.dataset.color)] === mineColor : el.classList.contains('is-selected')))
  }
  const readyBtn = document.getElementById('ready-btn') as HTMLButtonElement
  const startBtn = document.getElementById('start-btn') as HTMLButtonElement
  readyBtn.textContent = me && state.players.find(p => p.id === me.id)?.ready ? '준비 취소' : '준비 완료'
  startBtn.disabled = !host || state.players.filter(p => p.connected).length < 1
  startBtn.textContent = host ? (state.players.filter(p => p.connected).length === 1 ? '1인 모드로 시작 · 봇 참가' : '방장으로 게임 시작') : '방장이 시작할 때까지 대기'
  if (state.phase === 'lobby') { show('lobby'); return }
  if (state.phase === 'result') { renderResult(state); show('result'); return }
  if (state.phase === 'final') { renderFinal(state); show('final'); return }
  show('hud')
  if (state.round) {
    document.getElementById('round-count')!.textContent = `ROUND ${state.roundIndex + 1} / 5`
    document.getElementById('round-title')!.textContent = state.round.title
    document.getElementById('objective-text')!.textContent = state.round.short
    const seconds = state.phase === 'countdown' ? Math.ceil(state.round.timeLeft) : Math.ceil(state.round.timeLeft)
    document.getElementById('timer')!.textContent = String(seconds).padStart(2, '0')
    const obj: any = state.objects || {}
    const current = obj.delivered ?? 0
    const total = obj.total ?? (state.round.mode === 'coop' ? (state.roundIndex === 3 ? 16 : 12) : 18)
    document.getElementById('progress-bar')!.style.width = `${Math.min(100, (current / total) * 100)}%`
    const survivalRound = ['crown', 'platform', 'bomb', 'sweeper', 'tail'].includes((state.round as any).type)
    document.getElementById('progress-text')!.textContent = survivalRound ? 'SURVIVE!' : `${current} / ${total}`
  }
  document.getElementById('score-stack')!.innerHTML = state.players.filter(p => p.connected).sort((a, b) => b.score - a.score).map(p => `<div class="score-row ${p.id === me?.id ? 'mine' : ''}"><i style="--player:${p.color}"></i><span>${escapeHtml(p.name)}</span><b>${p.score}</b></div>`).join('')
  const mine = state.players.find(p => p.id === me?.id)
  const partner = mine?.partnerId ? state.players.find(p => p.id === mine.partnerId) : null
  const tetherLine = document.getElementById('tether-line')
  if (tetherLine) {
    const pair = (state.pairs || []).find(p => p.a === mine?.id || p.b === mine?.id)
    const mega = (state.objects || {}).mega
    const megaFlag = mega && !mega.delivered ? `<span class="mega-flag">${mega.carriers?.length >= 2 ? `${mega.name} 짝꿍 운반 중` : mega.carriers?.length === 1 ? `${mega.name} 혼자 끄는 중` : `${mega.name} · 2명이서 E`}</span>` : mega?.delivered ? '<span class="mega-flag">황금 소품 배달 완료</span>' : ''
    if (partner) {
      const length = pair?.length ?? Math.hypot((mine?.x || 0) - partner.x, (mine?.z || 0) - partner.z)
      const tension = pair?.tension ?? 0
      tetherLine.className = `tether-line ${tension > 0.6 ? 'danger' : tension > 0.25 ? 'warn' : 'ok'}`
      tetherLine.innerHTML = `🪢 짝꿍 <b>${escapeHtml(partner.name)}</b> · 고무줄 ${length.toFixed(1)}m ${tension > 0.6 ? '팽팽!' : tension > 0.25 ? '늘어남' : '여유'}${megaFlag}`
    } else if (state.round?.mode === 'coop') {
      tetherLine.className = 'tether-line warn'
      tetherLine.innerHTML = `🪢 짝꿍 없이 혼자 뛰는 중${megaFlag}`
    } else {
      tetherLine.className = 'tether-line'
      tetherLine.innerHTML = megaFlag
    }
  }
  const respawnEl = document.getElementById('respawn-hud')
  if (respawnEl) {
    if (mine?.respawning) {
      respawnEl.innerHTML = `<b>${Math.max(0, (mine.respawnIn || 0) / 1000).toFixed(1)}</b><span>초 뒤 아레나 복귀</span>`
      respawnEl.classList.add('is-visible')
    } else respawnEl.classList.remove('is-visible')
  }
  const mission = mine?.secretMission
  const missionEl = document.getElementById('secret-mission')
  if (missionEl) missionEl.innerHTML = mission ? `<span class="eyebrow">SECRET PRANK</span><b>${escapeHtml(mission.text)}</b><small>달성 시 +250P · ${mine?.missionProgress || 0}/${mission.target}</small>` : '<span class="eyebrow">SECRET PRANK</span><b>미션을 불러오는 중…</b><small>달성 시 +250P</small>'
  const statuses = mine?.status || { slip: 0, slow: 0, ink: 0, reverse: 0, sticky: 0, stagger: 0, knockdown: 0, hug: 0 }
  document.getElementById('status-stack')!.innerHTML = [
    statuses.slip > 0 ? `<span class="status-chip slip">미끄덩 ${Math.ceil(statuses.slip / 1000)}s</span>` : '',
    statuses.slow > 0 ? `<span class="status-chip slow">끈적 ${Math.ceil(statuses.slow / 1000)}s</span>` : '',
    (statuses.sticky ?? 0) > 0 ? `<span class="status-chip slow">탈출 저항</span>` : '',
    (statuses.stagger ?? 0) > 0 ? `<span class="status-chip slip">꿀밤 ${Math.ceil((statuses.stagger ?? 0) / 1000)}s</span>` : '',
    (statuses.knockdown ?? 0) > 0 ? `<span class="status-chip ink">넘어짐</span>` : '',
    (statuses.hug ?? 0) > 0 ? `<span class="status-chip reverse">꽁꽁 ${Math.ceil((statuses.hug ?? 0) / 1000)}s</span>` : '',
    statuses.ink > 0 ? `<span class="status-chip ink">화면 얼룩</span>` : '',
    statuses.reverse > 0 ? `<span class="status-chip reverse">반전 ${Math.ceil(statuses.reverse / 1000)}s</span>` : '',
  ].join('')
  document.body.classList.toggle('inked', statuses.ink > 0)
  // 서버가 준 쿨타임 표를 기준으로, 클라이언트에서도 같은 시간만큼 즉시 잠근다.
  cooldownTable = { ...FALLBACK_CD_MS, ...((state as any).cooldownMs || {}) }
  serverRemain = { ...((mine?.cooldowns || {}) as Record<string, number>) }
  meRespawning = Boolean(mine?.respawning)
  paintCooldowns()
  renderObjective(state, mine)
}
function renderResult(next: PartyState) {
  const result = next.result
  if (!result) return
  document.getElementById('result-title')!.textContent = result.title
  document.getElementById('result-summary')!.textContent = result.mode === 'coop' ? `공동 목표 달성률 ${(result.progress * 100).toFixed(0)}% · 고무줄 짝꿍 합동 운반 보너스 포함` : '이번 라운드에서 가장 말랑했던 순서'
  const recap = document.getElementById('recap-list')
  if (recap) recap.innerHTML = (result.recap || []).map((row: any) => `<div class="recap-row"><span>${escapeHtml(row.label)}</span><b>${escapeHtml(row.name || '')}</b><em>${escapeHtml(row.value || '')}</em></div>`).join('')
  document.getElementById('result-list')!.innerHTML = result.results.map((r: any, i: number) => `<div class="result-row"><strong>${i + 1}</strong><i style="--player:${r.color}"></i><span>${escapeHtml(r.name)}${r.missionComplete ? ' · 비밀 미션 달성' : ''}</span><b>+${r.points}</b><em>${r.total} P</em></div>`).join('')
}
function renderFinal(next: PartyState) {
  const result = next.result
  const rankings = result?.rankings || []
  const winners = result?.winners || []
  document.getElementById('final-winner')!.textContent = winners.length > 1 ? '공동 우승!' : rankings[0]?.name || '말랑 챔피언'
  const prankster = result?.bestPrankster
  document.getElementById('best-prankster')!.textContent = prankster ? `최고의 장난꾸러기 — ${prankster.name} (${prankster.prankSuccesses}회)` : '최고의 장난꾸러기 — 아직 미정'
  const board = document.getElementById('award-board')
  if (board) board.innerHTML = (result?.awards || []).map((award: any) => `<div class="award-card"><span class="award-emoji">${award.emoji || '🏅'}</span><div><b>${escapeHtml(award.title)}</b><span class="award-winner">${(award.names || []).map((name: string) => escapeHtml(name)).join(' · ')}</span><small>${escapeHtml(award.metric || '')}${award.tagline ? ` — ${escapeHtml(award.tagline)}` : ''}</small></div></div>`).join('')
  const highlights = document.getElementById('highlight-list')
  if (highlights) highlights.innerHTML = (result?.highlights || []).map((row: any) => `<div class="highlight-row"><span>${escapeHtml(row.label)}</span><p>${escapeHtml(row.text)}</p><em>${escapeHtml(row.value || '')}</em></div>`).join('')
  document.getElementById('final-list')!.innerHTML = rankings.map((r: any) => `<div class="final-row"><span>${r.rank}</span><i style="--player:${r.color}"></i><b>${escapeHtml(r.name)}</b><strong>${r.score}</strong></div>`).join('')
}
function escapeHtml(value: string) { return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c)) }
const PRANK_NAMES: Record<string, string> = { headbutt: '박치기', bonk: '꿀밤', tackle: '태클', hug: '포옹' }
const PRANK_ICONS: Record<string, string> = { headbutt: '😈', bonk: '🔨', tackle: '🦵', hug: '🫂' }
// 서버 ACTION_COOLDOWN_MS와 같은 기본값. state.cooldownMs가 오면 그 값이 우선한다.
const FALLBACK_CD_MS: Record<string, number> = { headbutt: 1500, bonk: 2000, tackle: 2800, hug: 2500, grab: 800, jump: 180 }
let cooldownTable: Record<string, number> = { ...FALLBACK_CD_MS }
// 마지막 스냅샷이 알려 준 남은 쿨타임. 내가 직접 발동한 동작은 로컬 잠금이 우선이라
// 지연 도착한 스냅샷 때문에 게이지가 뒤로 튀지 않는다.
let serverRemain: Record<string, number> = {}
let meRespawning = false
const localCds: Record<string, number> = {}
let sentPrankCount = 0
let lastCast: Record<string, unknown> = {}
// 실제로 화면에 그려진 마지막 쿨타임 초(검수·테스트용 기록).
const shownCd: Record<string, string> = {}
function cooldownMs(type: string) { return cooldownTable[type] || FALLBACK_CD_MS[type] || 0 }
/** 남은 쿨타임(ms) = max(내가 즉시 잠근 시간, 서버 스냅샷의 남은 시간). */
function remainingMs(type: string) {
  const local = Math.max(0, (localCds[type] || 0) - performance.now())
  if (local > 0) return local
  return Math.max(0, serverRemain[type] || 0)
}
function lockLocal(type: string, extra = 0) { localCds[type] = Math.max(localCds[type] || 0, performance.now() + cooldownMs(type) + extra) }
function flashBlocked(type: string) {
  const el = type === 'grab' ? document.getElementById('interact-btn') : type === 'jump' ? document.getElementById('jump-btn') : document.getElementById('prank-btn')
  if (!el) return
  el.classList.remove('is-blocked')
  void el.offsetWidth
  el.classList.add('is-blocked')
  setTimeout(() => el.classList.remove('is-blocked'), 260)
}
/** 장난 선택 + (trigger=true면) 즉시 발동. PC 1/2/3·픽커·모바일 버튼이 모두 이 경로를 쓴다. */
function selectPrank(type: string, trigger = false) {
  input.prankType = type
  document.querySelectorAll<HTMLElement>('[data-prank]').forEach(el => el.classList.toggle('is-selected', el.dataset.prank === type))
  const prankButton = document.getElementById('prank-btn')
  const label = document.getElementById('prank-btn-label')
  const skillName = PRANK_NAMES[type] || '장난'
  if (prankButton) prankButton.dataset.label = skillName
  if (label) label.textContent = skillName
  const icon = document.querySelector('#prank-btn .ar-icon')
  if (icon) icon.textContent = PRANK_ICONS[type] || '😈'
  if (!trigger) { paintCooldowns(); return }
  const remain = remainingMs(type)
  if (remain > 0 || meRespawning) { flashBlocked(type); paintCooldowns(); return }
  if (!socket?.connected || !me) { toast('아직 서버에 연결되지 않았어요.'); return }
  lockLocal(type, 60)
  lastCast = { kind: 'prank', type, before: remain, lockedUntil: localCds[type], now: performance.now(), table: cooldownTable[type] }
  input.prank = true
  sentPrankCount++
  game.hintAction('Bonk')
  flushInput()
  paintCooldowns()
}
/** 점프·잡기처럼 실패해도 손해가 없는 동작은 같은 방식으로 즉시 잠그고 보낸다. */
function pressAction(kind: 'jump' | 'interact') {
  const type = kind === 'jump' ? 'jump' : 'grab'
  if (remainingMs(type) > 0 || meRespawning) { flashBlocked(type); paintCooldowns(); return }
  if (!socket?.connected || !me) return
  lockLocal(type, 40)
  lastCast = { kind, type, lockedUntil: localCds[type], now: performance.now(), table: cooldownTable[type] }
  if (kind === 'jump') input.jump = true
  else input.interact = true
  flushInput()
  paintCooldowns()
}
/** 픽커·모바일 버튼의 쿨타임 게이지와 남은 초를 한 곳에서 그린다. */
function paintCooldowns() {
  document.querySelectorAll<HTMLButtonElement>('[data-prank]').forEach(button => {
    const type = button.dataset.prank || 'headbutt'
    const total = cooldownMs(type) || 1
    const remain = remainingMs(type)
    const cooling = remain > 0
    button.classList.toggle('is-cooling', cooling)
    button.classList.toggle('is-selected', input.prankType === type)
    button.style.setProperty('--cd', String(Math.min(1, remain / total)))
    button.setAttribute('aria-disabled', cooling ? 'true' : 'false')
    const cd = button.querySelector<HTMLElement>('.pk-cd')
    if (cd) { cd.textContent = cooling ? `${(remain / 1000).toFixed(1)}` : ''; if (cooling) shownCd[type] = cd.textContent }
  })
  // 원형 버튼은 쿨타임 동안 이름 대신 남은 초를 크게 보여 준다(원형 veil이 남은 비율을 채운다).
  const paintAction = (id: string, type: string, fallbackLabel: string) => {
    const el = document.getElementById(id)
    if (!el) return
    const remain = remainingMs(type)
    el.classList.toggle('is-cooling', remain > 0)
    el.setAttribute('aria-disabled', remain > 0 ? 'true' : 'false')
    el.style.setProperty('--cd', String(Math.min(1, remain / (cooldownMs(type) || 1))))
    const label = el.querySelector<HTMLElement>('.ar-label')
    if (!label) return
    const text = remain > 0 ? `${(remain / 1000).toFixed(1)}s` : (el.dataset.label || fallbackLabel)
    label.textContent = text
    if (remain > 0) shownCd[type] = text
  }
  paintAction('prank-btn', input.prankType, PRANK_NAMES[input.prankType] || '장난')
  paintAction('interact-btn', 'grab', '잡기')
  paintAction('jump-btn', 'jump', '점프')
}
/** 미니게임별 목표·진행 표시(폭탄 남은 초, 스위퍼 생존, 꼬리 개수). */
function renderObjective(state: PartyState, mine: any) {
  const objects = (state.objects || {}) as any
  const bar = document.getElementById('progress-bar')
  const text = document.getElementById('progress-text')
  const objective = document.getElementById('objective-text')
  if (!bar || !text || !objective) return
  if (objects.type === 'bomb' && objects.bomb) {
    const fuse = Number(objects.bomb.fuse || 0)
    const holder = objects.bomb.holderName || '없음'
    text.textContent = fuse > 0 ? `${fuse.toFixed(1)}s` : '폭발!'
    bar.style.width = `${Math.max(0, Math.min(100, (fuse / 12) * 100))}%`
    objective.textContent = objects.bomb.holder === mine?.id ? '내가 폭탄! 다른 사람에게 넘겨라!' : `${holder}님이 폭탄을 들고 있어요`
    return
  }
  if (objects.type === 'sweeper' && objects.sweeper) {
    const sweeper = objects.sweeper
    const alive = state.players.filter((p: any) => !p.respawning).length
    const left = Math.max(0, Math.ceil(state.round?.timeLeft || 0))
    text.textContent = `생존 ${alive}명 · ${left}s`
    bar.style.width = `${Math.max(0, Math.min(100, ((state.round?.duration || 1) - left) / (state.round?.duration || 1) * 100))}%`
    objective.textContent = sweeper.warn > 0 ? '막대 방향 반전 예고! 타이밍을 봐!' : '회전 막대를 점프로 넘어!'
    return
  }
  if (objects.type === 'tail') {
    const tails = (objects.tails || []) as any[]
    const mineTail = tails.some(tail => tail.id === mine?.id)
    text.textContent = `꼬리 ${tails.length}개 · 강탈 ${objects.stolen || 0}회`
    bar.style.width = `${Math.min(100, tails.length / Math.max(1, state.players.length) * 100)}%`
    objective.textContent = mineTail ? '꼬리를 지켜라! 쫓아오는 사람을 뿌리쳐!' : '꼬리를 가진 사람을 쫓아가 뺏어라!'
    return
  }
}
function rename() {
  const field = document.getElementById('lobby-nickname') as HTMLInputElement | null
  const value = (field?.value || '').trim().slice(0, 14)
  if (!value) { toast('닉네임을 입력해 주세요.'); field?.focus(); return }
  if (!socket?.connected || state?.phase !== 'lobby') { toast('대기실에서만 바꿀 수 있어요.'); return }
  const colorIndex = Number(document.querySelector<HTMLElement>('.color-pick.is-selected')?.dataset.color ?? 0)
  socket.emit('update_profile', { name: value, colorIndex })
  const title = document.getElementById('nickname') as HTMLInputElement | null
  if (title) title.value = value
  persist()
  toast(`닉네임을 ${value}(으)로 바꿨어요!`)
}
const EVENT_EFFECTS: Record<string, string> = { shatter: 'shatter', grab: 'grab', prank: 'shockwave', tether: 'tether', fall: 'fall', respawn: 'respawn', mega: 'mega', mega_grab: 'mega_grab', mega_drop: 'mega_drop', bomb_boom: 'boom', bomb_pass: 'bomb', sweeper_hit: 'sweeper', sweeper_assist: 'sweeper', sweeper_warn: 'sweeper', tail_steal: 'tail', tail_bonus: 'tail' }
function effectFor(event: any) { return event.itemType || EVENT_EFFECTS[event.type] || 'reverse' }
function leave() { socket?.disconnect(); socket = null; state = null; me = null; show('title'); toast('다음 파티를 기다리고 있어요.') }
function addPrankLog(message: string, type: string) { if (!['prank', 'prank_item', 'crown', 'mega', 'mega_grab', 'tether', 'fall', 'respawn'].includes(type)) return; const log = document.getElementById('prank-log'); if (!log) return; const line = document.createElement('div'); line.textContent = message; log.prepend(line); while (log.children.length > 3) log.lastElementChild?.remove() }
function sendInput(now: number) { if (!socket?.connected || !me) return; if (now - lastInputAt < 45) return; lastInputAt = now; socket.emit('input', input); input.jump = false; input.interact = false; input.prank = false }
function flushInput() { if (!socket?.connected || !me) return; lastInputAt = performance.now(); socket.emit('input', input); input.jump = false; input.interact = false; input.prank = false }

ui.addEventListener('click', e => {
  const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action], .color-pick')
  if (!target) return
  if (target.classList.contains('color-pick')) {
    const wasSelected = target.classList.contains('is-selected')
    document.querySelectorAll('.color-pick').forEach(el => el.classList.remove('is-selected'))
    document.querySelectorAll(`.color-pick[data-color="${target.dataset.color}"]`).forEach(el => el.classList.add('is-selected'))
    persist()
    if (!wasSelected && socket?.connected && state?.phase === 'lobby') socket.emit('update_profile', { name: profile().name, colorIndex: Number(target.dataset.color) })
    return
  }
  const action = target.dataset.action
  if (action === 'create') connect(randomCode())
  if (action === 'single') connect(randomCode(), true)
  if (action === 'join') (document.getElementById('join-code') as HTMLInputElement).focus()
  if (action === 'join-code') { const code = (document.getElementById('join-code') as HTMLInputElement).value.toUpperCase().replace(/[^A-Z0-9]/g, ''); if (code.length !== 6) toast('방 코드는 6자리예요.'); else connect(code) }
  if (action === 'ready') socket?.emit('toggle_ready')
  if (action === 'rename') rename()
  if (action === 'start') socket?.emit('start_match')
  if (action === 'rematch') socket?.emit('rematch')
  if (action === 'result-close') { if (state?.phase === 'result') show('hud') }
  if (action === 'leave') leave()
  if (action === 'copy' || action === 'copy-invite') void copyInvite()
  if (action === 'share') void shareInvite()
  if (action === 'toggle-qr') document.querySelector('.invite-panel')?.classList.toggle('qr-open')
})
const initialColor = Number(saved.colorIndex || 0)
document.querySelectorAll<HTMLElement>('.color-pick')[initialColor]?.classList.add('is-selected')
const codeInput = document.getElementById('join-code') as HTMLInputElement
codeInput.addEventListener('keydown', e => { if (e.key === 'Enter') document.querySelector<HTMLElement>('[data-action="join-code"]')?.click() })
const lobbyNameInput = document.getElementById('lobby-nickname') as HTMLInputElement
lobbyNameInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); rename() } })
const roomFromUrl = new URLSearchParams(location.search).get('room')?.toUpperCase().replace(/[^A-Z0-9]/g, '') || ''
if (roomFromUrl.length === 6) { codeInput.value = roomFromUrl; document.getElementById('nickname')?.addEventListener('keydown', e => { if (e.key === 'Enter') connect(roomFromUrl) }); toast('초대 링크의 방 코드가 채워졌어요.') }

addEventListener('keydown', e => {
  if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return
  keys.add(e.code)
  if (e.code === 'Space') { e.preventDefault(); pressAction('jump') }
  if (e.code === 'KeyE') { e.preventDefault(); pressAction('interact') }
  if (e.code === 'KeyQ') { selectPrank('headbutt', true); e.preventDefault() }
  if (e.code === 'Digit1') { selectPrank('bonk', true); e.preventDefault() }
  if (e.code === 'Digit2') { selectPrank('tackle', true); e.preventDefault() }
  if (e.code === 'Digit3') { selectPrank('hug', true); e.preventDefault() }
})
addEventListener('keyup', e => keys.delete(e.code))
function updateKeyboard() { const x = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft')); const z = Number(keys.has('KeyS') || keys.has('ArrowDown')) - Number(keys.has('KeyW') || keys.has('ArrowUp')); if (x || z) { const len = Math.hypot(x, z) || 1; input.x = x / len; input.z = z / len } else if (!document.getElementById('stick')?.classList.contains('active')) { input.x = 0; input.z = 0 } }
/**
 * 모바일 입력.
 * - 버튼: pointerdown / touchstart / click 중 먼저 온 하나만 처리한다(중복 발동 방지).
 *   터치 기기에서 pointer 이벤트가 막히는 인앱 브라우저를 위해 touchstart·click 폴백을 둔다.
 * - 스틱: 포인터 캡처 + pointercancel/lostpointercapture 해제. 터치 폴백도 같은 경로를 쓴다.
 * - 모든 버튼은 쿨타임 중이면 즉시 시각 피드백만 하고 서버로 보내지 않는다.
 */
function bindPress(el: HTMLElement | null, handler: (event: Event) => void) {
  if (!el) return
  let lastHandled = -1000
  const run = (event: Event) => {
    const now = performance.now()
    if (now - lastHandled < 450) return
    lastHandled = now
    if (event.cancelable) event.preventDefault()
    handler(event)
  }
  el.addEventListener('pointerdown', event => { if ((event as PointerEvent).pointerType === 'mouse' && (event as PointerEvent).button !== 0) return; run(event) }, { passive: false })
  el.addEventListener('touchstart', event => run(event), { passive: false })
  el.addEventListener('click', event => run(event))
}
function setupTouch() {
  const stick = document.getElementById('stick')!
  const knob = stick.querySelector('i') as HTMLElement
  let pointerId: number | null = null
  let lastPointerAt = -1000
  const move = (clientX: number, clientY: number) => {
    const r = stick.getBoundingClientRect()
    const dx = clientX - (r.left + r.width / 2), dy = clientY - (r.top + r.height / 2)
    const d = Math.min(45, Math.hypot(dx, dy)), a = Math.atan2(dy, dx)
    const x = Math.cos(a) * d, y = Math.sin(a) * d
    knob.style.transform = `translate(${x}px,${y}px)`
    input.x = x / 45; input.z = y / 45
  }
  const release = () => {
    pointerId = null
    stick.classList.remove('active')
    knob.style.transform = ''
    input.x = 0; input.z = 0
  }
  stick.addEventListener('pointerdown', event => {
    event.preventDefault()
    lastPointerAt = performance.now()
    if (pointerId !== null) return
    pointerId = event.pointerId
    stick.classList.add('active')
    try { stick.setPointerCapture(event.pointerId) } catch { /* 캡처 미지원 브라우저 */ }
    move(event.clientX, event.clientY)
  }, { passive: false })
  stick.addEventListener('pointermove', event => {
    if (event.pointerId !== pointerId) return
    event.preventDefault()
    move(event.clientX, event.clientY)
  }, { passive: false })
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) stick.addEventListener(type, () => release())
  // 포인터 이벤트가 없는 구형·인앱 브라우저용 터치 폴백
  stick.addEventListener('touchstart', event => {
    if (performance.now() - lastPointerAt < 600) return
    const touch = event.changedTouches[0]
    if (!touch) return
    event.preventDefault()
    stick.classList.add('active')
    move(touch.clientX, touch.clientY)
  }, { passive: false })
  stick.addEventListener('touchmove', event => {
    if (performance.now() - lastPointerAt < 600) return
    const touch = event.changedTouches[0]
    if (!touch) return
    event.preventDefault()
    move(touch.clientX, touch.clientY)
  }, { passive: false })
  for (const type of ['touchend', 'touchcancel'] as const) stick.addEventListener(type, () => { if (performance.now() - lastPointerAt >= 600) release() })

  bindPress(document.getElementById('jump-btn'), () => pressAction('jump'))
  bindPress(document.getElementById('interact-btn'), () => pressAction('interact'))
  bindPress(document.getElementById('prank-btn'), () => selectPrank(input.prankType, true))
  document.querySelectorAll<HTMLElement>('[data-prank]').forEach(button => bindPress(button, () => selectPrank(button.dataset.prank || 'headbutt', true)))
}
setupTouch()

const PROPS_MODE = new URLSearchParams(location.search).has('props')
void game.load().then(() => {
  document.querySelector('.loading-line i')?.setAttribute('style', 'transform:scaleX(1)')
  if (PROPS_MODE) { mountPropsGallery(); return }
  setTimeout(() => show('title'), 450)
}).catch(() => show('title'))

/** `?props` 검수용: 모든 아이템 소품을 한 화면에 늘어놓고 이름표를 붙인다. */
function mountPropsGallery() {
  document.body.classList.add('props-gallery')
  const overlay = document.createElement('div')
  overlay.className = 'props-labels'
  document.body.appendChild(overlay)
  const labels = game.showcase()
  overlay.innerHTML = labels.map(entry => `<span>${entry.label}</span>`).join('')
  const tick = () => {
    const next = game.showcaseLabels()
    next.forEach((entry, index) => {
      const span = overlay.children[index] as HTMLElement | undefined
      if (span) span.style.transform = `translate(${entry.x}px, ${entry.y}px) translate(-50%, -50%)`
    })
    requestAnimationFrame(tick)
  }
  tick()
}
// `?debug` 검수용: 렌더 프레임률과 무관하게 입력을 직접 보내 캐릭터를 정확히 움직인다.
let debugMove: { x: number; z: number } | null = null
if (new URLSearchParams(location.search).has('debug')) {
  (window as unknown as Record<string, unknown>).__mmClient = {
    snapshot: () => ({
      phase: state?.phase,
      roundIndex: state?.roundIndex,
      round: state?.round,
      plan: (state as any)?.plan,
      input: { ...input },
      remaining: Object.fromEntries(['headbutt', 'bonk', 'tackle', 'hug', 'grab', 'jump'].map(type => [type, Math.round(remainingMs(type))])),
      sentPranks: sentPrankCount,
      skill: input.prankType,
      prankLabel: document.getElementById('prank-btn')?.dataset.label || '',
      prankTime: document.querySelector('#prank-btn .ar-label')?.textContent,
      prankCooling: document.getElementById('prank-btn')?.classList.contains('is-cooling'),
      picker: [...document.querySelectorAll<HTMLElement>('[data-prank]')].map(button => ({ type: button.dataset.prank, cooling: button.classList.contains('is-cooling'), cd: button.querySelector('.pk-cd')?.textContent, selected: button.classList.contains('is-selected') })),
      shownCd: { ...shownCd },
      jumpCooling: document.getElementById('jump-btn')?.classList.contains('is-cooling'),
      grabCooling: document.getElementById('interact-btn')?.classList.contains('is-cooling'),
      cds: { local: { ...localCds }, serverRemain: { ...serverRemain }, table: { ...cooldownTable }, lastCast, respawning: meRespawning, now: Math.round(performance.now()) },
      objects: (state?.objects as any)?.type,
      objective: document.getElementById('objective-text')?.textContent,
      progress: document.getElementById('progress-text')?.textContent,
    }),
    cast: (type: string) => { selectPrank(type, true); return Math.round(remainingMs(type)) },
    lock: (type: string, ms: number) => { localCds[type] = performance.now() + Math.max(0, ms); paintCooldowns(); return Math.round(remainingMs(type)) },
  };
  (window as unknown as Record<string, unknown>).__mmInput = (next: Partial<typeof input>) => {
    if (next.x !== undefined || next.z !== undefined) debugMove = { x: next.x ?? 0, z: next.z ?? 0 }
    Object.assign(input, next)
    flushInput()
    return { ...input }
  }
}
let lastCooldownPaint = 0
function frame(now: number) {
  const dt = Math.min(.05, (now - lastFrame) / 1000); lastFrame = now
  updateKeyboard()
  if (debugMove) { input.x = debugMove.x; input.z = debugMove.z }
  game.setInput(input.x, input.z)
  sendInput(now)
  // 스냅샷이 띄엄띄엄 와도 쿨타임 초가 끊기지 않게 프레임에서도 다시 그린다.
  if (now - lastCooldownPaint > 110) { lastCooldownPaint = now; if (state?.phase === 'play' || state?.phase === 'countdown') paintCooldowns() }
  game.render(dt)
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
