#!/usr/bin/env node
import express from 'express'
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Server } from 'socket.io'
import { createHerd, herdBotTarget, herdSnapshot, tickHerd } from './herd-round.mjs'
import { createSwitch, createVault, moveVaultHazards, switchSnapshot, tickSwitch, vaultBotTarget, vaultCollision } from './coop-rounds.mjs'

const MARKER = 'malang-mayhem-v1'
const HOST = process.env.HOST || '127.0.0.1'
const PORT = Number(process.env.PORT || 8787)
const STATIC_ROOT = resolve(process.env.STATIC_ROOT || join(fileURLToPath(new URL('.', import.meta.url)), '../dist'))
const TICK_MS = 50
const RECONNECT_GRACE_MS = 30_000
const ROOM_IDLE_MS = 15 * 60_000
const MAX_PLAYERS = 8
const MAX_ROOMS = 256
const WORLD_RADIUS = 10
const MOVE_SPEED = 5.4
const MOVE_ACCEL = 28
const BRAKE_ACCEL = 36
const JUMP_SPEED = 6.5
const GRAVITY = 18
const PRANK_RANGE = 2.5
// 행동별 서버 쿨타임 — 무한 연타를 막고 동작마다 다른 리듬을 준다.
// 테스트에서만 MM_COOLDOWN_SCALE로 늘려 쿨타임 표시를 길게 관찰할 수 있다(기본 1 = 실제 값).
const COOLDOWN_SCALE = Math.max(0.05, Number(process.env.MM_COOLDOWN_SCALE || 1) || 1)
const scaleCd = ms => Math.round(ms * COOLDOWN_SCALE)
const ACTION_COOLDOWN_MS = { headbutt: scaleCd(1500), bonk: scaleCd(2000), tackle: scaleCd(2800), hug: scaleCd(2500), grab: scaleCd(800), jump: scaleCd(180), item: scaleCd(2500) }
const PRANK_IMMUNITY_MS = 650
const PRANK_IMPULSE = 11.5
const PRANK_BOUNCE = 3.8
const BANANA_SLIP_MS = 1750
const BANANA_SLIP_ACCEL = 1.65
const BANANA_RESPAWN_MS = 3000
const JELLY_SLOW_MS = 2400
const JELLY_ESCAPE_MS = 850
const JELLY_INK_MS = 3200
const JELLY_RESPAWN_MS = 4500
const SHOCKWAVE_RADIUS = 3.8
const SHOCKWAVE_IMPULSE = 9.2
const SHOCKWAVE_BOUNCE = 4.8
const REVERSE_MS = 2500
const PRANK_ITEM_LIFETIME_MS = 18000
const MOTION_PRANKS = ['headbutt', 'bonk', 'tackle', 'hug']
const BONK_STAGGER_MS = 1000
const TACKLE_KNOCKDOWN_MS = 1200
const HUG_SLOW_MS = 1200
const PRANK_ITEM_COUNT = 12
const PRANK_TYPES = ['banana_peel', 'jelly_pool', 'shockwave', 'reverse']
const SECRET_MISSIONS = [
  { kind: 'bonk_winner', text: '이번 라운드 1등에게 꿀밤 1회 성공', target: 1 },
  { kind: 'drop_two', text: '상대가 든 소품 2회 떨어뜨리기', target: 2 },
  { kind: 'ringout', text: '밀치기로 1명 장외시키기', target: 1 },
]
// ── 고무줄 짝꿍 · 2인 합동 운반 · 2초 리스폰 (pair/coop 기믹) ──
const MEGA_ID = 'mega'
const TETHER_REST = 3.4
const TETHER_MAX = 6.6
const TETHER_SPRING = 34
const TETHER_DAMPING = 3.4
const TETHER_YANK_MS = 420
const TETHER_YANK_PULL = 4.8
const TETHER_EVENT_MS = 1500
const TETHER_WOBBLE_OVER = 1.5
const RESPAWN_COUNTDOWN_MS = 2000
const RESPAWN_IMMUNE_MS = 1400
const MEGA_REACH = 2.4
const MEGA_ZONE_RADIUS = 2.3
const MEGA_SINGLE_FACTOR = 0.34
const MEGA_PAIR_FACTOR = 0.86
const MEGA_SPLIT_MAX = 3.0
const MEGA_DUO_SCORE = 420
const MEGA_SOLO_SCORE = 90
const MEGA_SPAWN = { x: 0, z: 5.4 }
const MEGA_ZONE = { x: 0, z: -7.2 }
// 테스트 전용 훅(프로덕션에서는 환경변수가 없어 기본값 그대로 동작한다).
const ENV_ROUND_MS = Number(process.env.MM_ROUND_MS || 0)
const ENV_START_ROUND = Number(process.env.MM_START_ROUND || 0)
const COUNTDOWN_MS = Number(process.env.MM_COUNTDOWN_MS || 2000)
const OPENING_MS = Number(process.env.MM_OPENING_MS ?? (process.env.MM_COUNTDOWN_MS ? Math.min(2200, COUNTDOWN_MS) : 2200))
const RESULT_MS = Number(process.env.MM_RESULT_MS || 6500)
const COOP_SUCCESS_DISPLAY_MS = 1250
const GRAB_RANGE = 1.65
const GRAB_DURATION_MS = 1800
const GRAB_COOLDOWN_MS = ACTION_COOLDOWN_MS.grab
const GRAB_ESCAPE_PRESSES = 3
const THROW_IMPULSE = 12.5
const SHATTER_IMPULSE = 9.5
const JUMP_BUFFER_MS = 140
const COYOTE_MS = 110
const ROUND_SECONDS = 75
// ── 신규 미니게임: 시한폭탄 · 회전 스위퍼 · 꼬리 뺏기 ──
const BOMB_FUSE_MS = Number(process.env.MM_BOMB_FUSE_MS || 0) || 12_000
const BOMB_PASS_IMMUNE_MS = 600
const BOMB_PASS_COOLDOWN_MS = 380
const BOMB_PASS_POINTS = 15
const BOMB_SURVIVE_POINTS = 120
const SWEEPER_BASE_SPEED = Number(process.env.MM_SWEEPER_SPEED || 0) || 1.05
const SWEEPER_MAX_SPEED = 2.35
const SWEEPER_RADIUS = 9.2
const SWEEPER_BAR_HALF = 0.55
const SWEEPER_CLEAR_JUMP = 0.72
const SWEEPER_WARN_MS = 1200
const SWEEPER_REVERSE_EVERY_MS = 10_000
const SWEEPER_HIT_IMPULSE = 13.5
const SWEEPER_HIT_IMMUNE_MS = 420
const SWEEPER_SURVIVE_RATE = 9
const SWEEPER_ASSIST_POINTS = 60
const SWEEPER_ASSIST_WINDOW_MS = 1500
const TAIL_STEAL_MS = 800
const TAIL_SCORE_RATE = 15
const TAIL_FINISH_BONUS = 200
const TAIL_START_IMMUNE_MS = 2200
const TAIL_TRANSFER_IMMUNE_MS = 900

/**
 * 미니게임 11종 라이브러리. 개인전과 협동전을 중복 없이 번갈아 배치한다.
 * `mode`는 점수 계산 방식, `type`은 서버 판정·클라이언트 렌더 방식이다.
 */
const ROUND_LIBRARY = {
  banana: { id: 'banana', type: 'banana', mode: 'solo', title: '미끄덩 바나나 배달', short: '바나나를 들고 배달존으로!', duration: 75, target: 18 },
  pizza: { id: 'pizza', type: 'pizza', mode: 'coop', title: '피자 공장 대참사', short: '재료를 모아 초대형 피자를 완성!', duration: 90, target: 12 },
  crown: { id: 'crown', type: 'crown', mode: 'solo', title: '왕관 좀 빌려줘', short: '왕관을 오래 쓰고 도망쳐!', duration: 75, target: 0 },
  balloon: { id: 'balloon', type: 'balloon', mode: 'coop', title: '풍선탑을 지켜라', short: '풍선을 중앙 탑에 붙여라!', duration: 90, target: 16 },
  platform: { id: 'platform', type: 'platform', mode: 'solo', title: '우당탕 발판 축제', short: '안내 색 발판에서 살아남아!', duration: 75, target: 0 },
  hot_potato: { id: 'hot_potato', type: 'bomb', mode: 'solo', title: '💣 시한폭탄 넘기기', short: '폭탄을 남에게 넘겨라!', duration: ROUND_SECONDS, target: 0 },
  sweeper: { id: 'sweeper', type: 'sweeper', mode: 'solo', title: '🌪️ 빙글빙글 장애물 점프', short: '회전 막대를 점프로 넘어!', duration: ROUND_SECONDS, target: 0 },
  herd: { id: 'herd', type: 'herd', mode: 'solo', title: '말랑이 몰아넣기', short: '미니 말랑이 뒤로 돌아가 내 골대 쪽으로 몰아요!', duration: ROUND_SECONDS, target: 0 },
  pair_switch: { id: 'pair_switch', type: 'switch', mode: 'coop', title: '짝꿍 동시 스위치', short: '짝꿍과 각자의 발판을 동시에 밟아요!', duration: 75, target: 0 },
  vault_delivery: { id: 'vault_delivery', type: 'vault', mode: 'coop', title: '장애물 뚫고 금고 배달', short: '두 명이 잡기로 금고를 들고 황금 배달존까지 옮겨요!', duration: 90, target: 1 },
  tail_tag: { id: 'tail_tag', type: 'tail', mode: 'solo', title: '🎯 꼬리 뺏기', short: '꼬리를 지키고 남의 꼬리를 뺏어라!', duration: ROUND_SECONDS, target: 0 },
}
const SOLO_POOL = Object.values(ROUND_LIBRARY).filter(round => round.mode === 'solo')
const COOP_POOL = Object.values(ROUND_LIBRARY).filter(round => round.mode === 'coop')
// 테스트·수동 검증용 고정 순서(MM_START_ROUND가 지정된 경우에만 사용).
const LEGACY_ORDER = ['banana', 'pizza', 'crown', 'balloon', 'platform']

const shuffle = list => {
  const copy = [...list]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}
function makeRoundPlan(roundCount = 5) {
  const pinned = String(process.env.MM_ROUND_IDS || '').split(',').map(v => v.trim()).filter(Boolean)
  if (pinned.length) {
    const picked = [...new Set(pinned)]
      .filter(id => Object.hasOwn(ROUND_LIBRARY, id))
      .slice(0, roundCount)
      .map(id => ROUND_LIBRARY[id])
    if (picked.length) return picked
  }
  if (ENV_START_ROUND > 0) return LEGACY_ORDER.slice(0, roundCount).map(id => ROUND_LIBRARY[id])
  const solo = shuffle(SOLO_POOL).slice(0, 3)
  const coop = shuffle(COOP_POOL).slice(0, 2)
  return [solo[0], coop[0], solo[1], coop[1], solo[2]].slice(0, roundCount)
}
const SOLO_POINTS = [1000, 800, 650, 500, 400, 300, 200, 100]
const COLORS = ['#ff5d8f', '#57c7ff', '#a877ff', '#62e8aa', '#ffbd4a', '#ff7b68', '#61e0d1', '#f28dff']
const COLOR_NAMES = ['딸기', '소다', '포도', '민트', '레몬', '복숭아', '아쿠아', '라벤더']
const PLATFORM_COLORS = ['#ff5d8f', '#57c7ff', '#a877ff', '#62e8aa', '#ffbd4a', '#ff7b68']

const clamp = (n, min, max) => Math.max(min, Math.min(max, n))
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z)
const angleGap = (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return Math.abs(d) }
const awayFrom = (from, threat, distance) => {
  const dx = from.x - threat.x, dz = from.z - threat.z
  const length = Math.hypot(dx, dz) || 1
  const x = clamp(from.x + (dx / length) * distance, -WORLD_RADIUS + 1.2, WORLD_RADIUS - 1.2)
  const z = clamp(from.z + (dz / length) * distance, -WORLD_RADIUS + 1.2, WORLD_RADIUS - 1.2)
  return { x, z }
}
const sweepersNear = (player, sweeper) => {
  const radius = Math.hypot(player.x, player.z)
  if (radius < 0.6 || radius > sweeper.radius) return false
  return angleGap(Math.atan2(player.z, player.x), sweeper.angle) < 0.9
}
const cleanName = value => String(value || '말랑이').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 14) || '말랑이'
const cleanCode = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
const token = () => randomBytes(18).toString('base64url')
const makeCode = () => randomBytes(4).toString('hex').slice(0, 6).toUpperCase()
const spawnFor = seat => {
  const i = Math.max(0, seat - 1)
  const angle = (i / 8) * Math.PI * 2
  return { x: Math.cos(angle) * 5.6, z: Math.sin(angle) * 5.6 }
}
const emptyStats = () => ({ bonkHits: 0, tackleHits: 0, hugHits: 0, headbuttHits: 0, falls: 0, respawns: 0, bananaSlips: 0, jellySoaks: 0, shockwaves: 0, reverses: 0, deliveries: 0, grabs: 0, throws: 0, megaDuo: 0, megaSolo: 0, megaJoins: 0, tetherYanks: 0, bombPasses: 0, bombBooms: 0, sweeperHits: 0, sweeperAssists: 0, tailSteals: 0, tailTime: 0 })
const AWARD_TAGLINES = {
  prankster: '오늘 가장 많은 장난을 성공시켰어요.',
  tumbler: '넘어지고 떨어져도 계속 웃겼어요.',
  partner: '고무줄로 묶인 채 황금 소품을 함께 날랐어요.',
  slippery: '바나나 껍질과 젤리를 가장 많이 밟았어요.',
  wobbler: '짝꿍과 박자 안 맞춰 고무줄을 팽팽 당겼어요.',
  carrier: '무거운 황금 소품을 끝까지 배달했어요.',
  champion: '오늘의 최고 점수 주인공이에요.',
  busy: '배달과 목표 수행을 가장 부지런히 했어요.',
  bombPasser: '폭탄을 남에게 넘기는 손재주가 최고였어요.',
  tailThief: '남의 꼬리를 가장 많이 낚아챘어요.',
  sweeperAce: '상대를 회전 막대 앞으로 밀어 넣는 데 성공했어요.',
}
const awardTagline = award => AWARD_TAGLINES[award.kind] || '오늘의 활약을 기억할게요.'
const playerSnapshot = (p, viewerId = '', tails = []) => ({
  id: p.id, seat: p.seat, name: p.name, color: p.color, colorName: p.colorName, bot: !!p.isBot,
  connected: !!p.isBot || !!p.socket?.connected, ready: p.ready, host: p.host,
  x: Number(p.x.toFixed(3)), z: Number(p.z.toFixed(3)), vx: Number(p.vx.toFixed(3)), vz: Number(p.vz.toFixed(3)),
  jumpY: Number(p.jumpY.toFixed(3)), carried: p.carried, score: p.score, soloScore: p.soloScore,
  contribution: p.contribution, roundScore: p.roundScore, falls: p.falls,
  prankCount: p.prankCount, prankSuccesses: p.prankSuccesses,
  prankCooldown: Math.max(0, (p.cooldowns[p.lastPrankType || 'headbutt'] || 0) - Date.now()),
  cooldowns: Object.fromEntries(Object.keys(ACTION_COOLDOWN_MS).map(key => [key, Math.max(0, (p.cooldowns[key] || 0) - Date.now())])),
  secretMission: p.id === viewerId && p.secretMission ? { ...p.secretMission } : undefined,
  missionProgress: p.id === viewerId ? p.missionProgress : 0,
  missionComplete: p.id === viewerId ? p.missionComplete : false,
  grabbedBy: p.grabbedBy || '',
  hasTail: tails.includes(p.id),
  stealCooldown: Math.max(0, p.stealCooldownUntil - Date.now()),
  partnerId: p.partnerId || '', respawning: !!p.respawning, respawnIn: Math.max(0, p.respawnAt - Date.now()), respawns: p.respawns,
  megaDeliveries: p.megaDeliveries, megaDuo: p.stats.megaDuo, megaSolo: p.stats.megaSolo, tetherYanks: p.stats.tetherYanks,
  action: p.motionUntil > Date.now() ? p.motion : 'Idle', status: { slip: Math.max(0, p.slipUntil - Date.now()), slow: Math.max(0, p.slowUntil - Date.now()), ink: Math.max(0, p.inkUntil - Date.now()), reverse: Math.max(0, p.reverseUntil - Date.now()), sticky: Math.max(0, p.stickyUntil - Date.now()), stagger: Math.max(0, p.staggerUntil - Date.now()), knockdown: Math.max(0, p.knockdownUntil - Date.now()), hug: Math.max(0, p.hugUntil - Date.now()), spin: Number(p.spin.toFixed(3)), immune: Math.max(0, p.prankImmuneUntil - Date.now()) },
})

