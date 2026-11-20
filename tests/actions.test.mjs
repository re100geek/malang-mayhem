import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { io } from 'socket.io-client'

const here = dirname(fileURLToPath(import.meta.url))
const serverDir = join(here, '..', 'server')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

let child
let port

beforeAll(async () => {
  child = spawn(process.execPath, ['authoritative_server.mjs'], {
    cwd: serverDir,
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0', STATIC_ROOT: join(here, '..', 'dist'), MM_ROUND_IDS: 'banana', MM_ROUND_MS: '40000', MM_COUNTDOWN_MS: '400', MM_RESULT_MS: '600' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const ready = await new Promise((resolve, reject) => {
    let buffer = ''
    const timer = setTimeout(() => reject(new Error('server startup timeout')), 15000)
    child.stdout.on('data', chunk => {
      buffer += chunk
      const newline = buffer.indexOf('\n')
      if (newline >= 0) { clearTimeout(timer); resolve(JSON.parse(buffer.slice(0, newline))) }
    })
    child.once('exit', code => reject(new Error(`server exited ${code}`)))
  })
  port = ready.port
}, 20000)

afterAll(async () => {
  if (!child) return
  child.kill('SIGTERM')
  await once(child, 'exit').catch(() => {})
})

function connect(room, name, colorIndex) {
  return new Promise((resolve, reject) => {
    const socket = io(`http://127.0.0.1:${port}`, { transports: ['websocket'], auth: { room, name, colorIndex } })
    const timer = setTimeout(() => reject(new Error('welcome timeout')), 8000)
    socket.once('connect_error', reject)
    socket.once('welcome', welcome => { clearTimeout(timer); resolve({ socket, welcome }) })
  })
}

function view(socket) {
  const box = { state: null, events: [] }
  socket.on('state', value => { box.state = value })
  socket.on('event', value => { box.events.push(value) })
  return box
}

async function waitState(box, predicate, timeout = 20000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (box.state && predicate(box.state)) return box.state
    await sleep(40)
  }
  throw new Error(`state timeout (phase=${box.state?.phase}, players=${JSON.stringify(box.state?.players?.map(p => [p.name, Number(p.x.toFixed(2)), Number(p.z.toFixed(2)), p.respawning]))})`)
}

const player = (box, id) => box.state?.players.find(p => p.id === id)

async function walkTo(socket, box, id, target, timeout = 8000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const me = player(box, id)
    if (!me) break
    const dx = target.x - me.x, dz = target.z - me.z
    const distance = Math.hypot(dx, dz)
    if (distance < 0.9) break
    socket.emit('input', { x: dx / distance, z: dz / distance })
    await sleep(60)
  }
  socket.emit('input', { x: 0, z: 0 })
}

