import { describe, expect, test } from 'vitest'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { io } from 'socket.io-client'

const here = dirname(fileURLToPath(import.meta.url))
const serverDir = join(here, '..', 'server')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function startServer(env) {
  const child = spawn(process.execPath, ['authoritative_server.mjs'], {
    cwd: serverDir,
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0', STATIC_ROOT: join(here, '..', 'dist'), ...env },
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
  return { child, port: ready.port }
}

function connect(port, room, name, colorIndex) {
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
  throw new Error('state timeout')
}

async function play(port, room) {
  const a = await connect(port, room, '낙하A', 0)
  const b = await connect(port, room, '낙하B', 1)
  const viewA = view(a.socket)
  const viewB = view(b.socket)
  a.socket.emit('toggle_ready')
  b.socket.emit('toggle_ready')
  await sleep(120)
  a.socket.emit('start_match')
  await waitState(viewA, state => state.phase === 'play')
  return { a, b, viewA, viewB, id: a.welcome.player.id, idB: b.welcome.player.id }
}

describe('2초 즉시 리스폰', () => {
  test('아레나 밖으로 나가면 2초 카운트다운 뒤 안전 위치로 복귀하고 짧은 무적이 붙는다', async () => {
    const { child, port } = await startServer({ MM_ROUND_MS: '30000', MM_COUNTDOWN_MS: '400', MM_RESULT_MS: '600' })
    const session = await play(port, 'RESP01')
    try {
      const startedFalls = session.viewA.state.players.find(player => player.id === session.id).falls
      // 오른쪽 밖으로 계속 걸어 아레나 반지름(10m)을 넘긴다.
      const pushUntil = Date.now() + 2600
      while (Date.now() < pushUntil) {
        session.a.socket.emit('input', { x: 1, z: 0.15 })
        await sleep(50)
      }
      const falling = await waitState(session.viewA, state => state.players.find(player => player.id === session.id)?.respawning === true, 6000)
      const fallingMe = falling.players.find(player => player.id === session.id)
      expect(fallingMe.falls).toBeGreaterThan(startedFalls)
      expect(fallingMe.respawnIn).toBeGreaterThan(0)
      expect(fallingMe.respawnIn).toBeLessThanOrEqual(2000)
      const fallEvent = session.viewA.events.find(event => event.type === 'fall' && event.playerId === session.id)
      expect(fallEvent).toBeTruthy()
      expect(fallEvent.countdown).toBe(2000)

      const back = await waitState(session.viewA, state => state.players.find(player => player.id === session.id)?.respawning === false, 4000)
      const me = back.players.find(player => player.id === session.id)
      expect(Math.hypot(me.x, me.z)).toBeLessThan(10)
      expect(me.status.immune).toBeGreaterThan(0)
      expect(session.viewA.events.some(event => event.type === 'respawn' && event.playerId === session.id)).toBe(true)
    } finally {
      session.a.socket.disconnect()
      session.b.socket.disconnect()
      child.kill('SIGTERM')
      await once(child, 'exit').catch(() => {})
    }
  }, 30000)
})

describe('대환장 어워드', () => {
  test('매치 종료 시 실제 수치 기반 어워드 2~4개와 하이라이트 카드가 만들어진다', async () => {
    const { child, port } = await startServer({ MM_START_ROUND: '4', MM_ROUND_MS: '9000', MM_COUNTDOWN_MS: '400', MM_RESULT_MS: '500' })
    const session = await play(port, 'AWARD1')
    try {
      await sleep(2500)
      const final = await waitState(session.viewA, state => state.phase === 'final', 20000)
      const result = final.result
      expect(Array.isArray(result.awards)).toBe(true)
      expect(result.awards.length).toBeGreaterThanOrEqual(2)
      expect(result.awards.length).toBeLessThanOrEqual(4)
      for (const award of result.awards) {
        expect(typeof award.title).toBe('string')
        expect(award.title.length).toBeGreaterThan(1)
        expect(Array.isArray(award.names)).toBe(true)
        expect(award.names.length).toBeGreaterThanOrEqual(1)
        expect(award.ids.length).toBeGreaterThanOrEqual(1)
        // 모든 어워드는 실제 집계 수치를 문구에 담는다.
        expect(award.metric).toMatch(/\d/)
      }
      const kinds = result.awards.map(award => award.kind)
      expect(kinds).toContain('tumbler')
      const tumble = result.awards.find(award => award.kind === 'tumbler')
      expect(tumble.value).toBeGreaterThanOrEqual(1)

      expect(Array.isArray(result.highlights)).toBe(true)
      expect(result.highlights.length).toBeGreaterThanOrEqual(1)
      for (const line of result.highlights) {
        expect(line.text).toMatch(/\d/)
        expect(typeof line.label).toBe('string')
      }
      expect(result.rankings.length).toBe(2)
      expect(result.rankings.every(row => typeof row.respawns === 'number')).toBe(true)
      // 라운드 결과에도 실제 수치 리캡이 붙는다.
      expect(session.viewA.state.result.awards).toBeTruthy()
    } finally {
      session.a.socket.disconnect()
      session.b.socket.disconnect()
      child.kill('SIGTERM')
      await once(child, 'exit').catch(() => {})
    }
  }, 40000)
})
