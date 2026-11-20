import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { io } from 'socket.io-client'

const here = dirname(fileURLToPath(import.meta.url))
const serverDir = join(here, '..', 'server')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/** env를 달리하는 서버를 하나 띄우고 { child, port }를 준다. */
async function startServer(env = {}) {
  const child = spawn(process.execPath, ['authoritative_server.mjs'], {
    cwd: serverDir,
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0', STATIC_ROOT: join(here, '..', 'dist'), MM_COUNTDOWN_MS: '300', MM_RESULT_MS: '500', ...env },
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
  throw new Error(`state timeout (phase=${box.state?.phase}, objects=${box.state?.objects?.type})`)
}

const player = (box, id) => box.state?.players.find(p => p.id === id)

async function walkTo(socket, box, id, target, timeout = 8000, radius = 0.9) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const me = player(box, id)
    if (!me || box.state.phase !== 'play') break
    const dx = target.x - me.x, dz = target.z - me.z
    const distance = Math.hypot(dx, dz)
    if (distance < radius) break
    socket.emit('input', { x: dx / distance, z: dz / distance })
    await sleep(50)
  }
  socket.emit('input', { x: 0, z: 0 })
}

async function play(port, room, names = ['테스트A', '테스트B']) {
  const a = await connect(port, room, names[0], 0)
  const b = await connect(port, room, names[1], 1)
  const viewA = view(a.socket)
  const viewB = view(b.socket)
  a.socket.emit('toggle_ready'); b.socket.emit('toggle_ready')
  await sleep(120)
  a.socket.emit('start_match')
  await waitState(viewA, state => state.phase === 'play' || state.phase === 'countdown')
  return { a, b, viewA, viewB, idA: a.welcome.player.id, idB: b.welcome.player.id }
}

describe('11종 미니게임 풀에서 5라운드 랜덤 셔플', () => {
  let server
  beforeAll(async () => { server = await startServer({ MM_ROUND_MS: '60000' }) }, 25000)
  afterAll(async () => { if (server) { server.child.kill('SIGTERM'); await once(server.child, 'exit').catch(() => {}) } })

  test('매치마다 개인전 3 + 협동전 2, 중복 없는 5판이 뽑힌다', async () => {
    const plans = []
    for (let round = 0; round < 4; round++) {
      const session = await play(server.port, `PLAN0${round}`, ['계획A', '계획B'])
      try {
        const state = await waitState(session.viewA, value => value.phase === 'play', 15000)
        plans.push(state.plan)
        expect(state.plan.length).toBe(5)
        expect(state.round.id).toBe(state.plan[0].id)
        const ids = state.plan.map(entry => entry.id)
        expect(new Set(ids).size).toBe(5)
        const solo = state.plan.filter(entry => entry.mode === 'solo')
        const coop = state.plan.filter(entry => entry.mode === 'coop')
        expect(solo.length).toBe(3)
        expect(coop.length).toBe(2)
        for (const entry of coop) expect(['pizza', 'balloon', 'pair_switch', 'vault_delivery']).toContain(entry.id)
        for (const entry of solo) expect(['banana', 'crown', 'platform', 'hot_potato', 'sweeper', 'tail_tag', 'herd']).toContain(entry.id)
        // 협동전은 2·4라운드 자리(짝꿍 라운드)에 온다.
        expect(state.plan[1].mode).toBe('coop')
        expect(state.plan[3].mode).toBe('coop')
      } finally {
        session.a.socket.disconnect(); session.b.socket.disconnect()
      }
    }
    // 4번 뽑으면 최소 한 번은 서로 다른 조합이어야 한다(고정 순서가 아님).
    const signatures = new Set(plans.map(plan => plan.map(entry => entry.id).join(',')))
    expect(signatures.size).toBeGreaterThan(1)
  }, 60000)
})

