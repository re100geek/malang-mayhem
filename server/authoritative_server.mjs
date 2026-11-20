#!/usr/bin/env node
import express from 'express'
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Server } from 'socket.io'

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
const PRANK_COOLDOWN_MS = 1350
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
const GRAB_RANGE = 1.65
const GRAB_DURATION_MS = 1800
const GRAB_COOLDOWN_MS = 1100
const GRAB_ESCAPE_PRESSES = 3
const THROW_IMPULSE = 12.5
const SHATTER_IMPULSE = 9.5
const JUMP_BUFFER_MS = 140
const COYOTE_MS = 110
const ROUND_DEFS = [
  { index: 0, mode: 'solo', title: '미끄덩 바나나 배달', short: '바나나를 들고 배달존으로!', duration: 75, target: 18 },
  { index: 1, mode: 'coop', title: '피자 공장 대참사', short: '재료를 모아 초대형 피자를 완성!', duration: 90, target: 12 },
  { index: 2, mode: 'solo', title: '왕관 좀 빌려줘', short: '왕관을 오래 쓰고 도망쳐!', duration: 75, target: 0 },
  { index: 3, mode: 'coop', title: '풍선탑을 지켜라', short: '풍선을 중앙 탑에 붙여라!', duration: 90, target: 16 },
  { index: 4, mode: 'solo', title: '우당탕 발판 축제', short: '안내 색 발판에서 살아남아!', duration: 75, target: 0 },
]
const SOLO_POINTS = [1000, 800, 650, 500, 400, 300, 200, 100]
const COLORS = ['#ff5d8f', '#57c7ff', '#a877ff', '#62e8aa', '#ffbd4a', '#ff7b68', '#61e0d1', '#f28dff']
const COLOR_NAMES = ['딸기', '소다', '포도', '민트', '레몬', '복숭아', '아쿠아', '라벤더']
const PLATFORM_COLORS = ['#ff5d8f', '#57c7ff', '#a877ff', '#62e8aa', '#ffbd4a', '#ff7b68']

const clamp = (n, min, max) => Math.max(min, Math.min(max, n))
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z)
const cleanName = value => String(value || '말랑이').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 14) || '말랑이'
const cleanCode = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
const token = () => randomBytes(18).toString('base64url')
const makeCode = () => randomBytes(4).toString('hex').slice(0, 6).toUpperCase()
const spawnFor = seat => {
  const i = Math.max(0, seat - 1)
  const angle = (i / 8) * Math.PI * 2
  return { x: Math.cos(angle) * 5.6, z: Math.sin(angle) * 5.6 }
}
const playerSnapshot = (p, viewerId = '') => ({
  id: p.id, seat: p.seat, name: p.name, color: p.color, colorName: p.colorName, bot: !!p.isBot,
  connected: !!p.isBot || !!p.socket?.connected, ready: p.ready, host: p.host,
  x: Number(p.x.toFixed(3)), z: Number(p.z.toFixed(3)), vx: Number(p.vx.toFixed(3)), vz: Number(p.vz.toFixed(3)),
  jumpY: Number(p.jumpY.toFixed(3)), carried: p.carried, score: p.score, soloScore: p.soloScore,
  contribution: p.contribution, roundScore: p.roundScore, falls: p.falls,
  prankCount: p.prankCount, prankSuccesses: p.prankSuccesses,
  prankCooldown: Math.max(0, p.prankCooldownUntil - Date.now()),
  secretMission: p.id === viewerId && p.secretMission ? { ...p.secretMission } : undefined,
  missionProgress: p.id === viewerId ? p.missionProgress : 0,
  missionComplete: p.id === viewerId ? p.missionComplete : false,
  grabbedBy: p.grabbedBy || '',
  action: p.motionUntil > Date.now() ? p.motion : 'Idle', status: { slip: Math.max(0, p.slipUntil - Date.now()), slow: Math.max(0, p.slowUntil - Date.now()), ink: Math.max(0, p.inkUntil - Date.now()), reverse: Math.max(0, p.reverseUntil - Date.now()), sticky: Math.max(0, p.stickyUntil - Date.now()), stagger: Math.max(0, p.staggerUntil - Date.now()), knockdown: Math.max(0, p.knockdownUntil - Date.now()), hug: Math.max(0, p.hugUntil - Date.now()), spin: Number(p.spin.toFixed(3)), immune: Math.max(0, p.prankImmuneUntil - Date.now()) },
})

