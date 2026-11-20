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
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: '0',
      STATIC_ROOT: join(here, '..', 'dist'),
      MM_START_ROUND: '1',
      MM_ROUND_MS: '26000',
      MM_COUNTDOWN_MS: '400',
      MM_RESULT_MS: '600',
    },
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
  throw new Error('state timeout')
}

const me = (box, id) => box.state?.players.find(player => player.id === id)

/** 두 플레이어의 입력을 같은 박자로 보내 목표 지점까지 함께 걷는다. */
async function walkBoth(pairs, targets, timeout = 9000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    let arrived = 0
    for (let i = 0; i < pairs.length; i++) {
      const { socket, box, id } = pairs[i]
      const player = me(box, id)
      if (!player) continue
      const dx = targets[i].x - player.x, dz = targets[i].z - player.z
      const distance = Math.hypot(dx, dz)
      if (distance < 0.5) { socket.emit('input', { x: 0, z: 0 }); arrived++; continue }
      socket.emit('input', { x: dx / distance, z: dz / distance })
    }
    if (arrived === pairs.length) return true
    await sleep(50)
  }
  return false
}

async function walkOne(pair, target, timeout = 6000) {
  return walkBoth([pair], [target], timeout)
}

function press(pair) { pair.socket.emit('input', { x: 0, z: 0, interact: true }) }

describe('고무줄 짝꿍 & 2인 합동 운반', () => {
  test('협동 라운드에서 두 플레이어가 짝이 되어 고무줄로 연결되고, 황금 피자를 둘이서 배달한다', async () => {
    const a = await connect('PAIR01', '짝꿍A', 0)
    const b = await connect('PAIR01', '짝꿍B', 1)
    const viewA = view(a.socket)
    const viewB = view(b.socket)
    try {
      a.socket.emit('toggle_ready')
      b.socket.emit('toggle_ready')
      await sleep(120)
      a.socket.emit('start_match')
      const live = await waitState(viewA, state => state.phase === 'play' && state.roundIndex === 1)
      expect(live.round.mode).toBe('coop')

      // 짝지어짐: 서로를 partnerId로 가리키고, 서버가 고무줄 쌍을 하나 만든다.
      await waitState(viewA, state => state.pairs?.length === 1)
      const state = viewA.state
      const playerA = state.players.find(player => player.name === '짝꿍A')
      const playerB = state.players.find(player => player.name === '짝꿍B')
      expect(playerA.partnerId).toBe(playerB.id)
      expect(playerB.partnerId).toBe(playerA.id)
      expect(state.pairs[0]).toMatchObject({ a: playerA.id, b: playerB.id, rest: 3.4, max: 6.6 })

      // 고무줄 장력: 한 명이 점프하면 박자가 안 맞아 둘 다 휘청하고 'tether' 이벤트가 발생한다.
      const pairA = { socket: a.socket, box: viewA, id: playerA.id }
      a.socket.emit('input', { x: 0, z: 0, jump: true })
      const yanked = await waitState(viewA, s => (s.players.find(p => p.id === playerB.id)?.status.stagger || 0) > 0, 4000)
      expect(yanked.players.find(p => p.id === playerB.id).tetherYanks).toBeGreaterThanOrEqual(1)
      expect(viewA.events.some(event => event.type === 'tether')).toBe(true)

      // A만 반대편으로 걸어가도 서버 스프링이 당겨 거리가 최대 길이 안에서 유지된다.
      await walkOne(pairA, { x: 9.6, z: 6.6 }, 1800)
      const held = viewA.state
      const heldA = held.players.find(p => p.id === playerA.id)
      const heldB = held.players.find(p => p.id === playerB.id)
      expect(Math.hypot(heldA.x - heldB.x, heldA.z - heldB.z)).toBeLessThanOrEqual(6.6)
      expect(held.pairs[0].length).toBeLessThanOrEqual(6.6)
      expect(held.pairs[0].tension).toBeGreaterThan(0.001)

      // 합동 운반: 황금 피자는 혼자 들면 느리고, 둘이 함께 E로 들어야 빠르게 배달된다.
      const mega = viewA.state.objects.mega
      expect(mega).toBeTruthy()
      expect(mega.name).toBe('초대형 황금 피자')
      expect(mega.delivered).toBe(false)
      const pairB = { socket: b.socket, box: viewB, id: playerB.id }
      await walkBoth([pairA, pairB], [{ x: mega.x, z: mega.z + 1.1 }, { x: mega.x, z: mega.z - 1.1 }], 9000)
      press(pairA)
      const soloCarry = await waitState(viewA, s => s.objects.mega?.carriers.length === 1, 4000)
      // 혼자 들면 피자가 그 사람 발밑으로 끌려온다 → 짝꿍이 다시 붙어서 E.
      const dragged = soloCarry.objects.mega
      await walkOne(pairB, { x: dragged.x, z: dragged.z + 1.0 }, 5000)
      press(pairB)
      const carried = await waitState(viewA, s => s.objects.mega?.carriers.length === 2, 5000)
      expect(carried.players.find(p => p.id === playerA.id).carried).toBe('mega')
      expect(carried.players.find(p => p.id === playerB.id).carried).toBe('mega')

      // 둘이 같이 배달존까지 걸어가면 짝꿍 합동 배달 보너스가 들어온다.
      const zone = viewA.state.objects.mega.zone
      let delivered = false
      for (let attempt = 0; attempt < 3 && !delivered; attempt++) {
        await walkBoth([pairA, pairB], [{ x: zone.x, z: zone.z + 1 }, { x: zone.x, z: zone.z - 1 }], 7000)
        delivered = Boolean(viewA.state.objects.mega?.delivered)
        if (!delivered) {
          // 휘청해서 놓쳤다면 다시 잡고 재시도한다.
          const now = viewA.state.objects.mega
          await walkBoth([pairA, pairB], [{ x: now.x, z: now.z + 1.1 }, { x: now.x, z: now.z - 1.1 }], 6000)
          press(pairA); await sleep(150); press(pairB); await sleep(300)
        }
      }
      await waitState(viewA, s => s.objects.mega?.delivered === true, 4000)
      const after = viewA.state.players.find(player => player.id === playerA.id)
      expect(after.megaDuo).toBeGreaterThanOrEqual(1)
      expect(after.roundScore).toBeGreaterThanOrEqual(420)
      const duoEvent = viewA.events.find(event => event.type === 'mega' && event.duo === true)
      expect(duoEvent).toBeTruthy()
      expect(viewB.events.some(event => event.type === 'mega' && event.bonus === 420)).toBe(true)
    } finally {
      a.socket.disconnect()
      b.socket.disconnect()
    }
  }, 40000)
})