describe('💣 시한폭탄 넘기기', () => {
  test('폭탄을 들고 있는 사람이 때리면 상대에게 넘어가고 넘긴 사람이 점수를 얻는다', async () => {
    const server = await startServer({ MM_ROUND_IDS: 'hot_potato', MM_BOMB_FUSE_MS: '45000', MM_ROUND_MS: '60000' })
    const session = await play(server.port, 'BOMB01', ['폭탄A', '폭탄B'])
    try {
      const live = await waitState(session.viewA, state => state.phase === 'play' && state.objects?.type === 'bomb' && Boolean(state.objects.bomb?.holder), 15000)
      expect(live.objects.bomb.fuse).toBeGreaterThan(0)
      const holderId = live.objects.bomb.holder
      const attacker = holderId === session.idA ? session.a : session.b
      const attackerId = holderId === session.idA ? session.idA : session.idB
      const targetId = attackerId === session.idA ? session.idB : session.idA
      const target = live.players.find(p => p.id === targetId)
      await walkTo(attacker.socket, session.viewA, attackerId, { x: target.x, z: target.z }, 15000)
      await waitState(session.viewA, state => {
        const me = state.players.find(p => p.id === attackerId), other = state.players.find(p => p.id === targetId)
        return Boolean(me && other && Math.hypot(me.x - other.x, me.z - other.z) <= 2.2)
      }, 8000)
      // 박치기 한 번이 상대를 장외로 밀 수 있으므로, 넘기지 못하면 다시 붙어 재시도한다.
      let passed = null
      for (let attempt = 0; attempt < 3 && !passed; attempt++) {
        const me = player(session.viewA, attackerId)
        const other = player(session.viewA, targetId)
        if (me && other && !me.respawning && !other.respawning) {
          await walkTo(attacker.socket, session.viewA, attackerId, { x: other.x, z: other.z }, 12000)
          attacker.socket.emit('input', { x: 0, z: 0, prank: true, prankType: 'headbutt' })
        }
        passed = await waitState(session.viewA, state => state.objects?.bomb?.holder === targetId, 4000).catch(() => null)
      }
      expect(passed).toBeTruthy()
      expect(passed.objects.bomb.passes).toBeGreaterThanOrEqual(1)
      expect(passed.players.find(p => p.id === attackerId).roundScore).toBeGreaterThanOrEqual(15)
      expect(session.viewA.events.some(event => event.type === 'bomb_pass')).toBe(true)
      // 넘김 무적(0.6초) 동안에는 곧바로 되돌아오지 않는다.
      expect(passed.objects.bomb.fuse).toBeGreaterThan(0)
    } finally {
      session.a.socket.disconnect(); session.b.socket.disconnect()
      server.child.kill('SIGTERM'); await once(server.child, 'exit').catch(() => {})
    }
  }, 45000)

  test('타이머가 0이 되면 든 사람이 2초 리스폰되고, 나머지 생존자가 점수를 받는다', async () => {
    const server = await startServer({ MM_ROUND_IDS: 'hot_potato', MM_BOMB_FUSE_MS: '1600', MM_ROUND_MS: '40000' })
    const session = await play(server.port, 'BOMB02', ['폭발A', '폭발B'])
    try {
      const live = await waitState(session.viewA, state => state.phase === 'play' && Boolean(state.objects?.bomb?.holder), 15000)
      const holderId = live.objects.bomb.holder
      const survivorId = holderId === session.idA ? session.idB : session.idA
      const before = live.players.find(p => p.id === survivorId).roundScore || 0
      const boom = await waitState(session.viewA, state => state.players.find(p => p.id === holderId)?.respawning === true, 10000)
      expect(boom.players.find(p => p.id === holderId).respawnIn).toBeGreaterThan(0)
      expect(boom.players.find(p => p.id === survivorId).roundScore).toBeGreaterThanOrEqual(before + 120)
      expect(session.viewA.events.some(event => event.type === 'bomb_boom')).toBe(true)
      const rearmed = await waitState(session.viewA, state => Boolean(state.objects?.bomb?.holder) && !state.players.find(p => p.id === state.objects.bomb.holder)?.respawning, 10000)
      expect(rearmed.objects.bomb.holder).not.toBe(holderId)
    } finally {
      session.a.socket.disconnect(); session.b.socket.disconnect()
      server.child.kill('SIGTERM'); await once(server.child, 'exit').catch(() => {})
    }
  }, 45000)
})