const newPlayerInput = () => ({ x: 0, z: 0, jump: false, interact: false, prank: false, prankType: 'headbutt' })

function newPlayer(id, seat, name, colorIndex, isBot = false, botDifficulty = 'normal') {
  const spawn = spawnFor(seat)
  return {
    id, seat, name: cleanName(name), isBot, botDifficulty, nextAiAt: 0, colorIndex: Number.isInteger(colorIndex) && colorIndex >= 0 && colorIndex < COLORS.length ? colorIndex : (seat - 1) % COLORS.length,
    color: COLORS[Number.isInteger(colorIndex) && colorIndex >= 0 && colorIndex < COLORS.length ? colorIndex : (seat - 1) % COLORS.length],
    colorName: COLOR_NAMES[(Number.isInteger(colorIndex) && colorIndex >= 0 && colorIndex < COLORS.length ? colorIndex : (seat - 1) % COLORS.length)],
    token: token(), socket: null, disconnectedAt: 0, host: false, ready: false,
    x: spawn.x, z: spawn.z, vx: 0, vz: 0, jumpY: 0, jumpV: 0,
    input: newPlayerInput(), lastInputAt: 0, jumpBufferUntil: 0, coyoteUntil: 0,
    carried: '', score: 0, soloScore: 0, contribution: 0, roundScore: 0, falls: 0,
    crownTime: 0, roundAlive: true, prankCount: 0, prankSuccesses: 0, cooldowns: { headbutt: 0, bonk: 0, tackle: 0, hug: 0, grab: 0, jump: 0, item: 0 }, lastPrankType: 'headbutt',
    slipUntil: 0, slowUntil: 0, inkUntil: 0, reverseUntil: 0, stickyUntil: 0, staggerUntil: 0, knockdownUntil: 0, hugUntil: 0, prankImmuneUntil: 0, spin: 0, motion: 'Idle', motionUntil: 0,
    secretMission: null, missionProgress: 0, missionComplete: false, lastBonkTargetId: '', grabbedBy: '', grabTargetId: '', grabUntil: 0, grabCooldownUntil: 0, escapePresses: 0,
    partnerId: '', respawning: false, respawnAt: 0, respawnReason: '', respawns: 0, megaDeliveries: 0, megaCarryTime: 0, lastTetherAt: 0,
    stealCooldownUntil: 0, tailImmuneUntil: 0, lastPrankedAt: 0, lastPrankedBy: '', tailTime: 0, sweeperHitAt: 0,
    stats: emptyStats(), roundStats: emptyStats(),
  }
}

const PRACTICE_RADIUS = 8
const PRACTICE_DUMMY_ID = 'practice-dummy'
const PRACTICE_DUMMY_SPAWN = { x: -5, z: 4 }
const practiceItems = () => [
  { id: 'practice-banana', type: 'banana_peel', x: -5, z: 0, consumed: false, respawnAt: 0 },
  { id: 'practice-jelly', type: 'jelly_pool', x: -5, z: -4, consumed: false, respawnAt: 0 },
]
function practiceDummy() {
  return { ...newPlayer(PRACTICE_DUMMY_ID, 0, '연습용 말랑이', 4, true), ...PRACTICE_DUMMY_SPAWN }
}

class Room {
  constructor(code) {
    this.code = code
    this.createdAt = Date.now()
    this.lastActivity = Date.now()
    this.players = new Map()
    this.hostId = ''
    this.phase = 'lobby'
    this.roundIndex = -1
    this.phaseEndsAt = 0
    this.roundStartedAt = 0
    this.round = null
    this.roundResult = null
    this.pairs = []
    this.eventId = 0
    this.event = null
    this.lastBroadcast = 0
    this.targetColor = PLATFORM_COLORS[0]
    this.platforms = []
    this.objects = {}
    this.pairs = []
    this.roundCount = 5
    this.botCount = null
    this.botDifficulty = 'normal'
    this.plan = makeRoundPlan(this.roundCount)
    this.resetPractice()
  }
  resetPractice() {
    this.practiceDummy = practiceDummy()
    this.practiceItems = practiceItems()
  }
  actionTargets() {
    const players = this.connected()
    if (this.phase === 'lobby') players.push(this.practiceDummy)
    return players
  }
  bump(player, key, amount = 1) { if (this.phase === 'lobby') return; player.stats[key] = (player.stats[key] || 0) + amount; player.roundStats[key] = (player.roundStats[key] || 0) + amount }
  partnerOf(player) { return player.partnerId ? this.players.get(player.partnerId) || null : null }
  /** 협동(짝꿍) 라운드에서 좌석 순서대로 2명씩 고무줄로 묶는다. 홀수면 마지막 한 명은 혼자 뛴다. */
  assignPairs() {
    this.pairs = []
    for (const p of this.players.values()) p.partnerId = ''
    if (this.definition?.mode !== 'coop') return
    const lineup = this.connected().sort((a, b) => a.seat - b.seat)
    for (let i = 0; i + 1 < lineup.length; i += 2) {
      const a = lineup[i], b = lineup[i + 1]
      a.partnerId = b.id; b.partnerId = a.id
      this.pairs.push({ a: a.id, b: b.id, length: dist(a, b), tension: 0, wobbleUntil: 0 })
    }
  }