function newPlayer(id, seat, name, colorIndex, isBot = false, botDifficulty = 'normal') {
  const spawn = spawnFor(seat)
  return {
    id, seat, name: cleanName(name), isBot, botDifficulty, nextAiAt: 0, colorIndex: Number.isInteger(colorIndex) && colorIndex >= 0 && colorIndex < COLORS.length ? colorIndex : (seat - 1) % COLORS.length,
    color: COLORS[Number.isInteger(colorIndex) && colorIndex >= 0 && colorIndex < COLORS.length ? colorIndex : (seat - 1) % COLORS.length],
    colorName: COLOR_NAMES[(Number.isInteger(colorIndex) && colorIndex >= 0 && colorIndex < COLORS.length ? colorIndex : (seat - 1) % COLORS.length)],
    token: token(), socket: null, disconnectedAt: 0, host: false, ready: false,
    x: spawn.x, z: spawn.z, vx: 0, vz: 0, jumpY: 0, jumpV: 0,
    input: { x: 0, z: 0, jump: false, interact: false, prank: false, prankType: 'headbutt' }, lastInputAt: 0, jumpBufferUntil: 0, coyoteUntil: 0,
    carried: '', score: 0, soloScore: 0, contribution: 0, roundScore: 0, falls: 0,
    crownTime: 0, roundAlive: true, prankCount: 0, prankSuccesses: 0, prankCooldownUntil: 0,
    slipUntil: 0, slowUntil: 0, inkUntil: 0, reverseUntil: 0, stickyUntil: 0, staggerUntil: 0, knockdownUntil: 0, hugUntil: 0, prankImmuneUntil: 0, spin: 0, motion: 'Idle', motionUntil: 0,
    secretMission: null, missionProgress: 0, missionComplete: false, lastBonkTargetId: '', grabbedBy: '', grabTargetId: '', grabUntil: 0, grabCooldownUntil: 0, escapePresses: 0,
  }
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
    this.eventId = 0
    this.event = null
    this.lastBroadcast = 0
    this.targetColor = PLATFORM_COLORS[0]
    this.platforms = []
    this.objects = {}
  }

  get definition() { return this.roundIndex >= 0 ? ROUND_DEFS[this.roundIndex] : null }
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
      player.input = { x: 0, z: 0, jump: false, interact: false, prank: false, prankType: 'headbutt' }
      socket.data.room = this.code
      socket.data.playerId = player.id
      socket.emit('welcome', { marker: MARKER, code: this.code, resumeToken: player.token, player: playerSnapshot(player, player.id), resumed: true })
      this.broadcast()
      return player
    }
    if (this.players.size >= MAX_PLAYERS) {
      socket.emit('room_error', { code: 'full', message: '방이 가득 찼어요.' })
      return null
    }
    const id = socket.id
    const seat = this.players.size + 1
    player = newPlayer(id, seat, data.name, Number(data.colorIndex))
    player.host = !this.hostId
    if (player.host) this.hostId = player.id
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
    p.disconnectedAt = Date.now()
    p.ready = false
    if (p.host) {
      p.host = false
      const next = this.connected()[0]
      if (next) { next.host = true; this.hostId = next.id; this.emitEvent('host', `${next.name}님이 새 방장이에요.`) }
      else this.hostId = ''
    }
    if (this.phase === 'play' && this.humans().length === 0) this.setLobby('접속한 플레이어가 없어요.')
    this.broadcast()
  }
  setLobby(reason = '') {
    this.phase = 'lobby'; this.roundIndex = -1; this.phaseEndsAt = 0; this.round = null; this.roundResult = null
    for (const [id, p] of this.players) if (p.isBot) this.players.delete(id)
    for (const p of this.players.values()) { p.ready = false; p.score = 0; p.soloScore = 0; p.contribution = 0; p.roundScore = 0; p.carried = ''; p.falls = 0; p.prankCount = 0; p.prankSuccesses = 0; p.prankCooldownUntil = 0; p.secretMission = null; p.missionProgress = 0; p.missionComplete = false; p.grabbedBy = ''; p.grabTargetId = '' }
    if (reason) this.emitEvent('lobby', reason)
  }
  toggleReady(player) {
    if (this.phase !== 'lobby') return
    player.ready = !player.ready
    this.emitEvent('ready', `${player.name}님이 ${player.ready ? '준비 완료' : '준비 취소'}!`)
    this.broadcast()
  }
  start(player, difficulty = 'normal') {
    if (this.phase !== 'lobby' || player.id !== this.hostId || this.humans().length < 1) return false
    if (this.humans().length === 1) this.addBots(difficulty)
    this.roundIndex = 0
    this.startCountdown()
    return true
  }
  addBots(difficulty = 'normal') {
    const count = difficulty === 'easy' ? 1 : difficulty === 'hard' ? 3 : 2
    for (let i = 0; i < count && this.players.size < MAX_PLAYERS; i++) {
      const seat = this.players.size + 1
      const bot = newPlayer(`bot-${this.code}-${i + 1}`, seat, `말랑봇${i + 1}`, (seat - 1) % COLORS.length, true, difficulty)
      bot.ready = true
      this.players.set(bot.id, bot)
    }
    this.emitEvent('bots', `${count}명의 말랑봇이 참가했어요!`)
  }
  startCountdown() {
    const def = this.definition
    this.phase = 'countdown'
    this.phaseEndsAt = Date.now() + 3000
    this.roundStartedAt = 0
    for (const p of this.players.values()) { p.roundScore = 0; p.contribution = 0; p.crownTime = 0; p.carried = ''; p.roundAlive = true; p.input = { x: 0, z: 0, jump: false, interact: false, prank: false, prankType: 'headbutt' }; p.slipUntil = 0; p.slowUntil = 0; p.inkUntil = 0; p.reverseUntil = 0; p.stickyUntil = 0; p.staggerUntil = 0; p.knockdownUntil = 0; p.hugUntil = 0; p.prankImmuneUntil = 0; p.spin = 0; p.motion = 'Idle'; p.motionUntil = 0; p.grabbedBy = ''; p.grabTargetId = ''; p.grabUntil = 0; p.escapePresses = 0; p.missionProgress = 0; p.missionComplete = false; p.lastBonkTargetId = '' }
    this.round = this.buildRound(def)
    for (const p of this.players.values()) { const card = SECRET_MISSIONS[(p.seat - 1 + def.index) % SECRET_MISSIONS.length]; p.secretMission = { ...card } }
    this.emitEvent('round_intro', `${def.title} — ${def.short}`, { roundIndex: def.index, definition: def })
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
      return { id: `${def.index}-${i}`, x: Math.cos(a) * radius, z: Math.sin(a) * radius, carriedBy: '', delivered: false }
    })
    const prankItems = Array.from({ length: PRANK_ITEM_COUNT }, (_, i) => { const a = (i / PRANK_ITEM_COUNT) * Math.PI * 2 + Math.random() * .4; return { id: `prank-${def.index}-${i}`, type: PRANK_TYPES[i % PRANK_TYPES.length], x: Math.cos(a) * (4 + Math.random() * 4), z: Math.sin(a) * (4 + Math.random() * 4), consumed: false, spawnedAt: Date.now(), respawnAt: 0 } })
    if (def.index === 0) return { type: 'banana', bananas: around(18, 6.8), delivered: 0, delivery: { x: 0, z: -7 }, prankItems }
    if (def.index === 1) return { type: 'pizza', ingredients: Array.from({ length: 12 }, (_, i) => ({ id: `${i}`, kind: ['dough', 'sauce', 'cheese', 'pepperoni'][i % 4], x: Math.cos(i) * 7, z: Math.sin(i) * 7, carriedBy: '', delivered: false })), delivered: 0, total: 12, station: { x: 0, z: 0 }, prankItems }
    if (def.index === 2) return { type: 'crown', crown: { x: 0, z: 0, owner: '' }, prankItems }
    if (def.index === 3) return { type: 'balloon', balloons: around(16, 7), delivered: 0, tower: { x: 0, z: 0 }, prankItems }
    return { type: 'platform', platforms: this.platforms, targetColor: this.targetColor, pulseAt: Date.now() + 5000, prankItems }
  }
  beginPlay() {
    this.phase = 'play'; this.roundStartedAt = Date.now(); this.phaseEndsAt = this.roundStartedAt + this.definition.duration * 1000
    for (const p of this.connected()) { p.x = spawnFor(p.seat).x; p.z = spawnFor(p.seat).z; p.vx = 0; p.vz = 0; p.roundAlive = true }
    this.emitEvent('round_start', '출발!')
    this.broadcast()
  }
  finishRound() {
    if (this.phase !== 'play') return
    const def = this.definition
    const results = this.allPlayers().map(p => ({ id: p.id, name: p.name, seat: p.seat, color: p.color, roundScore: p.roundScore, contribution: p.contribution, points: 0, total: p.score }))
    if (def.mode === 'solo') {
      const order = [...this.allPlayers()].sort((a, b) => b.roundScore - a.roundScore || a.seat - b.seat)
      order.forEach((p, index) => { const points = SOLO_POINTS[index] || 0; p.score += points; p.soloScore += points; results.find(r => r.id === p.id).points = points; results.find(r => r.id === p.id).total = p.score })
    } else {
      const progress = def.index === 1 ? this.round.delivered / this.round.total : this.round.delivered / def.target
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
    results.sort((a, b) => b.total - a.total || b.roundScore - a.roundScore || a.seat - b.seat)
    this.roundResult = { roundIndex: this.roundIndex, title: def.title, mode: def.mode, results, progress: this.progressValue() }
    this.phase = 'result'; this.phaseEndsAt = Date.now() + 6500
    this.emitEvent('round_result', `${def.title} 결과가 나왔어요!`, { result: this.roundResult })
    this.broadcast()
  }
  progressValue() {
    if (!this.round) return 0
    if (this.round.type === 'banana' || this.round.type === 'balloon') return this.round.delivered / this.definition.target
    if (this.round.type === 'pizza') return this.round.delivered / this.round.total
    return 1
  }
  finalise() {
    const sorted = this.allPlayers().sort((a, b) => b.score - a.score || b.soloScore - a.soloScore || a.seat - b.seat)
    const top = sorted[0]
    const winners = top ? sorted.filter(p => p.score === top.score && p.soloScore === top.soloScore).map(p => p.id) : []
    this.phase = 'final'; this.phaseEndsAt = 0
    const prankster = [...this.allPlayers()].sort((a, b) => b.prankSuccesses - a.prankSuccesses || b.prankCount - a.prankCount)[0]
    this.roundResult = { winners, rankings: sorted.map((p, i) => ({ rank: i + 1, id: p.id, name: p.name, color: p.color, score: p.score, soloScore: p.soloScore, prankSuccesses: p.prankSuccesses })), bestPrankster: prankster ? { id: prankster.id, name: prankster.name, prankSuccesses: prankster.prankSuccesses } : null }
    this.emitEvent('final', top ? `${top.name}님, 말랑 챔피언!` : '공동 우승!')
    this.broadcast()
  }
  rematch(player) {
    if (this.phase !== 'final' || player.id !== this.hostId) return
    this.setLobby('새 게임 준비 완료!')
    this.broadcast()
  }
  handleInput(player, input) {
    if (!['lobby', 'countdown', 'play'].includes(this.phase)) return
    if (!input || typeof input !== 'object') return
    let ix = clamp(Number(input.x) || 0, -1, 1), iz = clamp(Number(input.z) || 0, -1, 1)
    const inputLength = Math.hypot(ix, iz); if (inputLength > 1) { ix /= inputLength; iz /= inputLength }
    player.input.x = ix; player.input.z = iz
    player.input.jump = !!input.jump
    if (player.input.jump) player.jumpBufferUntil = Date.now() + JUMP_BUFFER_MS
    player.input.interact = !!input.interact
    player.input.prank = !!input.prank
    player.input.prankType = MOTION_PRANKS.includes(input.prankType) ? input.prankType : 'headbutt'
    player.lastInputAt = Date.now()
  }
  nearbyObject(player, list) { return list.find(o => !o.delivered && !o.broken && (!o.carriedBy || o.carriedBy === player.id) && dist(player, o) <= 1.7) }
  dropCarried(target) {
    if (!target.carried) return false
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
  updateGrab(player) {
    const now = Date.now()
    if (player.grabTargetId) {
      const target = this.players.get(player.grabTargetId)
      if (!target || !target.socket?.connected && !target.isBot || now >= player.grabUntil) {
        if (target) { target.grabbedBy = ''; target.vx = player.vx * .35; target.vz = player.vz * .35 }
        player.grabTargetId = ''; return
      }
      target.x = clamp(player.x - (player.x - target.x) * .18, -WORLD_RADIUS, WORLD_RADIUS)
      target.z = clamp(player.z - (player.z - target.z) * .18, -WORLD_RADIUS, WORLD_RADIUS)
      target.vx = player.vx * .25; target.vz = player.vz * .25
      if (player.input.interact) {
        player.input.interact = false; player.grabTargetId = ''; target.grabbedBy = ''; target.vx = player.vx + (player.vx || 1) * THROW_IMPULSE; target.vz = player.vz + (player.vz || 0) * THROW_IMPULSE; target.jumpV = Math.max(target.jumpV, 4.2); target.motion = 'Hit'; target.motionUntil = now + 800; this.shatterCarried(target, 'throw'); this.emitEvent('throw', `${player.name}님이 ${target.name}님을 던졌다!`, { attackerId: player.id, targetId: target.id, x: target.x, z: target.z })
      }
      return
    }
    if (player.grabbedBy) {
      if (player.input.interact) { player.escapePresses++; player.input.interact = false; if (player.escapePresses >= GRAB_ESCAPE_PRESSES) { const holder = this.players.get(player.grabbedBy); if (holder) holder.grabTargetId = ''; player.grabbedBy = ''; player.escapePresses = 0; this.emitEvent('escape', `${player.name}님이 잡기에서 탈출!`) } }
      return
    }
    if (!player.input.interact || now < player.grabCooldownUntil) return
    const target = this.connected().filter(p => p.id !== player.id && !p.grabbedBy && dist(player, p) <= GRAB_RANGE).sort((a, b) => dist(player, a) - dist(player, b))[0]
    if (!target) return
    player.input.interact = false; player.grabTargetId = target.id; player.grabUntil = now + GRAB_DURATION_MS; player.grabCooldownUntil = now + GRAB_COOLDOWN_MS; target.grabbedBy = player.id; target.escapePresses = 0; this.emitEvent('grab', `${player.name}님이 ${target.name}님을 붙잡았다!`, { attackerId: player.id, targetId: target.id, x: target.x, z: target.z })
  }
  processPrank(attacker) {
    if (!attacker.input.prank || Date.now() < attacker.prankCooldownUntil) return
    attacker.input.prank = false
    const target = this.connected().filter(p => p.id !== attacker.id && dist(attacker, p) <= PRANK_RANGE).sort((a, b) => dist(attacker, a) - dist(attacker, b))[0]
    attacker.prankCooldownUntil = Date.now() + PRANK_COOLDOWN_MS
    if (!target || Date.now() < target.prankImmuneUntil) return
    const prankType = MOTION_PRANKS.includes(attacker.input.prankType) ? attacker.input.prankType : 'headbutt'
    const now = Date.now()
    const motionNames = { headbutt: 'Bonk', bonk: 'Bonk', tackle: 'Bonk', hug: 'Bonk' }
    attacker.motion = motionNames[prankType]; attacker.motionUntil = now + 700
    const dx = target.x - attacker.x, dz = target.z - attacker.z, length = Math.hypot(dx, dz) || 1
    const nx = dx / length, nz = dz / length
    target.prankImmuneUntil = now + PRANK_IMMUNITY_MS
    target.motion = 'Hit'; target.motionUntil = now + (prankType === 'tackle' ? TACKLE_KNOCKDOWN_MS : BONK_STAGGER_MS)
    if (prankType === 'bonk') { target.staggerUntil = now + BONK_STAGGER_MS; target.spin = (target.x + target.z) % 2 ? 4.8 : -4.8; target.vx += nx * 4.2; target.vz += nz * 4.2 }
    else if (prankType === 'tackle') { target.knockdownUntil = now + TACKLE_KNOCKDOWN_MS; target.vx += nx * 9.4; target.vz += nz * 9.4; target.jumpV = Math.max(target.jumpV, 1.6) }
    else if (prankType === 'hug') { attacker.hugUntil = now + HUG_SLOW_MS; target.hugUntil = now + HUG_SLOW_MS; target.vx *= .25; target.vz *= .25 }
    else { target.vx += nx * PRANK_IMPULSE; target.vz += nz * PRANK_IMPULSE; target.jumpV = Math.max(target.jumpV, PRANK_BOUNCE) }
    const edge = Math.hypot(target.x + nx * 1.25, target.z + nz * 1.25) >= WORLD_RADIUS - .35
    const dropped = Boolean(target.carried && (prankType === 'tackle' || target.jumpY < 1.1 || edge)) && this.dropCarried(target)
    if (dropped && attacker.secretMission?.kind === 'drop_two') attacker.missionProgress++
    if (edge && attacker.secretMission?.kind === 'ringout') attacker.missionProgress++
    if (prankType === 'bonk') attacker.lastBonkTargetId = target.id
    attacker.prankCount++
    if (edge || dropped || prankType !== 'hug') attacker.prankSuccesses++
    const names = { headbutt: '박치기', bonk: '꿀밤', tackle: '발 걸기 태클', hug: '젤리 꽁꽁 붙잡기' }
    const suffix = prankType === 'hug' ? ' 1.2초 꽁꽁 붙잡혔다!' : dropped ? ' 아이템을 떨어뜨렸다!' : edge ? ' 발판 밖으로 밀쳐냈다!' : ' 맞았다!'
    this.emitEvent('prank', `${attacker.name}님이 ${target.name}님에게 ${names[prankType]}!${suffix}`, { attackerId: attacker.id, targetId: target.id, dropped, edge, x: target.x, z: target.z, itemType: prankType })
  }
  applyPrankItem(player) {
    const items = this.round?.prankItems
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
    player.prankSuccesses++
    const names = { banana_peel: '바나나 껍질', jelly_pool: '끈적 젤리 웅덩이', shockwave: '뿅망치 충격파', reverse: '방향 반전' }
    this.emitEvent('prank_item', `${player.name}님이 ${names[item.type]} 장난!`, { itemType: item.type, playerId: player.id, x: player.x, z: player.z })
  }
  updatePlayer(player, dt) {
    const input = player.input
    const roundIndex = this.definition?.index ?? 0
    const reverse = Date.now() < player.reverseUntil ? -1 : 1
    const now = Date.now()
    const slipping = now < player.slipUntil
    const sticky = now < player.stickyUntil
    const speedFactor = player.grabbedBy ? .12 : now < player.knockdownUntil ? .08 : now < player.hugUntil ? .25 : now < player.staggerUntil ? .35 : now < player.slowUntil ? .42 : slipping ? BANANA_SLIP_ACCEL : 1
    const accel = sticky ? 8 : slipping ? 7 : (roundIndex === 0 ? MOVE_ACCEL : MOVE_ACCEL)
    const desiredX = input.x * reverse * MOVE_SPEED * speedFactor, desiredZ = input.z * reverse * MOVE_SPEED * speedFactor
    const currentSpeed = Math.hypot(player.vx, player.vz), braking = Math.hypot(desiredX, desiredZ) < currentSpeed
    player.vx += (desiredX - player.vx) * Math.min(1, (braking ? BRAKE_ACCEL : accel) * dt)
    player.vz += (desiredZ - player.vz) * Math.min(1, (braking ? BRAKE_ACCEL : accel) * dt)
    if (roundIndex === 0 || slipping || sticky) { const friction = slipping ? 0.994 : sticky ? 0.975 : 0.99; player.vx *= friction; player.vz *= friction }
    player.spin *= Math.pow(0.08, dt)
    if (player.jumpY <= 0.01) player.coyoteUntil = now + COYOTE_MS
    if (now < player.jumpBufferUntil && (player.jumpY <= 0.01 || now <= player.coyoteUntil)) { player.jumpV = JUMP_SPEED; player.jumpBufferUntil = 0 }
    player.jumpV -= GRAVITY * dt; player.jumpY = Math.max(0, player.jumpY + player.jumpV * dt); if (!player.jumpY) player.jumpV = 0
    const nextX = player.x + player.vx * dt, nextZ = player.z + player.vz * dt
    player.x = clamp(nextX, -WORLD_RADIUS, WORLD_RADIUS); player.z = clamp(nextZ, -WORLD_RADIUS, WORLD_RADIUS)
    if ((Math.abs(player.x) >= WORLD_RADIUS || Math.abs(player.z) >= WORLD_RADIUS) && Math.hypot(player.vx, player.vz) >= SHATTER_IMPULSE) this.shatterCarried(player, 'wall')
    this.updateGrab(player)
    this.processPrank(player)
    this.updateInteraction(player)
    this.applyPrankItem(player)
    input.jump = false; input.interact = false
  }
  updateBotInput(bot, now) {
    if (!bot.isBot || this.phase !== 'play' || now < bot.nextAiAt) return
    const intervals = { easy: 260, normal: 165, hard: 95 }
    bot.nextAiAt = now + (intervals[bot.botDifficulty] || intervals.normal)
    const r = this.round
    let target = this.connected().filter(p => p.id !== bot.id).sort((a, b) => dist(bot, a) - dist(bot, b))[0]
    let objective = target
    const list = r?.type === 'banana' ? r.bananas : r?.type === 'pizza' ? r.ingredients : r?.type === 'balloon' ? r.balloons : []
    if (bot.carried) objective = r?.delivery || r?.station || r?.tower || objective
    else if (list.length) objective = list.filter(o => !o.delivered && !o.carriedBy).sort((a, b) => dist(bot, a) - dist(bot, b))[0] || objective
    else if (r?.type === 'crown') objective = r.crown.owner && r.crown.owner !== bot.id ? this.players.get(r.crown.owner) : r.crown
    else if (r?.type === 'platform') objective = this.platforms.find(p => p.color === r.targetColor) || objective
    if (objective) { const dx = objective.x - bot.x, dz = objective.z - bot.z, d = Math.hypot(dx, dz) || 1; bot.input.x = dx / d; bot.input.z = dz / d; bot.input.interact = d < 1.8 }
    if (target && dist(bot, target) <= PRANK_RANGE && Math.random() < (bot.botDifficulty === 'hard' ? .35 : bot.botDifficulty === 'normal' ? .18 : .08)) { bot.input.prank = true; bot.input.prankType = MOTION_PRANKS[Math.floor(Math.random() * MOTION_PRANKS.length)] }
    if (Math.random() < .025) bot.input.jump = true
  }
  updateInteraction(player) {
    const r = this.round
    if (!r || !player.input.interact) return
    if (r.type === 'banana') {
      if (player.carried) {
        if (dist(player, r.delivery) <= 2.2) {
          const item = r.bananas.find(b => b.id === player.carried)
          if (item) { item.carriedBy = ''; item.delivered = true; r.delivered++; player.roundScore++; player.contribution++ }
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
          if (item) { item.carriedBy = ''; item.delivered = true; r.delivered++; player.contribution++; player.roundScore++ }
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
          if (item) { item.carriedBy = ''; item.delivered = true; r.delivered++; player.contribution++; player.roundScore++ }
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
    if (r.type === 'crown') {
      if (r.crown.owner) {
        const owner = this.players.get(r.crown.owner)
        if (owner) { owner.crownTime += dt; owner.roundScore = Math.floor(owner.crownTime * 10); owner.contribution = owner.roundScore }
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
        const safe = this.platforms.some(tile => tile.color === r.targetColor && Math.hypot(p.x - tile.x, p.z - tile.z) < 1.9)
        if (safe) { p.roundScore += dt * 10; p.contribution = Math.floor(p.roundScore) }
        else if (p.jumpY <= 0.01 && Math.hypot(p.x, p.z) > 1.2) { p.falls++; p.x = spawnFor(p.seat).x; p.z = spawnFor(p.seat).z; p.vx = 0; p.vz = 0 }
      }
    }
  }
  tick(now) {
    this.lastActivity = now
    if (this.phase === 'countdown' && now >= this.phaseEndsAt) { this.beginPlay(); return }
    if (this.phase === 'lobby' || this.phase === 'countdown' || this.phase === 'play') {
      const dt = TICK_MS / 1000
      for (const p of this.connected()) { if (p.isBot) this.updateBotInput(p, now); this.updatePlayer(p, dt) }
      for (const a of this.connected()) for (const b of this.connected()) {
        if (a.seat >= b.seat) continue
        const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz)
        if (d > 0 && d < 1.15) { const nx = dx / d, nz = dz / d; a.x -= nx * 0.025; a.z -= nz * 0.025; b.x += nx * 0.025; b.z += nz * 0.025; a.vx -= nx * 0.3; a.vz -= nz * 0.3; b.vx += nx * 0.3; b.vz += nz * 0.3 }
      }
      if (this.phase === 'play') this.updateRound(dt)
      if (this.phase === 'lobby') { this.broadcast(); return }
      if (this.phase === 'countdown') { this.broadcast(); return }
      if (now >= this.phaseEndsAt) this.finishRound()
      else if (this.round?.type === 'banana' && this.round.delivered >= this.definition.target) this.finishRound()
      else if (this.round?.type === 'pizza' && this.round.delivered >= this.round.total) this.finishRound()
      else if (this.round?.type === 'balloon' && this.round.delivered >= this.definition.target) this.finishRound()
      this.broadcast()
      return
    }
    if (this.phase === 'result' && now >= this.phaseEndsAt) {
      if (this.roundIndex >= ROUND_DEFS.length - 1) this.finalise()
      else { this.roundIndex++; this.startCountdown() }
    }
  }
  snapshot(extra = {}, viewerId = '') {
    const def = this.definition
    return {
      marker: MARKER, code: this.code, phase: this.phase, roundIndex: this.roundIndex,
      round: def ? { ...def, timeLeft: this.phase === 'play' ? Math.max(0, (this.phaseEndsAt - Date.now()) / 1000) : (this.phase === 'countdown' ? Math.max(0, (this.phaseEndsAt - Date.now()) / 1000) : 0) } : null,
      phaseEndsAt: this.phaseEndsAt, hostId: this.hostId, players: this.allPlayers().map(p => playerSnapshot(p, viewerId)),
      objects: this.round ? this.serializedObjects() : {}, platforms: this.platforms,
      targetColor: this.targetColor, result: this.roundResult, event: this.event, ...extra,
    }
  }
  serializedObjects() {
    if (!this.round) return {}
    const prankItems = this.round.prankItems?.filter(o => !o.consumed).map(o => ({ ...o })) ?? []
    if (this.round.type === 'banana') return { type: 'banana', items: this.round.bananas.filter(o => !o.delivered && !o.broken).map(o => ({ ...o })), delivery: this.round.delivery, delivered: this.round.delivered, prankItems }
    if (this.round.type === 'pizza') return { type: 'pizza', items: this.round.ingredients.filter(o => !o.delivered && !o.broken).map(o => ({ ...o })), station: this.round.station, delivered: this.round.delivered, total: this.round.total, prankItems }
    if (this.round.type === 'crown') return { type: 'crown', crown: this.round.crown, prankItems }
    if (this.round.type === 'balloon') return { type: 'balloon', items: this.round.balloons.filter(o => !o.delivered && !o.broken).map(o => ({ ...o })), tower: this.round.tower, delivered: this.round.delivered, prankItems }
    return { type: 'platform', platforms: this.platforms, targetColor: this.round.targetColor, prankItems }
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