describe('🌪️ 빙글빙글 장애물 점프', () => {
  let server
  beforeAll(async () => { server = await startServer({ MM_ROUND_IDS: 'sweeper', MM_SWEEPER_SPEED: '3', MM_ROUND_MS: '30000' }) }, 25000)
  afterAll(async () => { if (server) { server.child.kill('SIGTERM'); await once(server.child, 'exit').catch(() => {}) } })

  test('막대가 돌고 아레나를 거의 덮으며, 서 있는 플레이어는 맞고 튕긴다', async () => {
    const session = await play(server.port, 'SWEEP1', ['회전A', '회전B'])
    try {
      const live = await waitState(session.viewA, state => state.phase === 'play' && state.objects?.type === 'sweeper', 15000)
      expect(live.objects.sweeper.radius).toBeGreaterThanOrEqual(8.5)
      const firstAngle = live.objects.sweeper.angle
      await sleep(400)
      const after = await waitState(session.viewA, state => state.objects.sweeper.angle !== firstAngle, 4000)
      expect(after.objects.sweeper.speed).toBeGreaterThan(0)

      // 서 있는 플레이어는 회전 막대에 맞아 비틀거리거나 넘어지고, 튕겨 나가거나 리스폰된다.
      const start = new Map(live.players.map(p => [p.id, { x: p.x, z: p.z }]))
      const hit = await waitState(session.viewA, state => session.viewA.events.some(event => event.type === 'sweeper_hit' || event.type === 'sweeper_assist') && state.phase === 'play', 12000)
      const event = session.viewA.events.find(entry => entry.type === 'sweeper_hit' || entry.type === 'sweeper_assist')
      const victimId = event.playerId || event.targetId
      const victim = hit.players.find(p => p.id === victimId)
      expect(victim).toBeTruthy()
      const origin = start.get(victimId)
      const travelled = origin ? Math.hypot(victim.x - origin.x, victim.z - origin.z) : 0
      const flung = (victim.status?.knockdown || 0) > 0 || (victim.status?.stagger || 0) > 0 || victim.respawning || travelled > 1.2
      expect(flung).toBe(true)
    } finally {
      session.a.socket.disconnect(); session.b.socket.disconnect()
    }
  }, 40000)
})

describe('🎯 꼬리 뺏기', () => {
  let server
  beforeAll(async () => { server = await startServer({ MM_ROUND_IDS: 'tail_tag', MM_ROUND_MS: '40000' }) }, 25000)
  afterAll(async () => { if (server) { server.child.kill('SIGTERM'); await once(server.child, 'exit').catch(() => {}) } })

  test('절반이 꼬리를 받고, 꼬리 보유자는 초당 점수를 얻으며, 꼬리 없는 사람이 때리면 강탈한다', async () => {
    const session = await play(server.port, 'TAIL01', ['꼬리A', '꼬리B'])
    try {
      const live = await waitState(session.viewA, state => state.phase === 'play' && state.objects?.type === 'tail' && (state.objects.tails || []).length === 1, 15000)
      const ownerId = live.objects.tails[0].id
      const chaserId = ownerId === session.idA ? session.idB : session.idA
      const chaser = chaserId === session.idA ? session.a : session.b
      const scoreStart = player(session.viewA, ownerId).roundScore
      await sleep(1200)
      const scored = await waitState(session.viewA, state => state.players.find(p => p.id === ownerId).roundScore > scoreStart, 5000)
      expect(scored.players.find(p => p.id === ownerId).roundScore).toBeGreaterThan(scoreStart)

      // 시작 무적(2.2초)이 지난 뒤 뒤에서 꿀밤을 맞으면 꼬리를 뺏긴다.
      await sleep(1500)
      const target = player(session.viewA, ownerId)
      await walkTo(chaser.socket, session.viewA, chaserId, { x: target.x, z: target.z }, 9000)
      await waitState(session.viewA, state => {
        const me = state.players.find(p => p.id === chaserId), other = state.players.find(p => p.id === ownerId)
        return Boolean(me && other && Math.hypot(me.x - other.x, me.z - other.z) <= 2.2)
      }, 8000)
      chaser.socket.emit('input', { x: 0, z: 0, prank: true, prankType: 'bonk' })
      const stolen = await waitState(session.viewA, state => (state.objects.tails || []).some(tail => tail.id === chaserId), 6000)
      expect((stolen.objects.tails || []).some(tail => tail.id === ownerId)).toBe(false)
      expect(session.viewA.events.some(event => event.type === 'tail_steal')).toBe(true)
      expect(stolen.players.find(p => p.id === chaserId).hasTail).toBe(true)
    } finally {
      session.a.socket.disconnect(); session.b.socket.disconnect()
    }
  }, 45000)
})