describe('행동별 쿨타임과 모션 장난 발동', () => {
  test('꿀밤·태클·포옹이 각각 발동하고 같은 동작은 쿨타임 동안 막힌다', async () => {
    const a = await connect('ACT001', '때리는A', 0)
    const b = await connect('ACT001', '맞는B', 1)
    const viewA = view(a.socket)
    const viewB = view(b.socket)
    try {
      a.socket.emit('toggle_ready'); b.socket.emit('toggle_ready')
      await sleep(120)
      a.socket.emit('start_match')
      const live = await waitState(viewA, state => state.phase === 'play')
      const idA = a.welcome.player.id
      const idB = b.welcome.player.id
      const target = live.players.find(p => p.id === idB)
      await walkTo(a.socket, viewA, idA, { x: target.x, z: target.z }, 9000)
      const near = await waitState(viewA, state => {
        const me = state.players.find(p => p.id === idA), other = state.players.find(p => p.id === idB)
        return Boolean(me && other && Math.hypot(me.x - other.x, me.z - other.z) <= 2.2)
      }, 8000)
      expect(near).toBeTruthy()

      const prankEvents = () => viewA.events.filter(event => event.type === 'prank')
      const fire = async (prankType, wait = 120) => { a.socket.emit('input', { x: 0, z: 0, prank: true, prankType }); await sleep(wait) }

      // 박치기: 쿨타임 1.5초, 연타는 막힌다.
      await fire('headbutt')
      await waitState(viewA, state => (state.players.find(p => p.id === idA)?.cooldowns?.headbutt || 0) > 1200, 3000)
      expect(prankEvents().some(event => event.itemType === 'headbutt')).toBe(true)
      const headbuttCount = prankEvents().length
      await fire('headbutt')
      await fire('headbutt', 350)
      expect(prankEvents().length).toBe(headbuttCount)
      expect(player(viewA, idA).cooldowns.headbutt).toBeGreaterThan(600)

      // 꿀밤: 별개의 쿨타임 → 박치기 쿨타임 중에도 발동, 대상은 1초 비틀거림.
      await sleep(700)
      await fire('bonk')
      const bonked = await waitState(viewA, state => (state.players.find(p => p.id === idB)?.status?.stagger || 0) > 100, 3000)
      expect(prankEvents().some(event => event.itemType === 'bonk')).toBe(true)
      expect(bonked.players.find(p => p.id === idA).cooldowns.bonk).toBeGreaterThan(1500)
      expect(bonked.players.find(p => p.id === idB).status.stagger).toBeGreaterThan(500)
      await fire('bonk')
      expect(prankEvents().filter(event => event.itemType === 'bonk').length).toBe(1)

      // 태클: 넘어짐(knockdown) 판정.
      await sleep(1000)
      await fire('tackle')
      const tackled = await waitState(viewA, state => (state.players.find(p => p.id === idB)?.status?.knockdown || 0) > 100, 3000)
      expect(prankEvents().some(event => event.itemType === 'tackle')).toBe(true)
      expect(tackled.players.find(p => p.id === idA).cooldowns.tackle).toBeGreaterThan(2500)
      expect(tackled.players.find(p => p.id === idB).status.knockdown).toBeGreaterThan(500)

      // 포옹: 공격자와 대상 둘 다 1.2초 느려진다.
      await sleep(1100)
      await fire('hug')
      const hugged = await waitState(viewA, state => (state.players.find(p => p.id === idB)?.status?.hug || 0) > 100, 3000)
      expect(prankEvents().some(event => event.itemType === 'hug')).toBe(true)
      expect(hugged.players.find(p => p.id === idA).status.hug).toBeGreaterThan(500)
      expect(hugged.players.find(p => p.id === idB).status.hug).toBeGreaterThan(500)
      expect(hugged.players.find(p => p.id === idA).cooldowns.hug).toBeGreaterThan(2000)
    } finally {
      a.socket.disconnect(); b.socket.disconnect()
    }
  }, 40000)

  test('잡기·던지기도 쿨타임이 있고 스냅샷에 남은 시간이 내려온다', async () => {
    const a = await connect('ACT002', '잡는A', 0)
    const b = await connect('ACT002', '잡히는B', 1)
    const viewA = view(a.socket)
    try {
      a.socket.emit('toggle_ready'); b.socket.emit('toggle_ready')
      await sleep(120)
      a.socket.emit('start_match')
      const live = await waitState(viewA, state => state.phase === 'play')
      const idA = a.welcome.player.id, idB = b.welcome.player.id
      const other = live.players.find(p => p.id === idB)
      await walkTo(a.socket, viewA, idA, { x: other.x, z: other.z }, 9000)
      await waitState(viewA, state => {
        const me = state.players.find(p => p.id === idA), target = state.players.find(p => p.id === idB)
        return Boolean(me && target && Math.hypot(me.x - target.x, me.z - target.z) <= 1.5)
      }, 8000)
      a.socket.emit('input', { x: 0, z: 0, interact: true })
      const grabbed = await waitState(viewA, state => state.players.find(p => p.id === idA)?.cooldowns?.grab > 0, 3000)
      expect(grabbed.players.find(p => p.id === idA).cooldowns.grab).toBeGreaterThan(200)
      expect(viewA.events.some(event => event.type === 'grab')).toBe(true)
    } finally {
      a.socket.disconnect(); b.socket.disconnect()
    }
  }, 30000)
})

describe('대기실 닉네임 변경', () => {
  test('대기실에서 바꾼 닉네임이 모든 클라이언트에 즉시 반영되고 정리된다', async () => {
    const a = await connect('REN001', '처음이름', 0)
    const b = await connect('REN001', '친구', 1)
    const viewA = view(a.socket)
    const viewB = view(b.socket)
    try {
      a.socket.emit('update_profile', { name: '  새이름  ', colorIndex: 2 })
      await waitState(viewB, state => state.players.some(p => p.name === '새이름'), 4000)
      expect(viewA.state.players.find(p => p.id === a.welcome.player.id).name).toBe('새이름')
      expect(viewA.state.players.find(p => p.id === a.welcome.player.id).color).toBe('#a877ff')

      a.socket.emit('update_profile', { name: '   ' })
      await waitState(viewB, state => state.players.some(p => p.id === a.welcome.player.id && p.name === '말랑이'), 4000)

      a.socket.emit('update_profile', { name: '가'.repeat(30) })
      const trimmed = await waitState(viewB, state => {
        const me = state.players.find(p => p.id === a.welcome.player.id)
        return me && me.name.length === 14
      }, 4000)
      expect(trimmed.players.find(p => p.id === a.welcome.player.id).name).toBe('가'.repeat(14))

      // 게임 중에는 이름을 바꿀 수 없다(서버가 무시).
      a.socket.emit('toggle_ready'); b.socket.emit('toggle_ready')
      await sleep(120)
      a.socket.emit('start_match')
      await waitState(viewA, state => state.phase === 'play')
      a.socket.emit('update_profile', { name: '게임중변경' })
      await sleep(500)
      expect(viewA.state.players.find(p => p.id === a.welcome.player.id).name).toBe('가'.repeat(14))
    } finally {
      a.socket.disconnect(); b.socket.disconnect()
    }
  }, 30000)
})