  get definition() { return this.roundIndex >= 0 ? this.plan[this.roundIndex] || null : null }
  connected() { return [...this.players.values()].filter(p => p.isBot || p.socket?.connected) }
  humans() { return [...this.players.values()].filter(p => !p.isBot && p.socket?.connected) }
  allPlayers() { return [...this.players.values()] }
  broadcast(name = 'state', extra = {}) {
    for (const p of this.players.values()) p.socket?.emit(name, this.snapshot(extra, p.id))
    this.lastBroadcast = Date.now()
  }
  emitEvent(type, text, data = {}) {
    this.event = { id: ++this.eventId, type, text, ...data }
    this.broadcast('event', this.event)
  }
  findByToken(resumeToken) { return resumeToken ? this.allPlayers().find(p => p.token === resumeToken) : null }
  attach(socket, data) {
    const resumeToken = String(data.resumeToken || '')
    let player = this.findByToken(resumeToken)
    if (player && player.disconnectedAt && Date.now() - player.disconnectedAt <= RECONNECT_GRACE_MS) {
      player.socket?.disconnect(true)
      player.socket = socket
      player.disconnectedAt = 0
      if (!this.hostId) { player.host = true; this.hostId = player.id }
      player.input = { x: 0, z: 0, jump: false, interact: false, prank: false, prankType: 'headbutt' }
      socket.data.room = this.code
      socket.data.playerId = player.id
      socket.emit('welcome', { marker: MARKER, code: this.code, resumeToken: player.token, player: playerSnapshot(player, player.id, this.round?.tails || []), resumed: true })
      this.broadcast()
      return player
    }
    if (this.players.size >= MAX_PLAYERS) {
      socket.emit('room_error', { code: 'full', message: '방이 가득 찼어요.' })
      return null
    }
    const id = socket.id
    const seat = this.availableSeat()
    player = newPlayer(id, seat, data.name, Number(data.colorIndex))
    player.host = !this.hostId
    if (player.host) {
      this.hostId = player.id
      this.configure(player, data.matchSettings)
    }
    player.socket = socket
    this.players.set(player.id, player)
    socket.data.room = this.code
    socket.data.playerId = player.id
    socket.emit('welcome', { marker: MARKER, code: this.code, resumeToken: player.token, player: playerSnapshot(player, player.id), resumed: false })
    this.emitEvent('join', `${player.name}님이 입장했어요!`)
    this.broadcast()
    return player
  }
  detach(socket) {
    const p = this.players.get(socket.data.playerId)
    if (!p || p.socket !== socket) return
    p.socket = null
    if (this.round?.type === 'vault') this.releaseMega(p)
    p.disconnectedAt = Date.now()
    p.ready = false
    if (p.host) {
      p.host = false
      const next = this.humans()[0]
      if (next) { next.host = true; this.hostId = next.id; this.emitEvent('host', `${next.name}님이 새 방장이에요.`) }
      else this.hostId = ''
    }
    if (this.phase !== 'lobby' && this.humans().length === 0) this.setLobby('접속한 플레이어가 없어요.')
    this.broadcast()
  }
  setLobby(reason = '') {
    this.phase = 'lobby'; this.roundIndex = -1; this.phaseEndsAt = 0; this.round = null; this.roundResult = null
    // 대기실에서 본 라운드 순서가 그대로 경기에 쓰이도록, 새 매치 준비 시점에 한 번만 뽑는다.
    this.plan = makeRoundPlan(this.roundCount)
    this.resetPractice()
    for (const [id, p] of this.players) if (p.isBot) this.players.delete(id)
    this.pairs = []
    this.platforms = []
    for (const p of this.players.values()) { p.ready = false; p.score = 0; p.soloScore = 0; p.contribution = 0; p.roundScore = 0; p.carried = ''; p.falls = 0; p.prankCount = 0; p.prankSuccesses = 0; p.cooldowns = { headbutt: 0, bonk: 0, tackle: 0, hug: 0, grab: 0, jump: 0, item: 0 }; p.secretMission = null; p.missionProgress = 0; p.missionComplete = false; p.grabbedBy = ''; p.grabTargetId = ''; p.partnerId = ''; p.respawning = false; p.respawnAt = 0; p.respawns = 0; p.megaDeliveries = 0; p.stats = emptyStats() }
    for (const p of this.players.values()) {
      Object.assign(p, spawnFor(p.seat), {
        vx: 0, vz: 0, jumpY: 0, jumpV: 0, jumpBufferUntil: 0, coyoteUntil: 0,
        input: newPlayerInput(), slipUntil: 0, slowUntil: 0, inkUntil: 0, reverseUntil: 0,
        stickyUntil: 0, staggerUntil: 0, knockdownUntil: 0, hugUntil: 0,
        prankImmuneUntil: 0, spin: 0, motion: 'Idle', motionUntil: 0,
      })
    }
    if (reason) this.emitEvent('lobby', reason)
  }
  toggleReady(player) {
    if (this.phase !== 'lobby') return
    player.ready = !player.ready
    this.emitEvent('ready', `${player.name}님이 ${player.ready ? '준비 완료' : '준비 취소'}!`)
    this.broadcast()
  }
  availableSeat() {
    const used = new Set(this.allPlayers().map(player => player.seat))
    for (let seat = 1; seat <= MAX_PLAYERS; seat++) if (!used.has(seat)) return seat
  }
  configure(player, settings) {
    if (this.phase !== 'lobby' || player.id !== this.hostId || !settings) return
    const { roundCount, botCount } = settings
    if ((roundCount === 3 || roundCount === 5) && roundCount !== this.roundCount) {
      this.roundCount = roundCount
      this.plan = makeRoundPlan(roundCount)
    }
    if (Number.isInteger(botCount) && botCount >= 2 && botCount <= 5) this.botCount = botCount
  }
  start(player, difficulty = this.botDifficulty) {
    if (this.phase !== 'lobby' || player.id !== this.hostId || this.humans().length < 1) return false
    this.botDifficulty = ['easy', 'normal', 'hard'].includes(difficulty) ? difficulty : 'normal'
    const legacyCount = this.botDifficulty === 'easy' ? 1 : this.botDifficulty === 'hard' ? 3 : 2
    const requested = this.botCount ?? (this.humans().length === 1 ? legacyCount : 0)
    const count = Math.min(requested, MAX_PLAYERS - this.players.size)
    if (count > 0) this.addBots(count, this.botDifficulty)
    for (const p of this.players.values()) { p.stats = emptyStats(); p.roundStats = emptyStats(); p.respawns = 0; p.megaDeliveries = 0; p.falls = 0; p.prankSuccesses = 0; p.prankCount = 0 }
    this.roundIndex = ENV_START_ROUND >= 0 && ENV_START_ROUND < this.plan.length ? ENV_START_ROUND : 0
    this.startCountdown(true)
    return true
  }
  addBots(count, difficulty) {
    for (let i = 0; i < count; i++) {
      const seat = this.availableSeat()
      const bot = newPlayer(`bot-${this.code}-${i + 1}`, seat, `말랑봇${i + 1}`, (seat - 1) % COLORS.length, true, difficulty)
      bot.ready = true
      this.players.set(bot.id, bot)
    }
    this.emitEvent('bots', `${count}명의 말랑봇이 참가했어요!`)
  }
  startCountdown(opening = false) {
    const def = this.definition
    for (const p of this.players.values()) {
      Object.assign(p, spawnFor(p.seat), { vx: 0, vz: 0, jumpY: 0, jumpV: 0, jumpBufferUntil: 0, coyoteUntil: 0, lastPrankedAt: 0, lastPrankedBy: '' })
    }
    this.phase = 'countdown'
    this.roundResult = null
    this.intro = { openingMs: opening ? OPENING_MS : 0, roundMs: COUNTDOWN_MS }
    this.phaseEndsAt = Date.now() + this.intro.openingMs + this.intro.roundMs
    this.roundStartedAt = 0
    for (const p of this.players.values()) { p.roundScore = 0; p.contribution = 0; p.crownTime = 0; p.carried = ''; p.roundAlive = true; p.roundStats = emptyStats(); p.partnerId = ''; p.respawning = false; p.respawnAt = 0; p.respawnReason = ''; p.cooldowns = { headbutt: 0, bonk: 0, tackle: 0, hug: 0, grab: 0, jump: 0, item: 0 }; p.input = { x: 0, z: 0, jump: false, interact: false, prank: false, prankType: 'headbutt' }; p.slipUntil = 0; p.slowUntil = 0; p.inkUntil = 0; p.reverseUntil = 0; p.stickyUntil = 0; p.staggerUntil = 0; p.knockdownUntil = 0; p.hugUntil = 0; p.prankImmuneUntil = 0; p.spin = 0; p.motion = 'Idle'; p.motionUntil = 0; p.grabbedBy = ''; p.grabTargetId = ''; p.grabUntil = 0; p.escapePresses = 0; p.missionProgress = 0; p.missionComplete = false; p.lastBonkTargetId = '' }
    this.assignPairs()
    this.round = this.buildRound(def)
    if (def.type === 'bomb') this.assignBomb(null, null)
    if (def.type === 'tail') this.assignTails(null)
    if (def.type === 'pizza' || def.type === 'balloon') this.round.mega = { id: MEGA_ID, kind: def.type === 'pizza' ? 'golden_pizza' : 'golden_trophy', name: def.type === 'pizza' ? '초대형 황금 피자' : '황금 트로피', x: MEGA_SPAWN.x, z: MEGA_SPAWN.z, carriers: [], delivered: false, deliveredAt: 0, zone: { ...MEGA_ZONE }, wobbleUntil: 0 }
    if (def.type === 'vault') {
      this.round.mega = { id: MEGA_ID, kind: 'golden_vault', name: '황금 금고', ...MEGA_SPAWN, carriers: [], delivered: false, deliveredAt: 0, zone: { ...MEGA_ZONE }, wobbleUntil: 0 }
    }
    for (const p of this.players.values()) { const card = SECRET_MISSIONS[(p.seat - 1 + this.roundIndex) % SECRET_MISSIONS.length]; p.secretMission = { ...card } }
    const pairLine = this.pairs.length ? ` · 고무줄 짝꿍 ${this.pairs.length}쌍` : ''
    this.emitEvent('round_intro', `${def.title} — ${def.short}${pairLine}`, { roundIndex: this.roundIndex, definition: def, plan: this.plan.map(entry => entry.id), pairs: this.pairs.map(pair => [pair.a, pair.b]) })
    this.broadcast()
  }
  buildRound(def) {
    this.targetColor = PLATFORM_COLORS[Math.floor(Math.random() * PLATFORM_COLORS.length)]
    this.platforms = [
      { x: -5.4, z: -3.4, color: PLATFORM_COLORS[0] }, { x: 0, z: -4.8, color: PLATFORM_COLORS[1] }, { x: 5.4, z: -3.4, color: PLATFORM_COLORS[2] },
      { x: -5.4, z: 3.4, color: PLATFORM_COLORS[3] }, { x: 0, z: 4.8, color: PLATFORM_COLORS[4] }, { x: 5.4, z: 3.4, color: PLATFORM_COLORS[5] },
    ]
    const around = (count, radius = 7) => Array.from({ length: count }, (_, i) => {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.18
      return { id: `${this.roundIndex}-${i}`, x: Math.cos(a) * radius, z: Math.sin(a) * radius, carriedBy: '', delivered: false }
    })
    const prankItems = Array.from({ length: PRANK_ITEM_COUNT }, (_, i) => { const a = (i / PRANK_ITEM_COUNT) * Math.PI * 2 + Math.random() * .4; return { id: `prank-${this.roundIndex}-${i}`, type: PRANK_TYPES[i % PRANK_TYPES.length], x: Math.cos(a) * (4 + Math.random() * 4), z: Math.sin(a) * (4 + Math.random() * 4), consumed: false, spawnedAt: Date.now(), respawnAt: 0 } })
    if (def.type === 'herd') return { ...createHerd(this.connected()), prankItems }
    if (def.type === 'switch') return { ...createSwitch(this.pairs), prankItems: [] }
    if (def.type === 'vault') return { ...createVault(), prankItems: [] }
    if (def.type === 'banana') return { type: 'banana', bananas: around(18, 6.8), delivered: 0, delivery: { x: 0, z: -7 }, prankItems }
    if (def.type === 'pizza') return { type: 'pizza', ingredients: Array.from({ length: 12 }, (_, i) => ({ id: `${i}`, kind: ['dough', 'sauce', 'cheese', 'pepperoni'][i % 4], x: Math.cos(i) * 7, z: Math.sin(i) * 7, carriedBy: '', delivered: false })), delivered: 0, total: 12, station: { x: 0, z: 0 }, prankItems }
    if (def.type === 'crown') return { type: 'crown', crown: { x: 0, z: 0, owner: '' }, prankItems }
    if (def.type === 'balloon') return { type: 'balloon', balloons: around(16, 7), delivered: 0, tower: { x: 0, z: 0 }, prankItems }
    if (def.type === 'bomb') return { type: 'bomb', bomb: { holder: '', x: 0, z: 0, fuseEndsAt: 0, immuneUntil: 0, passCooldownUntil: 0, passes: 0, booms: 0 }, prankItems }
    if (def.type === 'sweeper') return { type: 'sweeper', sweeper: { angle: 0, speed: SWEEPER_BASE_SPEED, direction: 1, radius: SWEEPER_RADIUS, warnUntil: 0, reverseAt: Date.now() + SWEEPER_REVERSE_EVERY_MS, hits: 0 }, prankItems }
    if (def.type === 'tail') return { type: 'tail', tails: [], tailStolen: 0, prankItems }
    return { type: 'platform', platforms: this.platforms, targetColor: this.targetColor, pulseAt: Date.now() + 5000, prankItems }
  }
  beginPlay() {
    const now = Date.now()
    this.phase = 'play'; this.roundStartedAt = now; this.phaseEndsAt = now + (ENV_ROUND_MS > 0 ? ENV_ROUND_MS : this.definition.duration * 1000)
    for (const p of this.connected()) {
      p.x = spawnFor(p.seat).x; p.z = spawnFor(p.seat).z; p.vx = 0; p.vz = 0; p.roundAlive = true; p.respawning = false
      // 라운드가 새로 시작되면 이전 라운드의 쿨타임이 남아 입력을 막지 않게 한다.
      p.cooldowns = { headbutt: 0, bonk: 0, tackle: 0, hug: 0, grab: 0, jump: 0, item: 0 }
      p.grabCooldownUntil = 0
      p.stealCooldownUntil = 0
      p.input = { x: 0, z: 0, jump: false, interact: false, prank: false, prankType: p.input.prankType || 'headbutt' }
    }
    if (this.round?.type === 'bomb') {
      const firstHolder = this.connected().find(p => p.id === this.round.bomb.holder)
      this.assignBomb(null, now, firstHolder)
    }
    if (this.round?.type === 'platform') this.round.pulseAt = now + 5000
    if (this.round?.type === 'tail') this.assignTails(now)
    if (this.round?.type === 'sweeper') { this.round.sweeper.angle = 0; this.round.sweeper.reverseAt = now + SWEEPER_REVERSE_EVERY_MS }
    this.emitEvent('round_start', '출발!')
    this.broadcast()
  }
  /** 시한폭탄: 무작위 생존자에게 새 폭탄을 쥐여 준다(방금 터진 사람은 제외). */
  assignBomb(excludeId, now = Date.now(), firstHolder) {
    const bomb = this.round?.bomb
    if (!bomb) return null
    const pool = this.connected().filter(p => !p.respawning && p.id !== excludeId)
    const holder = firstHolder ?? pool[Math.floor(Math.random() * pool.length)] ?? null
    bomb.holder = holder?.id || ''
    bomb.x = holder?.x || 0
    bomb.z = holder?.z || 0
    bomb.fuseEndsAt = now === null ? 0 : now + BOMB_FUSE_MS
    bomb.immuneUntil = now === null ? 0 : now + BOMB_PASS_IMMUNE_MS
    bomb.passCooldownUntil = 0
    if (holder && now !== null) this.emitEvent('bomb_pick', `${holder.name}님이 폭탄을 받았다! ${Math.round(BOMB_FUSE_MS / 1000)}초 안에 넘겨라!`, { playerId: holder.id, x: holder.x, z: holder.z, fuse: BOMB_FUSE_MS })
    return holder
  }
  /** 꼬리 뺏기: 절반(올림)의 플레이어에게 눈에 띄는 꼬리를 달아 준다. */
  assignTails(now) {
    const round = this.round
    if (!round) return
    const players = this.connected().sort((a, b) => a.seat - b.seat)
    const count = Math.max(1, Math.ceil(players.length / 2))
    const preview = round.tails.map(id => players.find(player => player.id === id)).filter(Boolean)
    const picked = preview.length === count ? preview : shuffle(players).slice(0, count)
    // 사람만 있는 방에서 봇이 꼬리를 독차지하면 재미가 없으니, 사람 1명은 반드시 꼬리를 받는다.
    const humans = picked.filter(player => !player.isBot)
    if (!humans.length && count >= 1) {
      const human = players.find(player => !player.isBot)
      if (human) { picked[0] = human }
    }
    round.tails = picked.map(player => player.id)
    round.tailStolen = 0
    if (now === null) return
    // 꼬리를 받자마자 바로 뺏기지 않도록 2초 보호.
    for (const player of picked) player.tailImmuneUntil = now + TAIL_START_IMMUNE_MS
    this.emitEvent('tail_start', `꼬리 ${count}개 배정! 꼬리를 뺏고 지켜라!`, { tails: round.tails.map(id => this.players.get(id)?.name).filter(Boolean) })
  }
  hasTail(player) { return Boolean(this.round?.tails?.includes(player.id)) }
  giveTail(player) {
    if (!this.round || this.hasTail(player)) return
    this.round.tails.push(player.id)
  }
  takeTail(player) {
    if (!this.round) return false
    const had = this.hasTail(player)
    this.round.tails = this.round.tails.filter(id => id !== player.id)
    return had
  }
  /** 폭탄을 상대에게 넘긴다(넘김 무적 0.6초로 즉시 되넘김 방지). */
  passBomb(from, to, now = Date.now()) {
    const bomb = this.round?.bomb
    if (!bomb || bomb.holder !== from.id || !to || to.id === from.id || to.respawning) return false
    if (now < bomb.immuneUntil || now < bomb.passCooldownUntil) return false
    bomb.holder = to.id
    bomb.x = to.x
    bomb.z = to.z
    bomb.immuneUntil = now + BOMB_PASS_IMMUNE_MS
    bomb.passCooldownUntil = now + BOMB_PASS_COOLDOWN_MS
    bomb.passes++
    from.roundScore += BOMB_PASS_POINTS
    from.prankSuccesses++
    this.bump(from, 'bombPasses')
    this.emitEvent('bomb_pass', `${from.name}님이 ${to.name}님에게 폭탄을 넘겼다! +${BOMB_PASS_POINTS}P`, { fromId: from.id, toId: to.id, x: to.x, z: to.z, itemType: 'bomb' })
    return true
  }
  explodeBomb(now) {
    const bomb = this.round?.bomb
    if (!bomb) return
    const holder = this.players.get(bomb.holder)
    if (!holder) { this.assignBomb(null, now); return }
    const survivors = this.connected().filter(p => p.id !== holder.id && !p.respawning)
    for (const survivor of survivors) {
      survivor.roundScore += BOMB_SURVIVE_POINTS
      this.bump(survivor, 'bombBooms')
    }
    this.bump(holder, 'falls')
    this.emitEvent('bomb_boom', `${holder.name}님 폭발! 주변 생존자 ${survivors.length}명 +${BOMB_SURVIVE_POINTS}P`, { playerId: holder.id, x: holder.x, z: holder.z, itemType: 'bomb', countdown: RESPAWN_COUNTDOWN_MS })
    holder.vx = 0; holder.vz = 0
    this.startRespawn(holder, 'boom')
    this.assignBomb(holder.id, now + RESPAWN_COUNTDOWN_MS)
  }
  finishRound() {
    if (this.phase !== 'play') return
    const def = this.definition
    // 꼬리 뺏기: 라운드 종료 시점에 꼬리를 지키고 있던 사람에게 보유 보너스.
    if (this.round?.type === 'tail') {
      for (const id of this.round.tails) {
        const owner = this.players.get(id)
        if (!owner) continue
        owner.roundScore += TAIL_FINISH_BONUS
      }
      const keepers = this.round.tails.map(id => this.players.get(id)?.name).filter(Boolean)
      if (keepers.length) this.emitEvent('tail_bonus', `꼬리 보유 보너스 +${TAIL_FINISH_BONUS}P — ${keepers.join('·')}`, { itemType: 'tail', bonus: TAIL_FINISH_BONUS })
    }
    const results = this.allPlayers().map(p => ({ id: p.id, name: p.name, seat: p.seat, color: p.color, roundScore: p.roundScore, contribution: p.contribution, points: 0, total: p.score }))
    if (def.mode === 'solo') {
      const order = [...this.allPlayers()].sort((a, b) => b.roundScore - a.roundScore || a.seat - b.seat)
      order.forEach((p, index) => { const points = SOLO_POINTS[index] || 0; p.score += points; p.soloScore += points; results.find(r => r.id === p.id).points = points; results.find(r => r.id === p.id).total = p.score })
    } else {
      const progress = this.progressValue()
      const shared = Math.round(clamp(progress, 0, 1) * 600)
      const contributionTotal = this.allPlayers().reduce((n, p) => n + p.contribution, 0)
      for (const p of this.allPlayers()) {
        const personal = contributionTotal ? Math.round(clamp(p.contribution / contributionTotal, 0, 1) * 400) : 0
        const points = shared + personal
        p.score += points
        const r = results.find(row => row.id === p.id)
        r.points = points; r.total = p.score
      }
    }
    const firstId = [...this.allPlayers()].sort((a, b) => b.roundScore - a.roundScore || a.seat - b.seat)[0]?.id
    for (const p of this.allPlayers()) {
      const m = p.secretMission
      p.missionComplete = Boolean(m && (m.kind === 'bonk_winner' ? p.lastBonkTargetId === firstId : p.missionProgress >= m.target))
      const bonus = p.missionComplete ? 250 : 0
      p.score += bonus
      const r = results.find(row => row.id === p.id)
      if (r) { r.points += bonus; r.total = p.score; r.missionComplete = p.missionComplete; r.missionText = m?.text || '' }
    }
    results.sort((a, b) =>
      b.total - a.total || this.players.get(b.id).soloScore - this.players.get(a.id).soloScore || a.seat - b.seat)
    this.roundResult = { roundIndex: this.roundIndex, title: def.title, mode: def.mode, results, progress: this.progressValue(), recap: this.roundRecap(), pairs: this.pairs.map(pair => ({ a: pair.a, b: pair.b })) }
    for (const p of this.players.values()) p.respawning = false
    this.phase = 'result'; this.phaseEndsAt = Date.now() + RESULT_MS
    this.emitEvent('round_result', `${def.title} 결과가 나왔어요!`, { result: this.roundResult })
    this.broadcast()
  }
  /** 라운드 결과 화면에 붙는 실제 수치 하이라이트 2~3개. */
  roundRecap() {
    const players = this.allPlayers()
    const recap = []
    const mvp = [...players].sort((a, b) => b.roundScore - a.roundScore || a.seat - b.seat)[0]
    if (mvp) recap.push({ label: '라운드 MVP', name: mvp.name, value: `${Math.round(mvp.roundScore)}점` })
    const tumbler = [...players].sort((a, b) => (b.roundStats.respawns || 0) - (a.roundStats.respawns || 0))[0]
    if (tumbler && tumbler.roundStats.respawns > 0) recap.push({ label: '몸개그 담당', name: tumbler.name, value: `리스폰 ${tumbler.roundStats.respawns}회` })
    const duo = [...players].sort((a, b) => (b.roundStats.megaDuo || 0) - (a.roundStats.megaDuo || 0))[0]
    if (duo && duo.roundStats.megaDuo > 0) recap.push({ label: '찰떡 합동 운반', name: duo.name, value: `${duo.roundStats.megaDuo}회 성공` })
    const yanker = [...players].sort((a, b) => (b.roundStats.tetherYanks || 0) - (a.roundStats.tetherYanks || 0))[0]
    if (yanker && yanker.roundStats.tetherYanks > 0 && recap.length < 3) recap.push({ label: '고무줄 팽!', name: yanker.name, value: `${yanker.roundStats.tetherYanks}회` })
    const passer = [...players].sort((a, b) => (b.roundStats.bombPasses || 0) - (a.roundStats.bombPasses || 0))[0]
    if (passer && passer.roundStats.bombPasses > 0 && recap.length < 3) recap.push({ label: '폭탄 배구', name: passer.name, value: `${passer.roundStats.bombPasses}회 넘김` })
    const thief = [...players].sort((a, b) => (b.roundStats.tailSteals || 0) - (a.roundStats.tailSteals || 0))[0]
    if (thief && thief.roundStats.tailSteals > 0 && recap.length < 3) recap.push({ label: '꼬리 도둑', name: thief.name, value: `${thief.roundStats.tailSteals}회 강탈` })
    const sweeper = [...players].sort((a, b) => (b.roundStats.sweeperAssists || 0) - (a.roundStats.sweeperAssists || 0))[0]
    if (sweeper && sweeper.roundStats.sweeperAssists > 0 && recap.length < 3) recap.push({ label: '스위퍼 콤보', name: sweeper.name, value: `${sweeper.roundStats.sweeperAssists}회 밀어넣기` })
    return recap.slice(0, 3)
  }
  progressValue() {
    if (!this.round) return 0
    if (this.round.type === 'banana' || this.round.type === 'balloon') return this.round.delivered / this.definition.target
    if (['pizza', 'switch', 'vault'].includes(this.round.type)) return this.round.delivered / Math.max(1, this.round.total)
    return 1
  }
  finalise() {
    const sorted = this.allPlayers().sort((a, b) => b.score - a.score || b.soloScore - a.soloScore || a.seat - b.seat)
    const top = sorted[0]
    const winners = top ? sorted.filter(p => p.score === top.score && p.soloScore === top.soloScore).map(p => p.id) : []
    this.phase = 'final'; this.phaseEndsAt = 0
    const prankster = [...this.allPlayers()].sort((a, b) => b.prankSuccesses - a.prankSuccesses || b.prankCount - a.prankCount)[0]
    const awards = this.awardBoard(sorted)
    const megas = this.allPlayers().reduce((acc, p) => { acc.duo += p.stats.megaDuo; acc.solo += p.stats.megaSolo; return acc }, { duo: 0, solo: 0 })
    this.roundResult = {
      winners,
      rankings: sorted.map((p, i) => ({ rank: i + 1, id: p.id, name: p.name, color: p.color, score: p.score, soloScore: p.soloScore, prankSuccesses: p.prankSuccesses, respawns: p.respawns, falls: p.falls, megaDuo: p.stats.megaDuo, megaSolo: p.stats.megaSolo, partnerId: p.partnerId || '' })),
      bestPrankster: prankster ? { id: prankster.id, name: prankster.name, prankSuccesses: prankster.prankSuccesses } : null,
      awards,
      highlights: this.highlightLines(sorted, megas),
      megaTotals: megas,
    }
    this.emitEvent('final', top ? `${top.name}님, 말랑 챔피언!` : '공동 우승!')
    this.broadcast()
  }
  /**
   * 대환장 어워드 — 모든 타이틀은 서버가 집계한 실제 수치에서만 나온다.
   * 활동이 부족한 항목은 후보에서 빠지고, 최소 2개 · 최대 4개를 돌려준다.
   */
  awardBoard(sorted) {
    const players = this.allPlayers()
    const best = (list, score) => list.reduce((top, p) => (!top || score(p) > score(top) ? p : top), null)
    const teams = this.pairs.map(pair => {
      const a = this.players.get(pair.a), b = this.players.get(pair.b)
      if (!a || !b) return null
      return { a, b, duo: a.stats.megaDuo + b.stats.megaDuo, score: a.score + b.score, respawns: a.respawns + b.respawns, yanks: a.stats.tetherYanks + b.stats.tetherYanks }
    }).filter(Boolean)

    const candidates = []
    const prankster = best(players.filter(p => p.prankSuccesses > 0), p => p.prankSuccesses * 10 + p.prankCount)
    if (prankster) candidates.push({ kind: 'prankster', title: '최고의 장난꾸러기', emoji: '😈', ids: [prankster.id], names: [prankster.name], value: prankster.prankSuccesses, metric: `장난 성공 ${prankster.prankSuccesses}회`, color: prankster.color })

    const tumbler = best(players.filter(p => p.respawns > 0), p => p.respawns * 10 + p.falls)
    if (tumbler) candidates.push({ kind: 'tumbler', title: '몸개그 장인', emoji: '🤕', ids: [tumbler.id], names: [tumbler.name], value: tumbler.respawns, metric: `2초 리스폰 ${tumbler.respawns}회 · 장외 ${tumbler.falls}회`, color: tumbler.color })

    const team = teams.sort((x, y) => y.duo - x.duo || y.score - x.score)[0]
    if (team) candidates.push({ kind: 'partner', title: '찰떡 짝꿍', emoji: '🪢', ids: [team.a.id, team.b.id], names: [team.a.name, team.b.name], value: team.duo, metric: team.duo > 0 ? `합동 운반 ${team.duo}회 · 2인 합계 ${team.score}점` : `2인 합계 ${team.score}점 · 고무줄 팽 ${team.yanks}회`, color: team.a.color })

    const slippery = best(players.filter(p => p.stats.bananaSlips + p.stats.jellySoaks > 0), p => p.stats.bananaSlips + p.stats.jellySoaks)
    if (slippery) candidates.push({ kind: 'slippery', title: '미끄덩 지배자', emoji: '🍌', ids: [slippery.id], names: [slippery.name], value: slippery.stats.bananaSlips + slippery.stats.jellySoaks, metric: `바나나 ${slippery.stats.bananaSlips}번 · 젤리 ${slippery.stats.jellySoaks}번`, color: slippery.color })

    const wobbler = best(players.filter(p => p.stats.tetherYanks > 0), p => p.stats.tetherYanks)
    if (wobbler) candidates.push({ kind: 'wobbler', title: '고무줄 휘청왕', emoji: '🤸', ids: [wobbler.id], names: [wobbler.name], value: wobbler.stats.tetherYanks, metric: `짝꿍 고무줄 팽 ${wobbler.stats.tetherYanks}회`, color: wobbler.color })

    const carrier = best(players.filter(p => p.stats.megaDuo + p.stats.megaSolo > 0), p => p.stats.megaDuo * 10 + p.stats.megaSolo)
    if (carrier) candidates.push({ kind: 'carrier', title: '황금 운반꾼', emoji: '🍕', ids: [carrier.id], names: [carrier.name], value: carrier.stats.megaDuo + carrier.stats.megaSolo, metric: `합동 운반 ${carrier.stats.megaDuo}회 · 단독 ${carrier.stats.megaSolo}회`, color: carrier.color })

    const bombPasser = best(players.filter(p => p.stats.bombPasses > 0), p => p.stats.bombPasses)
    if (bombPasser) candidates.push({ kind: 'bombPasser', title: '폭탄 배구왕', emoji: '💣', ids: [bombPasser.id], names: [bombPasser.name], value: bombPasser.stats.bombPasses, metric: `폭탄 넘기기 ${bombPasser.stats.bombPasses}회`, color: bombPasser.color })

    const tailThief = best(players.filter(p => p.stats.tailSteals > 0), p => p.stats.tailSteals)
    if (tailThief) candidates.push({ kind: 'tailThief', title: '꼬리 도둑', emoji: '🎯', ids: [tailThief.id], names: [tailThief.name], value: tailThief.stats.tailSteals, metric: `꼬리 강탈 ${tailThief.stats.tailSteals}회`, color: tailThief.color })

    const sweeperAce = best(players.filter(p => p.stats.sweeperAssists > 0), p => p.stats.sweeperAssists)
    if (sweeperAce) candidates.push({ kind: 'sweeperAce', title: '스위퍼 콤보왕', emoji: '🌪️', ids: [sweeperAce.id], names: [sweeperAce.name], value: sweeperAce.stats.sweeperAssists, metric: `막대에 밀어넣기 ${sweeperAce.stats.sweeperAssists}회`, color: sweeperAce.color })

    const awards = candidates.slice(0, 4)
    // 활동이 적은 매치에서도 시상식이 비지 않도록 점수 기준 대체 어워드로 2개를 채운다.
    const filler = [
      { kind: 'champion', title: '말랑 챔피언', emoji: '🏆', ids: [sorted[0]?.id].filter(Boolean), names: [sorted[0]?.name].filter(Boolean), value: sorted[0]?.score || 0, metric: `총 ${sorted[0]?.score || 0}점`, color: sorted[0]?.color },
      { kind: 'busy', title: '부지런상', emoji: '🐝', ids: [best(players, p => p.stats.deliveries + p.roundScore)?.id].filter(Boolean), names: [best(players, p => p.stats.deliveries + p.roundScore)?.name].filter(Boolean), value: best(players, p => p.stats.deliveries)?.stats.deliveries || 0, metric: `배달 ${best(players, p => p.stats.deliveries)?.stats.deliveries || 0}회`, color: '#ffbd4a' },
    ]
    for (const extra of filler) if (awards.length < 2 && !awards.some(a => a.kind === extra.kind) && extra.ids.length) awards.push(extra)
    return awards.map(award => ({ ...award, tagline: awardTagline(award) }))
  }
  /** 결과 화면 하이라이트 카드 2~4줄. */
  highlightLines(sorted, megas) {
    const players = this.allPlayers()
    const lines = []
    if (megas.duo + megas.solo > 0) lines.push({ label: '합동 운반', text: `황금 소품 배달 ${megas.duo + megas.solo}회 (짝꿍 ${megas.duo} · 단독 ${megas.solo})`, value: `+${megas.duo * MEGA_DUO_SCORE + megas.solo * MEGA_SOLO_SCORE}P` })
    const totalFalls = players.reduce((n, p) => n + p.respawns, 0)
    if (totalFalls > 0) lines.push({ label: '와장창', text: `2초 리스폰 총 ${totalFalls}회`, value: `${Math.max(...players.map(p => p.respawns))}회 최다` })
    const totalPasses = players.reduce((n, p) => n + p.stats.bombPasses, 0)
    if (totalPasses > 0) lines.push({ label: '폭탄', text: `폭탄 넘기기 ${totalPasses}회 · 폭발 ${players.reduce((n, p) => n + p.stats.bombBooms, 0)}회 생존`, value: `+${BOMB_SURVIVE_POINTS}P` })
    const totalSteals = players.reduce((n, p) => n + p.stats.tailSteals, 0)
    if (totalSteals > 0) lines.push({ label: '꼬리', text: `꼬리 강탈 ${totalSteals}회`, value: `${Math.max(...players.map(p => p.stats.tailSteals))}회 최다` })
    const totalYanks = players.reduce((n, p) => n + p.stats.tetherYanks, 0)
    if (totalYanks > 0) lines.push({ label: '고무줄', text: `짝꿍 고무줄이 팽 튄 횟수 ${totalYanks}회`, value: `${Math.max(...players.map(p => p.stats.tetherYanks))}회 최다` })
    const totalSlips = players.reduce((n, p) => n + p.stats.bananaSlips + p.stats.jellySoaks, 0)
    if (totalSlips > 0) lines.push({ label: '미끄덩', text: `바나나·젤리 피해 ${totalSlips}회`, value: `${Math.max(...players.map(p => p.stats.bananaSlips + p.stats.jellySoaks))}회 최다` })
    const topPrank = players.reduce((n, p) => n + p.prankSuccesses, 0)
    if (topPrank > 0) lines.push({ label: '장난', text: `장난 성공 총 ${topPrank}회`, value: `${Math.max(...players.map(p => p.prankSuccesses))}회 최다` })
    if (!lines.length && sorted[0]) lines.push({ label: '말랑', text: `${sorted[0].name}님이 ${sorted[0].score}점으로 1위`, value: '수고했어요!' })
    return lines.slice(0, 4)
  }
  rematch(player) {
    if (this.phase !== 'final' || player.id !== this.hostId || !player.socket?.connected) return
    this.setLobby()
    this.start(player)
  }
  handleInput(player, input) {
    if (this.phase !== 'lobby' && this.phase !== 'play') return
    if (!input || typeof input !== 'object') return
    if (player.respawning || this.round?.completed) return
    let ix = clamp(Number(input.x) || 0, -1, 1), iz = clamp(Number(input.z) || 0, -1, 1)
    const inputLength = Math.hypot(ix, iz); if (inputLength > 1) { ix /= inputLength; iz /= inputLength }
    player.input.x = ix; player.input.z = iz
    player.input.jump = !!input.jump
    if (player.input.jump) player.jumpBufferUntil = Date.now() + JUMP_BUFFER_MS
    const preservePracticeAction = this.phase === 'lobby'
    player.input.interact = !!input.interact || ((preservePracticeAction || this.round?.type === 'vault') && player.input.interact)
    if (input.prank || !preservePracticeAction) {
      player.input.prank = !!input.prank
      player.input.prankType = MOTION_PRANKS.includes(input.prankType) ? input.prankType : 'headbutt'
    }
    player.lastInputAt = Date.now()
  }
  nearbyObject(player, list) { return list.find(o => !o.delivered && !o.broken && (!o.carriedBy || o.carriedBy === player.id) && dist(player, o) <= 1.7) }
  dropCarried(target) {
    if (!target.carried) return false
    if (target.carried === MEGA_ID) { this.releaseMega(target); return true }
    const r = this.round
    if (r?.type === 'banana') { const item = r.bananas.find(o => o.id === target.carried); if (item) { item.carriedBy = ''; item.x = target.x; item.z = target.z } }
    if (r?.type === 'pizza') { const item = r.ingredients.find(o => o.id === target.carried); if (item) { item.carriedBy = ''; item.x = target.x; item.z = target.z } }
    if (r?.type === 'balloon') { const item = r.balloons.find(o => o.id === target.carried); if (item) { item.carriedBy = ''; item.x = target.x; item.z = target.z } }
    target.carried = ''
    if (r?.type === 'crown' && r.crown.owner === target.id) { r.crown.owner = ''; r.crown.x = target.x; r.crown.z = target.z }
    return true
  }
  shatterCarried(target, reason = 'impact') {
    if (!target.carried) return false
    if (target.carried === MEGA_ID) { this.releaseMega(target); return true }
    const id = target.carried
    const r = this.round
    const lists = [r?.bananas, r?.ingredients, r?.balloons]
    const item = lists.flatMap(v => v || []).find(o => o.id === id)
    if (item) { item.carriedBy = ''; item.broken = true; item.x = target.x; item.z = target.z }
    target.carried = ''
    target.roundScore = Math.max(0, target.roundScore - 60)
    this.emitEvent('shatter', `${target.name}님의 소품이 와장창 깨졌다!`, { playerId: target.id, x: target.x, z: target.z, reason, fragments: 6 })
    return true
  }
  /**
   * 고무줄 짝꿍 — 짝과의 거리가 늘어난 만큼 서버가 양쪽을 서로 끌어당긴다.
   * 2초 리스폰 중인 플레이어는 힘을 받지 않고, 최대 길이를 넘으면 단단히 당겨 붙인다.
   */
  updateTether(dt) {
    if (!this.pairs.length) return
    const now = Date.now()
    for (const pair of this.pairs) {
      const a = this.players.get(pair.a), b = this.players.get(pair.b)
      if (!a || !b) continue
      if (['switch', 'vault'].includes(this.round?.type) && ((!a.isBot && !a.socket?.connected) || (!b.isBot && !b.socket?.connected))) continue
      const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz)
      pair.length = d
      const over = Math.max(0, d - TETHER_REST)
      pair.tension = clamp(over / (TETHER_MAX - TETHER_REST), 0, 1)
      if (d > 0.001 && over > 0) {
        const nx = dx / d, nz = dz / d
        const pull = Math.min(22, over * TETHER_SPRING)
        if (!a.respawning) { a.vx += nx * pull * dt; a.vz += nz * pull * dt }
        if (!b.respawning) { b.vx -= nx * pull * dt; b.vz -= nz * pull * dt }
        const rel = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz
        const damping = rel * TETHER_DAMPING * dt
        if (!a.respawning) { a.vx += nx * damping; a.vz += nz * damping }
        if (!b.respawning) { b.vx -= nx * damping; b.vz -= nz * damping }
        if (over > TETHER_WOBBLE_OVER) pair.wobbleUntil = now + 160
      }
      if (d > TETHER_MAX) {
        const nx = dx / d, nz = dz / d, excess = d - TETHER_MAX
        if (!a.respawning) { a.x = clamp(a.x + nx * excess * 0.5, -WORLD_RADIUS - 2.2, WORLD_RADIUS + 2.2); a.z = clamp(a.z + nz * excess * 0.5, -WORLD_RADIUS - 2.2, WORLD_RADIUS + 2.2) }
        if (!b.respawning) { b.x = clamp(b.x - nx * excess * 0.5, -WORLD_RADIUS - 2.2, WORLD_RADIUS + 2.2); b.z = clamp(b.z - nz * excess * 0.5, -WORLD_RADIUS - 2.2, WORLD_RADIUS + 2.2) }
        // 한 틱에 최대 길이를 넘겨도 스냅샷에는 실제(보정된) 거리만 남긴다.
        pair.length = Math.min(dist(a, b), TETHER_MAX)
        pair.tension = 1
      }
    }
  }
  /** 한 명이 점프하면 고무줄이 팽 당겨져 둘 다 휘청한다(박자 안 맞는 슬랩스틱). */
  tetherYank(jumper) {
    const partner = this.partnerOf(jumper)
    if (!partner || partner.respawning || jumper.respawning) return
    const d = dist(jumper, partner)
    if (d > TETHER_MAX - 0.4) return
    const now = Date.now()
    if (now - jumper.lastTetherAt < TETHER_EVENT_MS) return
    jumper.lastTetherAt = now
    partner.lastTetherAt = now
    const dx = partner.x - jumper.x, dz = partner.z - jumper.z, len = Math.hypot(dx, dz) || 1
    partner.staggerUntil = Math.max(partner.staggerUntil, now + TETHER_YANK_MS)
    jumper.staggerUntil = Math.max(jumper.staggerUntil, now + Math.round(TETHER_YANK_MS * 0.5))
    partner.vx += (dx / len) * TETHER_YANK_PULL; partner.vz += (dz / len) * TETHER_YANK_PULL
    jumper.vx -= (dx / len) * TETHER_YANK_PULL * 0.6; jumper.vz -= (dz / len) * TETHER_YANK_PULL * 0.6
    jumper.motion = 'Hit'; jumper.motionUntil = now + 320
    partner.motion = 'Hit'; partner.motionUntil = now + 320
    this.bump(jumper, 'tetherYanks'); this.bump(partner, 'tetherYanks')
    this.emitEvent('tether', `${jumper.name}·${partner.name} 짝꿍의 고무줄이 팡! 둘이 같이 휘청!`, { playerId: jumper.id, partnerId: partner.id, x: partner.x, z: partner.z })
  }
  /** 낙하·탈락 → 2초 카운트다운 뒤 아레나 안전 위치로 즉시 복귀. */
  startRespawn(player, reason = 'ringout') {
    if (player.respawning || this.phase !== 'play') return
    const now = Date.now()
    player.respawning = true
    player.respawnAt = now + RESPAWN_COUNTDOWN_MS
    player.respawnReason = reason
    this.dropCarried(player)
    player.carried = ''
    player.vx = 0; player.vz = 0; player.jumpV = 0; player.jumpY = 0
    player.grabbedBy = ''; player.grabTargetId = ''
    // 리스폰 중 대기한 입력이 복귀 직후 자동 발동하지 않게 비운다.
    player.input = { x: 0, z: 0, jump: false, interact: false, prank: false, prankType: player.input.prankType || 'headbutt' }
    player.jumpBufferUntil = 0
    player.grabUntil = 0
    player.staggerUntil = 0; player.knockdownUntil = 0; player.hugUntil = 0
    player.respawns++
    this.bump(player, 'respawns')
    if (reason === 'ringout' || reason === 'wall') { player.falls++; this.bump(player, 'falls') }
    const text = reason === 'tile' ? `${player.name}님, 안내 색 발판 밖! 2초 뒤 복귀` : `${player.name}님 와장창! 2초 뒤 복귀`
    this.emitEvent('fall', text, { playerId: player.id, x: player.x, z: player.z, reason, countdown: RESPAWN_COUNTDOWN_MS })
  }
  safeSpawn(player) {
    if (this.round?.type === 'platform') {
      const tile = this.platforms.find(t => t.color === this.round.targetColor) || this.platforms[0]
      if (tile) return { x: tile.x, z: tile.z }
    }
    const spawn = spawnFor(player.seat)
    const radius = Math.hypot(spawn.x, spawn.z) || 1
    const limit = WORLD_RADIUS - 3
    const scale = radius > limit ? limit / radius : 1
    return { x: spawn.x * scale, z: spawn.z * scale }
  }
  completeRespawn(player) {
    if (!player.respawning) return
    const now = Date.now()
    const spot = this.safeSpawn(player)
    player.x = spot.x; player.z = spot.z
    player.vx = 0; player.vz = 0; player.jumpY = 0; player.jumpV = 0
    player.respawning = false; player.respawnAt = 0
    player.prankImmuneUntil = now + RESPAWN_IMMUNE_MS
    player.motion = 'Jump'; player.motionUntil = now + 420
    this.emitEvent('respawn', `${player.name}님 복귀! (무적 ${Math.round(RESPAWN_IMMUNE_MS / 100) / 10}초)`, { playerId: player.id, x: player.x, z: player.z })
  }
  /** 무거운 2인 합동 운반 오브젝트 — 한 명이면 느리게 질질 끌리고, 둘이면 빠르게 날아간다. */
  joinMega(player) {
    const mega = this.round?.mega
    if (!mega || mega.delivered || mega.carriers.length >= 2 || player.carried) return false
    if (this.round.type === 'vault' && (Date.now() < mega.wobbleUntil || player.respawning || player.grabbedBy || player.jumpY > 0.12)) return false
    player.carried = MEGA_ID
    mega.carriers.push(player.id)
    this.bump(player, 'megaJoins')
    const names = mega.carriers.map(id => this.players.get(id)?.name).filter(Boolean)
    if (mega.carriers.length >= 2) this.emitEvent(this.round.type === 'vault' ? 'vault_grab' : 'mega_grab', `${names.join('·')} 짝꿍이 ${mega.name}를 번쩍! 함께 배달존으로!`, { x: mega.x, z: mega.z, carriers: [...mega.carriers] })
    else if (this.round.type === 'vault') this.emitEvent('mega_grab', '금고 손잡이 하나 확보! 한 명 더 잡으면 움직여요.', { x: mega.x, z: mega.z })
    else this.emitEvent('mega_grab', `${player.name}님이 ${mega.name}를 혼자 들려다 휘청! 짝꿍의 E가 필요해요.`, { x: mega.x, z: mega.z, carriers: [...mega.carriers] })
    return true
  }
  releaseMega(player, silent = false) {
    const mega = this.round?.mega
    if (!mega) return false
    const had = mega.carriers.includes(player.id)
    mega.carriers = mega.carriers.filter(id => id !== player.id)
    if (player.carried === MEGA_ID) player.carried = ''
    if (had && !silent) this.emitEvent('mega_drop', `${player.name}님이 ${mega.name}를 내려놓았어요.`, { x: mega.x, z: mega.z })
    return had
  }
  deliverMega(carriers) {
    const mega = this.round?.mega
    if (!mega || mega.delivered) return
    if (this.round.type === 'vault') this.round.delivered = 1
    mega.delivered = true
    mega.deliveredAt = Date.now()
    const duo = carriers.length >= 2
    const bonus = duo ? MEGA_DUO_SCORE : MEGA_SOLO_SCORE
    for (const p of carriers) {
      p.carried = ''
      p.roundScore += bonus
      p.contribution += duo ? 10 : 3
      p.megaDeliveries++
      this.bump(p, duo ? 'megaDuo' : 'megaSolo')
    }
    mega.carriers = []
    const names = carriers.map(p => p.name).join('·')
    this.emitEvent(this.round.type === 'vault' ? 'vault_delivered' : 'mega', duo ? `${names} 짝꿍이 ${mega.name} 배달 성공! +${bonus}P 대박 보너스!` : `${names}님이 혼자 ${mega.name}를 질질 끌어 배달… +${bonus}P`, { x: mega.x, z: mega.z, duo, bonus, carriers: carriers.map(p => p.id) })
  }
  updateMega(dt) {
    const mega = this.round?.mega
    if (!mega || mega.delivered) return
    const isVault = this.round.type === 'vault'
    const carriers = mega.carriers.map(id => this.players.get(id)).filter(p => p && !p.respawning && p.carried === MEGA_ID)
    mega.carriers = carriers.map(p => p.id)
    if (isVault && carriers.length < 2) {
      const [carrier] = carriers
      if (carrier && dist(carrier, mega) > MEGA_REACH) this.releaseMega(carrier)
      return
    }
    for (const p of carriers) { p.megaCarryTime += dt; this.bump(p, 'megaCarryTime', dt) }
    if (!carriers.length) return
    const cx = carriers.reduce((n, p) => n + p.x, 0) / carriers.length
    const cz = carriers.reduce((n, p) => n + p.z, 0) / carriers.length
    if (isVault) {
      const hazard = vaultCollision(this.round, { x: cx, z: cz }, carriers)
      if (hazard) {
        const now = Date.now()
        for (const player of carriers) {
          this.releaseMega(player, true)
          player.staggerUntil = now + 550
          player.motion = 'Hit'; player.motionUntil = now + 550
        }
        mega.wobbleUntil = now + 850
        this.emitEvent('vault_hit', '금고가 장애물에 부딪혔어요! 둘이 다시 잡아요.', { x: hazard.x, z: hazard.z })
        return
      }
    }
    const tooFarApart = carriers.length === 2 && dist(carriers[0], carriers[1]) > MEGA_SPLIT_MAX
    if (!isVault || !tooFarApart) { mega.x = cx; mega.z = cz }
    if (tooFarApart) {
      mega.carriers = []
      for (const p of carriers) { p.carried = ''; p.staggerUntil = Date.now() + 500; p.motion = 'Hit'; p.motionUntil = Date.now() + 500 }
      mega.wobbleUntil = Date.now() + 700
      this.emitEvent('mega_drop', `${mega.name}가 휘청! 둘이 같이 들어야 빨라요.`, { x: mega.x, z: mega.z })
      return
    }
    if (dist(mega, mega.zone) <= MEGA_ZONE_RADIUS) this.deliverMega(carriers)
  }
  updateGrab(player) {
    const now = Date.now()
    // 합동 운반 오브젝트 옆에서는 E가 '사람 잡기'보다 '함께 들기'를 우선한다.
    const mega = this.round?.mega
    if (mega && !mega.delivered && (!player.carried || player.carried === MEGA_ID) && dist(player, mega) <= MEGA_REACH) return
    if (player.grabTargetId) {
      const target = this.phase === 'lobby' && player.grabTargetId === PRACTICE_DUMMY_ID
        ? this.practiceDummy
        : this.players.get(player.grabTargetId)
      if (!target || !target.socket?.connected && !target.isBot || now >= player.grabUntil) {
        if (target) { target.grabbedBy = ''; target.vx = player.vx * .35; target.vz = player.vz * .35 }
        player.grabTargetId = ''; return
      }
      target.x = clamp(player.x - (player.x - target.x) * .18, -WORLD_RADIUS, WORLD_RADIUS)
      target.z = clamp(player.z - (player.z - target.z) * .18, -WORLD_RADIUS, WORLD_RADIUS)
      target.vx = player.vx * .25; target.vz = player.vz * .25
      if (player.input.interact) {
        player.input.interact = false; player.grabTargetId = ''; target.grabbedBy = ''; target.vx = player.vx + (player.vx || 1) * THROW_IMPULSE; target.vz = player.vz + (player.vz || 0) * THROW_IMPULSE; target.jumpV = Math.max(target.jumpV, 4.2); target.motion = 'Hit'; target.motionUntil = now + 800; this.shatterCarried(target, 'throw'); this.bump(player, 'throws'); this.emitEvent('throw', `${player.name}님이 ${target.name}님을 던졌다!`, { attackerId: player.id, targetId: target.id, x: target.x, z: target.z })
      }
      return
    }
    if (player.grabbedBy) {
      if (player.input.interact) { player.escapePresses++; player.input.interact = false; if (player.escapePresses >= GRAB_ESCAPE_PRESSES) { const holder = this.players.get(player.grabbedBy); if (holder) holder.grabTargetId = ''; player.grabbedBy = ''; player.escapePresses = 0; this.emitEvent('escape', `${player.name}님이 잡기에서 탈출!`) } }
      return
    }
    if (!player.input.interact || now < player.cooldowns.grab) return
    const target = this.actionTargets().filter(p => p.id !== player.id && !p.grabbedBy && !p.respawning && dist(player, p) <= GRAB_RANGE).sort((a, b) => dist(player, a) - dist(player, b))[0]
    if (!target) return
    player.input.interact = false; player.grabTargetId = target.id; player.grabUntil = now + GRAB_DURATION_MS; player.cooldowns.grab = now + GRAB_COOLDOWN_MS; target.grabbedBy = player.id; target.escapePresses = 0; this.bump(player, 'grabs')
    if (this.round?.type === 'bomb' && this.round.bomb?.holder === player.id) this.passBomb(player, target, now)
    if (this.round?.type === 'tail' && this.hasTail(target) && !this.hasTail(player) && now >= player.stealCooldownUntil && now >= target.tailImmuneUntil) {
      this.takeTail(target); this.giveTail(player)
      player.stealCooldownUntil = now + TAIL_STEAL_MS; target.stealCooldownUntil = now + TAIL_STEAL_MS
      player.tailImmuneUntil = now + TAIL_TRANSFER_IMMUNE_MS; target.tailImmuneUntil = now + TAIL_TRANSFER_IMMUNE_MS
      this.round.tailStolen++; this.bump(player, 'tailSteals')
      this.emitEvent('tail_steal', `${player.name}님이 ${target.name}님의 꼬리를 낚아챘다!`, { attackerId: player.id, targetId: target.id, x: target.x, z: target.z, itemType: 'tail' })
    }
    this.emitEvent('grab', `${player.name}님이 ${target.name}님을 붙잡았다!`, { attackerId: player.id, targetId: target.id, x: target.x, z: target.z })
  }
  processPrank(attacker) {
    if (!attacker.input.prank) return
    const now = Date.now()
    const prankType = MOTION_PRANKS.includes(attacker.input.prankType) ? attacker.input.prankType : 'headbutt'
    attacker.input.prank = false
    attacker.lastPrankType = prankType
    // 행동별 쿨타임: 같은 동작을 연타하면 이 입력은 버려진다.
    if (now < (attacker.cooldowns[prankType] || 0)) return
    attacker.cooldowns[prankType] = now + ACTION_COOLDOWN_MS[prankType]
    const motionNames = { headbutt: 'Bonk', bonk: 'Bonk', tackle: 'Bonk', hug: 'Bonk' }
    attacker.motion = motionNames[prankType]; attacker.motionUntil = now + 700
    const target = this.actionTargets().filter(p => p.id !== attacker.id && !p.respawning && dist(attacker, p) <= PRANK_RANGE).sort((a, b) => dist(attacker, a) - dist(attacker, b))[0]
    if (!target || now < target.prankImmuneUntil) return
    const dx = target.x - attacker.x, dz = target.z - attacker.z, length = Math.hypot(dx, dz) || 1
    const nx = dx / length, nz = dz / length
    target.prankImmuneUntil = now + PRANK_IMMUNITY_MS
    target.lastPrankedAt = now
    target.lastPrankedBy = attacker.id
    // 시한폭탄: 폭탄을 든 사람이 때리면 상대에게 폭탄이 넘어간다(박치기·꿀밤·태클).
    if (this.round?.type === 'bomb' && prankType !== 'hug' && this.round.bomb?.holder === attacker.id) this.passBomb(attacker, target, now)
    target.motion = 'Hit'; target.motionUntil = now + (prankType === 'tackle' ? TACKLE_KNOCKDOWN_MS : BONK_STAGGER_MS)
    if (prankType === 'bonk') { target.staggerUntil = now + BONK_STAGGER_MS; target.spin = (target.x + target.z) % 2 ? 4.8 : -4.8; target.vx += nx * 4.2; target.vz += nz * 4.2 }
    else if (prankType === 'tackle') { target.knockdownUntil = now + TACKLE_KNOCKDOWN_MS; target.vx += nx * 9.4; target.vz += nz * 9.4; target.jumpV = Math.max(target.jumpV, 1.6) }
    else if (prankType === 'hug') { attacker.hugUntil = now + HUG_SLOW_MS; target.hugUntil = now + HUG_SLOW_MS; target.vx *= .25; target.vz *= .25 }
    else { target.vx += nx * PRANK_IMPULSE; target.vz += nz * PRANK_IMPULSE; target.jumpV = Math.max(target.jumpV, PRANK_BOUNCE) }
    // 꼬리 뺏기: 꼬리가 없는 사람이 꼬리 보유자를 때리면 꼬리를 강탈한다(0.8초 강탈 쿨타임).
    if (this.round?.type === 'tail' && this.hasTail(target) && !this.hasTail(attacker) && now >= attacker.stealCooldownUntil && now >= target.tailImmuneUntil) {
      this.takeTail(target)
      this.giveTail(attacker)
      attacker.stealCooldownUntil = now + TAIL_STEAL_MS
      target.stealCooldownUntil = now + TAIL_STEAL_MS
      attacker.tailImmuneUntil = now + TAIL_TRANSFER_IMMUNE_MS
      target.tailImmuneUntil = now + TAIL_TRANSFER_IMMUNE_MS
      this.round.tailStolen++
      this.bump(attacker, 'tailSteals')
      this.emitEvent('tail_steal', `${attacker.name}님이 ${target.name}님의 꼬리를 뺏었다!`, { attackerId: attacker.id, targetId: target.id, x: target.x, z: target.z, itemType: 'tail' })
    }
    const edge = this.phase !== 'lobby' && Math.hypot(target.x + nx * 1.25, target.z + nz * 1.25) >= WORLD_RADIUS - .35
    const dropped = Boolean(target.carried && (prankType === 'tackle' || target.jumpY < 1.1 || edge)) && this.dropCarried(target)
    this.bump(attacker, prankType === 'bonk' ? 'bonkHits' : prankType === 'tackle' ? 'tackleHits' : prankType === 'hug' ? 'hugHits' : 'headbuttHits')
    if (dropped && attacker.secretMission?.kind === 'drop_two') attacker.missionProgress++
    if (edge && attacker.secretMission?.kind === 'ringout') attacker.missionProgress++
    if (prankType === 'bonk') attacker.lastBonkTargetId = target.id
    if (this.phase !== 'lobby') {
      attacker.prankCount++
      if (edge || dropped || prankType !== 'hug') attacker.prankSuccesses++
    }
    const names = { headbutt: '박치기', bonk: '꿀밤', tackle: '발 걸기 태클', hug: '젤리 꽁꽁 붙잡기' }
    const suffix = prankType === 'hug' ? ' 1.2초 꽁꽁 붙잡혔다!' : dropped ? ' 아이템을 떨어뜨렸다!' : edge ? ' 발판 밖으로 밀쳐냈다!' : ' 맞았다!'
    this.emitEvent('prank', `${attacker.name}님이 ${target.name}님에게 ${names[prankType]}!${suffix}`, { attackerId: attacker.id, targetId: target.id, dropped, edge, x: target.x, z: target.z, itemType: prankType })
  }
  applyPrankItem(player) {
    const items = this.phase === 'lobby' ? this.practiceItems : this.round?.prankItems
    if (!items) return
    const item = items.find(o => !o.consumed && Math.hypot(player.x - o.x, player.z - o.z) < 1.05)
    if (!item) return
    item.consumed = true
    const now = Date.now()
    item.respawnAt = now + (item.type === 'banana_peel' ? BANANA_RESPAWN_MS : item.type === 'jelly_pool' ? JELLY_RESPAWN_MS : PRANK_ITEM_LIFETIME_MS)
    if (item.type === 'banana_peel') { player.slipUntil = now + BANANA_SLIP_MS; player.spin = 5.2 }
    if (item.type === 'jelly_pool') { player.slowUntil = now + JELLY_SLOW_MS; player.stickyUntil = now + JELLY_ESCAPE_MS; player.inkUntil = now + JELLY_INK_MS }
    if (item.type === 'reverse') player.reverseUntil = now + REVERSE_MS
    if (item.type === 'shockwave') {
      for (const other of this.connected()) if (other.id !== player.id && dist(player, other) < SHOCKWAVE_RADIUS && now >= other.prankImmuneUntil) { const dx = other.x - player.x, dz = other.z - player.z, len = Math.hypot(dx, dz) || 1; other.vx += dx / len * SHOCKWAVE_IMPULSE; other.vz += dz / len * SHOCKWAVE_IMPULSE; other.jumpV = Math.max(other.jumpV, SHOCKWAVE_BOUNCE); other.prankImmuneUntil = now + PRANK_IMMUNITY_MS; if (other.carried && other.jumpY < 1.1) this.dropCarried(other) }
    }
    if (this.phase !== 'lobby') player.prankSuccesses++
    this.bump(player, item.type === 'banana_peel' ? 'bananaSlips' : item.type === 'jelly_pool' ? 'jellySoaks' : item.type === 'shockwave' ? 'shockwaves' : 'reverses')
    const names = { banana_peel: '바나나 껍질', jelly_pool: '끈적 젤리 웅덩이', shockwave: '뿅망치 충격파', reverse: '방향 반전' }
    this.emitEvent('prank_item', `${player.name}님이 ${names[item.type]} 장난!`, { itemType: item.type, playerId: player.id, x: player.x, z: player.z })
  }
  updatePlayer(player, dt) {
    if (player.respawning) return
    const input = player.input
    const roundType = this.definition?.type ?? 'banana'
    const reverse = Date.now() < player.reverseUntil ? -1 : 1
    const now = Date.now()
    const slipping = now < player.slipUntil
    const sticky = now < player.stickyUntil
    const mega = this.round?.mega
    const megaFactor = player.carried === MEGA_ID && mega ? (mega.carriers.length >= 2 ? (roundType === 'vault' ? 0.64 : MEGA_PAIR_FACTOR) : MEGA_SINGLE_FACTOR) : 1
    const speedFactor = player.grabbedBy ? .12 : now < player.knockdownUntil ? .08 : now < player.hugUntil ? .25 : now < player.staggerUntil ? .35 : now < player.slowUntil ? .42 : slipping ? BANANA_SLIP_ACCEL : 1
    const accel = sticky ? 8 : slipping ? 7 : MOVE_ACCEL
    const desiredX = input.x * reverse * MOVE_SPEED * speedFactor * megaFactor, desiredZ = input.z * reverse * MOVE_SPEED * speedFactor * megaFactor
    const currentSpeed = Math.hypot(player.vx, player.vz), braking = Math.hypot(desiredX, desiredZ) < currentSpeed
    player.vx += (desiredX - player.vx) * Math.min(1, (braking ? BRAKE_ACCEL : accel) * dt)
    player.vz += (desiredZ - player.vz) * Math.min(1, (braking ? BRAKE_ACCEL : accel) * dt)
    if (roundType === 'banana' || slipping || sticky) { const friction = slipping ? 0.994 : sticky ? 0.975 : 0.99; player.vx *= friction; player.vz *= friction }
    player.spin *= Math.pow(0.08, dt)
    if (player.jumpY <= 0.01) player.coyoteUntil = now + COYOTE_MS
    if (now < player.jumpBufferUntil && (player.jumpY <= 0.01 || now <= player.coyoteUntil) && now >= player.cooldowns.jump) {
      player.jumpV = JUMP_SPEED * (player.carried === MEGA_ID ? 0.7 : 1)
      player.jumpBufferUntil = 0
      player.cooldowns.jump = now + ACTION_COOLDOWN_MS.jump
      player.socket?.emit('cue', 'jump')
      this.tetherYank(player)
    }
    player.jumpV -= GRAVITY * dt; player.jumpY = Math.max(0, player.jumpY + player.jumpV * dt); if (!player.jumpY) player.jumpV = 0
    const nextX = player.x + player.vx * dt, nextZ = player.z + player.vz * dt
    const limit = WORLD_RADIUS + 2.2
    player.x = clamp(nextX, -limit, limit); player.z = clamp(nextZ, -limit, limit)
    const away = Math.hypot(player.x, player.z)
    if (away >= WORLD_RADIUS && Math.hypot(player.vx, player.vz) >= SHATTER_IMPULSE) this.shatterCarried(player, 'wall')
    if (this.phase === 'lobby' && away > PRACTICE_RADIUS) {
      player.x *= PRACTICE_RADIUS / away
      player.z *= PRACTICE_RADIUS / away
      const nx = player.x / PRACTICE_RADIUS, nz = player.z / PRACTICE_RADIUS
      const outward = Math.max(0, player.vx * nx + player.vz * nz)
      player.vx -= outward * nx
      player.vz -= outward * nz
    } else if (away > WORLD_RADIUS + 0.35) this.startRespawn(player, 'ringout')
    this.updateGrab(player)
    this.processPrank(player)
    this.updateInteraction(player)
    if (player.id !== PRACTICE_DUMMY_ID) this.applyPrankItem(player)
    input.jump = false; input.interact = false
  }
  updateBotInput(bot, now) {
    if (!bot.isBot || this.phase !== 'play' || now < bot.nextAiAt) return
    if (bot.respawning) return
    const intervals = { easy: 260, normal: 165, hard: 95 }
    bot.nextAiAt = now + (intervals[bot.botDifficulty] || intervals.normal)
    const r = this.round
    if (r.type === 'herd' || r.type === 'switch' || r.type === 'vault') {
      const partner = this.partnerOf(bot)
      let target = bot
      if (r.type === 'herd') target = herdBotTarget(r, bot)
      if (r.type === 'switch') target = r.gates.find(gate => !gate.opened && gate.pads.some(pad => pad.id === bot.id))?.pads.find(pad => pad.id === bot.id) ?? bot
      if (r.type === 'vault') {
        const teammate = this.players.get(r.mega.carriers.find(id => id !== bot.id)) ?? partner
        target = vaultBotTarget(r, bot, teammate)
        const waitingForHuman = partner && !partner.isBot && !r.mega.carriers.includes(partner.id) && dist(partner, r.mega) > MEGA_REACH
        bot.input.interact = !waitingForHuman && !bot.carried && !r.mega.delivered && now >= r.mega.wobbleUntil && dist(bot, r.mega) <= 2
      }
      const dx = target.x - bot.x, dz = target.z - bot.z
      const scale = 1 / Math.max(0.6, Math.hypot(dx, dz))
      bot.input.x = dx * scale
      bot.input.z = dz * scale
      return
    }
    let target = this.connected().filter(p => p.id !== bot.id).sort((a, b) => dist(bot, a) - dist(bot, b))[0]
    let objective = target
    const list = r?.type === 'banana' ? r.bananas : r?.type === 'pizza' ? r.ingredients : r?.type === 'balloon' ? r.balloons : []
    const mega = r?.mega
    // 합동 운반: 짝꿍이 이미 들고 있거나 가까이 있으면 봇도 함께 든다(1인 모드의 짝꿍 봇).
    if (mega && !mega.delivered) {
      const partner = bot.partnerId ? this.players.get(bot.partnerId) : null
      const partnerCarrying = partner && mega.carriers.includes(partner.id)
      const nearMega = dist(bot, mega) < 6.5
      if (mega.carriers.includes(bot.id)) objective = mega.zone
      else if (!bot.carried && (partnerCarrying || (nearMega && Math.random() < (bot.botDifficulty === 'hard' ? 0.45 : 0.28)))) objective = mega
    }
    // ── 신규 미니게임 봇 AI: 폭탄은 떠넘기고, 스위퍼는 점프로 피하고, 꼬리는 쫓고 도망간다 ──
    let handled = false
    let forcePrank = false
    if (r?.type === 'bomb' && r.bomb) {
      handled = true
      if (r.bomb.holder === bot.id) {
        // 폭탄을 든 봇은 가장 가까운 사람에게 달려들어 넘긴다.
        objective = target
        if (target && dist(bot, target) <= PRANK_RANGE - 0.15) forcePrank = true
      } else {
        const holder = this.players.get(r.bomb.holder)
        if (holder) {
          const away = awayFrom(bot, holder, 4.5)
          objective = away
        }
      }
    } else if (r?.type === 'sweeper') {
      handled = true
      const sweeper = r.sweeper
      // 막대 뒤쪽(회전 반대편)으로 붙어 안전 거리를 유지한다.
      const safeAngle = sweeper.angle + (sweeper.direction > 0 ? -1.05 : 1.05)
      objective = { x: Math.cos(safeAngle) * 3.1, z: Math.sin(safeAngle) * 3.1 }
      const theta = Math.atan2(bot.z, bot.x)
      const lead = sweeper.direction > 0 ? 0.42 : 0.42
      if (angleGap(theta, sweeper.angle + sweeper.direction * lead) < 0.55) bot.input.jump = true
      if (target && dist(bot, target) <= PRANK_RANGE && sweepersNear(bot, sweeper) && Math.random() < 0.12) forcePrank = true
    } else if (r?.type === 'tail') {
      handled = true
      const iHaveTail = this.hasTail(bot)
      if (iHaveTail) {
        const chaser = this.connected().filter(p => p.id !== bot.id && !this.hasTail(p)).sort((a, b) => dist(bot, a) - dist(bot, b))[0]
        if (chaser) objective = awayFrom(bot, chaser, 4.2)
      } else {
        const owners = this.connected().filter(p => this.hasTail(p)).sort((a, b) => dist(bot, a) - dist(bot, b))
        objective = owners[0] || target
        if (owners[0] && dist(bot, owners[0]) <= PRANK_RANGE - 0.1) forcePrank = true
      }
    }
    if (!handled) {
      if (objective === target && bot.carried) objective = r?.delivery || r?.station || r?.tower || objective
      else if (objective === target && list.length) objective = list.filter(o => !o.delivered && !o.carriedBy).sort((a, b) => dist(bot, a) - dist(bot, b))[0] || objective
      else if (objective === target && r?.type === 'crown') objective = r.crown.owner && r.crown.owner !== bot.id ? this.players.get(r.crown.owner) : r.crown
      else if (objective === target && r?.type === 'platform') objective = this.platforms.find(p => p.color === r.targetColor) || objective
    }
    if (objective) { const dx = objective.x - bot.x, dz = objective.z - bot.z, d = Math.hypot(dx, dz) || 1; bot.input.x = dx / d; bot.input.z = dz / d; if (!handled) bot.input.interact = d < 1.8 }
    if (forcePrank) { bot.input.prank = true; bot.input.prankType = r?.type === 'bomb' ? 'headbutt' : 'bonk' }
    else if (target && dist(bot, target) <= PRANK_RANGE && Math.random() < (bot.botDifficulty === 'hard' ? .35 : bot.botDifficulty === 'normal' ? .18 : .08)) { bot.input.prank = true; bot.input.prankType = MOTION_PRANKS[Math.floor(Math.random() * MOTION_PRANKS.length)] }
    if (Math.random() < .025) bot.input.jump = true
  }
  updateInteraction(player) {
    const r = this.round
    if (!r || !player.input.interact) return
    if (r.type === 'vault' && this.phase !== 'play') return
    if (r.type === 'vault' && player.carried === MEGA_ID) {
      this.releaseMega(player)
      return
    }
    const mega = r.mega
    if (mega && !mega.delivered && dist(player, mega) <= MEGA_REACH && (!player.carried || player.carried === MEGA_ID)) {
      player.input.interact = false
      if (player.carried === MEGA_ID) this.releaseMega(player)
      else this.joinMega(player)
      return
    }
    if (player.carried === MEGA_ID) return
    if (r.type === 'banana') {
      if (player.carried) {
        if (dist(player, r.delivery) <= 2.2) {
          const item = r.bananas.find(b => b.id === player.carried)
          if (item) { item.carriedBy = ''; item.delivered = true; r.delivered++; player.roundScore++; player.contribution++; this.bump(player, 'deliveries'); player.socket?.emit('cue', 'score') }
          player.carried = ''
        }
      } else {
        const item = this.nearbyObject(player, r.bananas)
        if (item) { item.carriedBy = player.id; player.carried = item.id }
      }
    } else if (r.type === 'pizza') {
      if (player.carried) {
        if (dist(player, r.station) <= 2.2) {
          const item = r.ingredients.find(o => o.id === player.carried)
          if (item) { item.carriedBy = ''; item.delivered = true; r.delivered++; player.contribution++; player.roundScore++; this.bump(player, 'deliveries'); player.socket?.emit('cue', 'score') }
          player.carried = ''
        }
      } else {
        const item = this.nearbyObject(player, r.ingredients)
        if (item) { item.carriedBy = player.id; player.carried = item.id }
      }
    } else if (r.type === 'crown') {
      if (dist(player, r.crown) <= 2.1 && (!r.crown.owner || r.crown.owner !== player.id)) {
        r.crown.owner = player.id; player.contribution++; this.emitEvent('crown', `${player.name}님이 왕관을 훔쳤다!`)
      }
    } else if (r.type === 'balloon') {
      if (player.carried) {
        if (dist(player, r.tower) <= 2.2) {
          const item = r.balloons.find(o => o.id === player.carried)
          if (item) { item.carriedBy = ''; item.delivered = true; r.delivered++; player.contribution++; player.roundScore++; this.bump(player, 'deliveries'); player.socket?.emit('cue', 'score') }
          player.carried = ''
        }
      } else {
        const item = this.nearbyObject(player, r.balloons)
        if (item) { item.carriedBy = player.id; player.carried = item.id }
      }
    }
  }
  updateRound(dt) {
    const r = this.round
    if (!r) return
    const now = Date.now()
    for (const item of r.prankItems || []) if (item.consumed && item.respawnAt && now >= item.respawnAt) { item.consumed = false; item.respawnAt = 0; item.spawnedAt = now; this.emitEvent('prank_respawn', `${item.type === 'banana_peel' ? '바나나 껍질' : item.type === 'jelly_pool' ? '끈적 젤리' : '장난 아이템'} 재설치!`, { itemType: item.type, x: item.x, z: item.z }) }
    if (r.type === 'herd') tickHerd(r, this.connected(), dt, this.emitEvent.bind(this))
    if (r.type === 'switch') tickSwitch(r, this.connected(), dt, this.emitEvent.bind(this))
    if (r.type === 'crown') {
      if (r.crown.owner) {
        const owner = this.players.get(r.crown.owner)
        if (owner) { owner.crownTime += dt; owner.roundScore = Math.floor(owner.crownTime * 10); owner.contribution = owner.roundScore }
      }
    }
    if (r.type === 'bomb') {
      const bomb = r.bomb
      const holder = this.players.get(bomb.holder)
      if (!holder || holder.respawning) {
        if (!bomb.holder || now >= bomb.immuneUntil) this.assignBomb(holder?.id, now)
      } else {
        bomb.x = holder.x; bomb.z = holder.z
        if (now >= bomb.fuseEndsAt) this.explodeBomb(now)
      }
    }
    if (r.type === 'sweeper') {
      const sweeper = r.sweeper
      const elapsed = Math.max(0, now - this.roundStartedAt)
      const ramp = Math.min(1, elapsed / Math.max(1, this.phaseEndsAt - this.roundStartedAt))
      sweeper.speed = SWEEPER_BASE_SPEED + (SWEEPER_MAX_SPEED - SWEEPER_BASE_SPEED) * ramp
      if (now >= sweeper.reverseAt && !sweeper.warnUntil) {
        sweeper.warnUntil = now + SWEEPER_WARN_MS
        sweeper.reverseAt = now + SWEEPER_REVERSE_EVERY_MS + SWEEPER_WARN_MS
        this.emitEvent('sweeper_warn', '막대가 잠시 뒤 반대로 돈다! 준비!', { warnUntil: sweeper.warnUntil })
      }
      if (sweeper.warnUntil && now >= sweeper.warnUntil) {
        sweeper.direction *= -1
        sweeper.warnUntil = 0
        this.emitEvent('sweeper_reverse', '막대 방향 반전!', { direction: sweeper.direction })
      }
      sweeper.angle += sweeper.speed * sweeper.direction * dt
      if (sweeper.angle > Math.PI * 2 || sweeper.angle < -Math.PI * 2) sweeper.angle %= Math.PI * 2
      for (const p of this.connected()) {
        if (p.respawning) continue
        p.roundScore += dt * SWEEPER_SURVIVE_RATE
        const radius = Math.hypot(p.x, p.z)
        if (radius < 1.25 || radius > sweeper.radius) continue
        const theta = Math.atan2(p.z, p.x)
        const width = Math.min(1.2, SWEEPER_BAR_HALF / Math.max(0.6, radius))
        if (angleGap(theta, sweeper.angle) > width) continue
        if (p.jumpY > SWEEPER_CLEAR_JUMP || now < p.prankImmuneUntil) continue
        // 막대에 맞으면 접선 방향으로 강하게 튕겨 나가 장외 위험이 생긴다.
        const tangent = sweeper.angle + (sweeper.direction > 0 ? Math.PI / 2 : -Math.PI / 2)
        p.vx += (Math.cos(tangent) + Math.sign(p.x || 1) * 0.45) * SWEEPER_HIT_IMPULSE * 0.7
        p.vz += (Math.sin(tangent) + Math.sign(p.z || 1) * 0.45) * SWEEPER_HIT_IMPULSE * 0.7
        p.jumpV = Math.max(p.jumpV, 4.4)
        p.prankImmuneUntil = now + SWEEPER_HIT_IMMUNE_MS
        p.staggerUntil = now + 700
        p.knockdownUntil = now + 500
        p.motion = 'Hit'; p.motionUntil = now + 800
        p.sweeperHitAt = now
        sweeper.hits++
        this.bump(p, 'sweeperHits')
        const assist = p.lastPrankedBy && now - p.lastPrankedAt <= SWEEPER_ASSIST_WINDOW_MS ? this.players.get(p.lastPrankedBy) : null
        if (assist && assist.id !== p.id) {
          assist.roundScore += SWEEPER_ASSIST_POINTS
          this.bump(assist, 'sweeperAssists')
          this.emitEvent('sweeper_assist', `${assist.name}님이 ${p.name}님을 막대에 밀어 넣었다! +${SWEEPER_ASSIST_POINTS}P`, { attackerId: assist.id, targetId: p.id, x: p.x, z: p.z, itemType: 'sweeper' })
        } else {
          this.emitEvent('sweeper_hit', `${p.name}님이 회전 막대에 맞고 튕겨 나갔다!`, { playerId: p.id, x: p.x, z: p.z, itemType: 'sweeper' })
        }
      }
    }
    if (r.type === 'tail') {
      for (const id of r.tails) {
        const owner = this.players.get(id)
        if (!owner || owner.respawning) continue
        owner.roundScore += dt * TAIL_SCORE_RATE
        owner.tailTime += dt
        owner.contribution = Math.floor(owner.roundScore)
      }
    }
    if (r.type === 'platform') {
      if (Date.now() >= r.pulseAt) {
        r.targetColor = PLATFORM_COLORS[Math.floor(Math.random() * PLATFORM_COLORS.length)]
        r.pulseAt = Date.now() + 5000
        this.targetColor = r.targetColor
        this.emitEvent('target', `안전 색상: ${this.platforms.find(p => p.color === r.targetColor)?.color ?? ''}`)
      }
      for (const p of this.connected()) {
        if (p.respawning) continue
        const safe = this.platforms.some(tile => tile.color === r.targetColor && Math.hypot(p.x - tile.x, p.z - tile.z) < 1.9)
        if (safe) { p.roundScore += dt * 10; p.contribution = Math.floor(p.roundScore) }
        else if (p.jumpY <= 0.01 && Math.hypot(p.x, p.z) > 1.2) this.startRespawn(p, 'tile')
      }
    }
  }
  separatePlayers() {
    const players = this.connected()
    for (const a of players) for (const b of players) {
      if (a.seat >= b.seat || a.respawning || b.respawning) continue
      const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz)
      if (d > 0 && d < 1.15) { const nx = dx / d, nz = dz / d; a.x -= nx * 0.025; a.z -= nz * 0.025; b.x += nx * 0.025; b.z += nz * 0.025; a.vx -= nx * 0.3; a.vz -= nz * 0.3; b.vx += nx * 0.3; b.vz += nz * 0.3 }
    }
  }
  tick(now) {
    this.lastActivity = now
    if (this.phase === 'countdown') {
      if (now >= this.phaseEndsAt) this.beginPlay()
      else this.broadcast()
      return
    }
    if (this.phase === 'lobby') {
      for (const item of this.practiceItems) {
        if (item.consumed && now >= item.respawnAt) item.consumed = false
      }
      const dummy = this.practiceDummy
      const holder = this.players.get(dummy.grabbedBy)
      if (dummy.grabbedBy && !holder?.socket?.connected) dummy.grabbedBy = ''
      for (const p of this.actionTargets()) this.updatePlayer(p, TICK_MS / 1000)
      this.separatePlayers()
      if (!dummy.grabbedBy && now >= dummy.motionUntil && Math.hypot(dummy.vx, dummy.vz) < .1) {
        dummy.x += (PRACTICE_DUMMY_SPAWN.x - dummy.x) * .08
        dummy.z += (PRACTICE_DUMMY_SPAWN.z - dummy.z) * .08
      }
      this.broadcast()
      return
    }
    if (this.phase === 'play' && this.round?.completed) {
      if (now >= this.phaseEndsAt) this.finishRound()
      else this.broadcast()
      return
    }
    if (this.phase === 'play') {
      const dt = TICK_MS / 1000
      for (const p of this.connected()) {
        if (p.respawning) { if (now >= p.respawnAt) this.completeRespawn(p); continue }
        if (p.isBot) this.updateBotInput(p, now)
        this.updatePlayer(p, dt)
      }
      this.updateTether(dt)
      if (this.round?.type === 'vault') moveVaultHazards(this.round, dt)
      this.updateMega(dt)
      this.separatePlayers()
      this.updateRound(dt)
      if (now >= this.phaseEndsAt) this.finishRound()
      else if (this.round?.type === 'banana' && this.round.delivered >= this.definition.target) this.finishRound()
      else if (this.round?.type === 'pizza' && this.round.delivered >= this.round.total) this.finishRound()
      else if (this.round?.type === 'balloon' && this.round.delivered >= this.definition.target) this.finishRound()
      else if (['switch', 'vault'].includes(this.round?.type) && this.round.total > 0 && this.round.delivered >= this.round.total) {
        this.round.completed = true
        this.phaseEndsAt = now + COOP_SUCCESS_DISPLAY_MS
      }
      this.broadcast()
      return
    }
    if (this.phase === 'result' && now >= this.phaseEndsAt) {
      if (this.roundIndex >= this.plan.length - 1) this.finalise()
      else { this.roundIndex++; this.startCountdown() }
    }
  }
  snapshot(extra = {}, viewerId = '') {
    const def = this.definition
    return {
      marker: MARKER, code: this.code, phase: this.phase, roundIndex: this.roundIndex,
      round: def ? { ...def, completed: Boolean(this.round?.completed), timeLeft: ['play', 'countdown'].includes(this.phase) ? Math.max(0, (this.phaseEndsAt - Date.now()) / 1000) : 0 } : null,
      ...(this.phase === 'countdown' && { intro: this.intro }),
      phaseEndsAt: this.phaseEndsAt, hostId: this.hostId, players: this.allPlayers().map(p => playerSnapshot(p, viewerId, this.round?.tails || [])),
      matchSettings: { roundCount: this.roundCount, botCount: this.botCount },
      plan: this.plan.map(entry => ({ id: entry.id, mode: entry.mode, title: entry.title, short: entry.short, duration: entry.duration })),
      cooldownMs: ACTION_COOLDOWN_MS,
      objects: this.phase === 'lobby' ? {
        type: 'practice',
        practiceDummy: playerSnapshot(this.practiceDummy),
        prankItems: this.practiceItems.filter(item => !item.consumed),
      } : this.round ? this.serializedObjects() : {},
      platforms: this.platforms,
      pairs: this.pairs.map(pair => ({ a: pair.a, b: pair.b, length: Number((pair.length || 0).toFixed(2)), tension: Number((pair.tension || 0).toFixed(2)), rest: TETHER_REST, max: TETHER_MAX })),
      targetColor: this.targetColor, result: this.roundResult, event: this.event, ...extra,
    }
  }
  serializedObjects() {
    if (!this.round) return {}
    const mega = this.round.mega ? { ...this.round.mega, carriers: [...this.round.mega.carriers] } : null
    const prankItems = this.round.prankItems?.filter(o => !o.consumed).map(o => ({ ...o })) ?? []
    const tails = (this.round.tails || []).map(id => ({ id, color: this.players.get(id)?.color || '#ff5d8f' }))
    if (this.round.type === 'herd') return { type: 'herd', ...herdSnapshot(this.round), prankItems }
    if (this.round.type === 'switch') return { type: 'switch', ...switchSnapshot(this.round) }
    if (this.round.type === 'vault') return { type: 'vault', hazards: this.round.hazards, delivered: this.round.delivered, total: this.round.total, mega }
    if (this.round.type === 'banana') return { type: 'banana', items: this.round.bananas.filter(o => !o.delivered && !o.broken).map(o => ({ ...o })), delivery: this.round.delivery, delivered: this.round.delivered, prankItems, mega, tails }
    if (this.round.type === 'pizza') return { type: 'pizza', items: this.round.ingredients.filter(o => !o.delivered && !o.broken).map(o => ({ ...o })), station: this.round.station, delivered: this.round.delivered, total: this.round.total, prankItems, mega, tails }
    if (this.round.type === 'crown') return { type: 'crown', crown: this.round.crown, prankItems, mega, tails }
    if (this.round.type === 'balloon') return { type: 'balloon', items: this.round.balloons.filter(o => !o.delivered && !o.broken).map(o => ({ ...o })), tower: this.round.tower, delivered: this.round.delivered, prankItems, mega, tails }
    if (this.round.type === 'bomb') {
      const bomb = this.round.bomb
      const holder = this.players.get(bomb.holder)
      return {
        type: 'bomb',
        bomb: { holder: bomb.holder, holderName: holder?.name || '', x: Number(bomb.x.toFixed(2)), z: Number(bomb.z.toFixed(2)), fuse: Math.max(0, Math.round((bomb.fuseEndsAt - Date.now()) / 100) / 10), passes: bomb.passes, booms: bomb.booms },
        prankItems, mega, tails,
      }
    }
    if (this.round.type === 'sweeper') {
      const sweeper = this.round.sweeper
      return {
        type: 'sweeper',
        sweeper: { angle: Number(sweeper.angle.toFixed(3)), speed: Number(sweeper.speed.toFixed(2)), direction: sweeper.direction, radius: sweeper.radius, warn: Math.max(0, sweeper.warnUntil - Date.now()), reverseIn: Math.max(0, sweeper.reverseAt - Date.now()), hits: sweeper.hits },
        prankItems, mega, tails,
      }
    }
    if (this.round.type === 'tail') return { type: 'tail', tails, stolen: this.round.tailStolen, prankItems, mega }
    return { type: 'platform', platforms: this.platforms, targetColor: this.round.targetColor, prankItems, mega, tails }
  }
}

