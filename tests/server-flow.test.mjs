import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { io } from 'socket.io-client'

const here = dirname(fileURLToPath(import.meta.url))
const serverDir = join(here, '..', 'server')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

let child
let port

beforeAll(async () => {
  child = spawn(process.execPath, ['authoritative_server.mjs'], {
    cwd: serverDir,
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0', STATIC_ROOT: join(here, '..', 'dist'), MM_ROUND_IDS: 'banana' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const ready = await new Promise((resolve, reject) => {
    let buffer = ''
    const timer = setTimeout(() => reject(new Error('server startup timeout')), 15000)
    child.stdout.on('data', chunk => {
      buffer += chunk
      const newline = buffer.indexOf('\n')
      if (newline >= 0) {
        clearTimeout(timer)
        resolve(JSON.parse(buffer.slice(0, newline)))
      }
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
    socket.once('welcome', welcome => {
      clearTimeout(timer)
      resolve({ socket, welcome })
    })
  })
}

function latest(socket) {
  const view = { state: null }
  socket.on('state', value => { view.state = value })
  return view
}

async function waitFor(view, predicate, timeout = 12000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (view.state && predicate(view.state)) return view.state
    await sleep(40)
  }
  throw new Error('state timeout')
}

async function startMatch(room) {
  const a = await connect(room, '테스트A', 0)
  const b = await connect(room, '테스트B', 1)
  const viewA = latest(a.socket)
  const viewB = latest(b.socket)
  a.socket.emit('toggle_ready')
  b.socket.emit('toggle_ready')
  await sleep(150)
  a.socket.emit('start_match')
  const live = await waitFor(viewA, state => state.phase === 'play')
  return { a, b, viewA, viewB, live }
}

describe('server authority', () => {
  test('각 플레이어는 자기에게만 보이는 비밀 장난 미션을 받는다', async () => {
    const { a, b, viewA, viewB, live } = await startMatch('MSN123')
    try {
      expect(live.phase).toBe('play')
      const meA = live.players.find(player => player.name === '테스트A')
      expect(meA.secretMission).toBeTruthy()
      expect(['bonk_winner', 'drop_two', 'ringout']).toContain(meA.secretMission.kind)
      expect(meA.secretMission.target).toBeGreaterThanOrEqual(1)
      expect(meA.missionProgress).toBe(0)
      // 상대의 비밀 미션은 내 화면에 노출되지 않는다
      expect(live.players.find(player => player.name === '테스트B').secretMission).toBeUndefined()
      const meB = viewB.state.players.find(player => player.name === '테스트B')
      expect(meB.secretMission).toBeTruthy()
      expect(viewB.state.players.find(player => player.name === '테스트A').secretMission).toBeUndefined()
    } finally {
      a.socket.disconnect()
      b.socket.disconnect()
    }
  }, 25000)

  test('사거리 밖 잡기 요청은 서버가 거부한다', async () => {
    const { a, b, viewA } = await startMatch('GRB456')
    const events = []
    a.socket.on('event', event => events.push(event.type))
    try {
      // 두 플레이어는 서로 떨어진 자리에서 스폰되므로 잡기 요청이 성립하지 않는다
      for (let press = 0; press < 4; press++) {
        a.socket.emit('input', { x: 0, z: 0, jump: false, interact: true })
        await sleep(120)
      }
      await sleep(300)
      expect(events).not.toContain('grab')
      const state = viewA.state
      expect(state.players.find(player => player.name === '테스트B').grabbedBy).toBe('')
    } finally {
      a.socket.disconnect()
      b.socket.disconnect()
    }
  }, 25000)

  test('health 엔드포인트가 게임 마커를 노출한다', async () => {
    const body = await fetch(`http://127.0.0.1:${port}/healthz`).then(response => response.json())
    expect(body.marker).toBe('malang-mayhem-v1')
  }, 10000)
})