describe('신규 협동 라운드 서버 판정', () => {
  async function withRound(id, check) {
    const server = await startServer({ MM_ROUND_IDS: id, MM_ROUND_MS: '35000', MM_RESULT_MS: '2000' })
    try {
      const session = await play(server.port, 'COOP01')
      try {
        const live = await waitState(session.viewA, state => state.phase === 'play')
        await check(session, live)
      } finally {
        session.a.socket.disconnect()
        session.b.socket.disconnect()
      }
    } finally {
      server.child.kill('SIGTERM')
      await once(server.child, 'exit')
    }
  }

  test('한 발판이나 뒤바뀐 발판으로는 문을 열 수 없고 짝꿍이 자기 발판에 동시에 서면 공동 점수를 얻는다', async () => {
    await withRound('pair_switch', async ({ a, b, viewA, viewB, idA, idB }, live) => {
      const [left, right] = live.objects.gates[0].pads
      expect([left.id, right.id]).toEqual([idA, idB])
      await walkTo(b.socket, viewA, idB, left, 6500, 0.28)
      expect((await waitState(viewA, state => Math.hypot(player(viewA, idB).x - left.x, player(viewA, idB).z - left.z) < 0.55)).objects.gates[0].progress).toBe(0)
      await walkTo(b.socket, viewA, idB, right, 6500, 0.28)
      const single = await waitState(viewA, state => state.objects.gates[0].pads[1].down)
      expect(single.objects.gates[0].progress).toBe(0)
      await walkTo(a.socket, viewA, idA, left, 6500, 0.28)
      await waitState(viewA, state => state.objects.gates[0].progress > 0.1)
      a.socket.emit('input', { jump: true })
      await waitState(viewA, state => player(viewA, idA).jumpY > 0.15 && state.objects.gates[0].progress === 0)
      const result = await waitState(viewA, state => state.phase === 'result')
      expect(result.result.progress).toBe(1)
      expect(result.result.results.map(entry => entry.roundScore)).toEqual([250, 250])
      expect(viewA.events.filter(event => event.type === 'switch_open')).toHaveLength(1)
      await waitState(viewB, state => state.phase === 'result')
      expect(viewB.state.objects.gates[0].opened).toBe(true)
    })
  }, 30000)

  test('금고는 한 명이 잡으면 그대로 있고 방해물 접촉 후 다시 잡아 우회하면 배달된다', async () => {
    await withRound('vault_delivery', async ({ a, b, viewA, viewB, idA, idB }, live) => {
      const start = live.objects.mega
      const aGrip = { x: -0.65, z: start.z }
      const bGrip = { x: 0.65, z: start.z }
      async function bothMove(x, z) {
        await Promise.all([
          walkTo(a.socket, viewA, idA, { x: x - 0.65, z }, 6500, 0.26),
          walkTo(b.socket, viewA, idB, { x: x + 0.65, z }, 6500, 0.26),
        ])
      }
      await walkTo(a.socket, viewA, idA, aGrip, 6500, 0.28)
      a.socket.emit('input', { interact: true })
      await waitState(viewA, state => state.objects.mega.carriers.includes(idA))
      a.socket.emit('input', { z: -1 })
      await sleep(400)
      a.socket.emit('input', {})
      expect(viewA.state.objects.mega).toMatchObject({ x: start.x, z: start.z, delivered: false, carriers: [idA] })
      await walkTo(b.socket, viewA, idB, bGrip, 6500, 0.26)
      b.socket.emit('input', { interact: true })
      await waitState(viewA, state => state.objects.mega.carriers.length === 2)
      expect(viewA.state.objects.hazards[0].x).not.toBe(live.objects.hazards[0].x)

      // 중앙 통로를 정면으로 건너면 움직이는 장애물과 만난다.
      await bothMove(0, 1.75)
      await waitState(viewA, () => viewA.events.some(event => event.type === 'vault_hit'), 8000)
      expect(viewA.state.objects.mega.carriers).toEqual([])
      expect(viewA.state.objects.delivered).toBe(0)

      const dropped = viewA.state.objects.mega
      await bothMove(dropped.x, dropped.z + 0.65)
      await sleep(900)
      a.socket.emit('input', { interact: true }); b.socket.emit('input', { interact: true })
      await waitState(viewA, state => state.objects.mega.carriers.length === 2)
      await bothMove(5.75, dropped.z + 0.65)
      await bothMove(5.75, -5.0)
      await bothMove(0, -6.8)
      const state = await waitState(viewA, value => value.objects.mega.delivered, 4500)
      await waitState(viewA, () => viewA.events.some(event => event.type === 'round_result'), 3500)
      const result = viewA.events.find(event => event.type === 'round_result').result
      expect(result.progress).toBe(1)
      expect(state.objects.mega.delivered).toBe(true)
      expect(result.results.map(entry => entry.roundScore)).toEqual([420, 420])
      await waitState(viewB, value => value.objects.mega.delivered)
      expect(viewB.events.filter(event => event.type === 'vault_delivered')).toHaveLength(1)
    })
  }, 35000)
})