const rooms = new Map()
const app = express()
app.get('/healthz', (_req, res) => res.json({ ok: true, marker: MARKER, rooms: rooms.size, uptime: process.uptime() }))
if (existsSync(STATIC_ROOT)) app.use(express.static(STATIC_ROOT, { etag: true, maxAge: '1h', index: 'index.html' }))
const httpServer = createServer(app)
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean)
const io = new Server(httpServer, { cors: { origin: allowedOrigins.length ? allowedOrigins : true, methods: ['GET', 'POST'] }, maxHttpBufferSize: 4096, pingInterval: 15000, pingTimeout: 10000 })

function roomFor(code) { if (!rooms.has(code)) rooms.set(code, new Room(code)); return rooms.get(code) }
function validCode(code) { return /^[A-Z0-9]{6}$/.test(code) }
function setupRoomSocket(socket, room, player) {
  socket.emit('state', room.snapshot())
  socket.on('input', input => room.handleInput(player, input))
  socket.on('toggle_ready', () => room.toggleReady(player))
  socket.on('match_settings', settings => room.configure(player, settings))
  socket.on('start_match', () => room.start(player, String(socket.handshake.auth?.botDifficulty || 'normal')))
  socket.on('start_single', difficulty => room.start(player, ['easy', 'normal', 'hard'].includes(difficulty) ? difficulty : 'normal'))
  socket.on('rematch', () => room.rematch(player))
  socket.on('update_profile', data => {
    if (room.phase !== 'lobby') return
    player.name = cleanName(data?.name)
    const ci = Number(data?.colorIndex)
    if (Number.isInteger(ci) && ci >= 0 && ci < COLORS.length) { player.colorIndex = ci; player.color = COLORS[ci]; player.colorName = COLOR_NAMES[ci] }
    room.broadcast()
  })
  socket.on('disconnect', () => room.detach(socket))
}
io.on('connection', socket => {
  const auth = socket.handshake.auth || {}
  let code = cleanCode(auth.room || socket.handshake.query?.room)
  if (!validCode(code)) code = makeCode()
  const room = roomFor(code)
  const player = room.attach(socket, auth)
  if (!player) { socket.disconnect(true); return }
  setupRoomSocket(socket, room, player)
})

setInterval(() => {
  const now = Date.now()
  for (const [code, room] of rooms) {
    room.tick(now)
    for (const p of room.allPlayers()) if (!p.socket && p.disconnectedAt && now - p.disconnectedAt > RECONNECT_GRACE_MS) room.players.delete(p.id)
    if (!room.players.size || (!room.connected().length && now - room.lastActivity > ROOM_IDLE_MS)) rooms.delete(code)
  }
}, TICK_MS).unref()

if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) throw new Error('Invalid PORT')
httpServer.listen(PORT, HOST, () => console.log(JSON.stringify({ marker: MARKER, status: 'listening', host: HOST, port: httpServer.address().port })))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => httpServer.close(() => process.exit(0)))
