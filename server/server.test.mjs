import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { io } from 'socket.io-client'

async function startServer(env = {}) {
  const child = spawn(process.execPath, ['authoritative_server.mjs'], { cwd: import.meta.dirname, env: { ...process.env, HOST: '127.0.0.1', PORT: '0', ALLOWED_ORIGINS: '', ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  const line = await new Promise((resolve, reject) => {
    let output = ''
    const timer = setTimeout(() => reject(new Error('server startup timeout')), 10000)
    child.stdout.on('data', chunk => { output += chunk; const newline = output.indexOf('\n'); if (newline >= 0) { clearTimeout(timer); resolve(JSON.parse(output.slice(0, newline))) } })
    child.once('exit', code => reject(new Error(`server exited ${code}`)))
  })
  return { child, port: line.port }
}
function open(port, room, name, colorIndex, settings = {}) { return new Promise((resolve, reject) => { const socket = io(`http://127.0.0.1:${port}`, { transports: ['websocket'], auth: { room, name, colorIndex, matchSettings: settings } }); const timer = setTimeout(() => reject(new Error('welcome timeout')), 6000); socket.once('connect_error', reject); socket.once('welcome', welcome => { clearTimeout(timer); resolve({ socket, welcome }) }) }) }
function state(socket, predicate) { return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('state timeout')), 7000); const handler = value => { if (predicate(value)) { clearTimeout(timer); socket.off('state', handler); resolve(value) } }; socket.on('state', handler) }) }

await test('two players join, room starts and server relays authoritative movement', async () => {
  const { child, port } = await startServer()
  const a = await open(port, 'TST123', '테스트A', 0)
  const b = await open(port, 'TST123', '테스트B', 1)
  try {
    assert.equal(a.welcome.marker, 'malang-mayhem-v1')
    assert.equal(a.welcome.code, 'TST123')
    a.socket.emit('toggle_ready'); b.socket.emit('toggle_ready'); await new Promise(r => setTimeout(r, 80)); a.socket.emit('start_match')
    const live = await state(a.socket, s => s.phase === 'play')
    assert.equal(live.players.length, 2)
    const interval = setInterval(() => a.socket.emit('input', { x: 1, z: 0, jump: false, interact: false }), 50)
    const moved = await state(b.socket, s => s.phase === 'play' && s.players.find(p => p.name === '테스트A')?.x > 5.8)
    clearInterval(interval)
    assert.ok(moved.players.find(p => p.name === '테스트A').x > 5.8)
  } finally {
    a.socket.disconnect(); b.socket.disconnect(); child.kill('SIGTERM'); await once(child, 'exit')
  }
})

test('health endpoint exposes MALANG MAYHEM marker', async () => {
  const { child, port } = await startServer()
  try { const body = await fetch(`http://127.0.0.1:${port}/healthz`).then(r => r.json()); assert.equal(body.marker, 'malang-mayhem-v1') }
  finally { child.kill('SIGTERM'); await once(child, 'exit') }
})

test('solo warmup has reusable hazards and an interactive dummy with isolated match state', async () => {
  const { child, port } = await startServer()
  const { socket, welcome } = await open(port, 'WARMUP', '테스트', 0)
  const player = s => s.players.find(p => p.id === welcome.player.id)
  try {
    const lobby = await state(socket, s => s.phase === 'lobby')
    assert.equal(lobby.players.length, 1)
    assert.deepEqual(lobby.objects.prankItems.map(item => item.type), ['banana_peel', 'jelly_pool'])
    assert.equal(lobby.objects.practiceDummy.id, 'practice-dummy')

    socket.emit('toggle_ready')
    await state(socket, s => player(s).ready)
    socket.emit('input', { jump: true })
    await state(socket, s => player(s).jumpY > .1)

    socket.emit('input', { x: -1 })
    const slipped = await state(socket, s => player(s).status.slip > 0)
    assert.equal(slipped.objects.prankItems.some(item => item.type === 'banana_peel'), false)
    socket.emit('input', { x: 0, z: 1 })
    await state(socket, s => player(s).z > 3.1)
    socket.emit('input', { x: 0, z: 0 })
    socket.emit('input', { interact: true })
    const grabbed = await state(socket, s => s.objects.practiceDummy?.grabbedBy === welcome.player.id)
    assert.equal(player(grabbed).score, 0)
    socket.emit('input', { prank: true, prankType: 'hug' })
    const hugged = await state(socket, s => s.objects.practiceDummy?.status.hug > 0)
    assert.equal(player(hugged).prankCount, 0)

    socket.emit('start_single', 'easy')
    const countdown = await state(socket, s => s.phase === 'countdown')
    assert.equal(countdown.players.length, 2)
    assert.equal(countdown.objects.practiceDummy, undefined)
    assert.equal(player(countdown).status.hug, 0)
    assert.equal(player(countdown).jumpY, 0)
    assert.equal(player(countdown).x, 5.6)
  } finally {
    socket.disconnect(); child.kill('SIGTERM'); await once(child, 'exit')
  }
})

test('host configures match length and bots and can restart directly in the same room', async () => {
  const { child, port } = await startServer({ MM_COUNTDOWN_MS: '350', MM_ROUND_MS: '450', MM_RESULT_MS: '300' })
  const a = await open(port, 'MATCH3', '테스트A', 0, { roundCount: 3, botCount: 5 })
  const b = await open(port, 'MATCH3', '테스트B', 1, { roundCount: 5, botCount: 2 })
  try {
    const initial = await state(a.socket, s => s.players.length === 2)
    assert.deepEqual(initial.matchSettings, { roundCount: 3, botCount: 5 })
    b.socket.emit('match_settings', { roundCount: 5, botCount: 2 })
    a.socket.emit('match_settings', { roundCount: 4, botCount: 6 })
    a.socket.emit('match_settings', { botCount: 4 })
    const updated = await state(b.socket, s => s.matchSettings?.botCount === 4)
    assert.deepEqual(updated.plan, initial.plan)
    const modes = ['solo', 'coop', 'solo']
    assert.deepEqual(updated.plan.map(round => round.mode), modes)
    assert.equal(new Set(updated.plan.map(round => round.id)).size, 3)

    a.socket.emit('start_match')
    const playing = await state(b.socket, s => s.phase === 'play')
    assert.equal(playing.players.length, 6)
    assert.deepEqual(playing.plan, updated.plan)
    const ended = await state(a.socket, s => s.phase === 'final')
    assert.equal(ended.roundIndex, 2)
    assert.ok(ended.result.rankings.some(row => row.score > 0))

    b.socket.emit('rematch')
    b.socket.emit('match_settings', { roundCount: 5, botCount: 5 })
    // A fresh observer sees the phase after both guest packets have been processed.
    await new Promise(resolve => setTimeout(resolve, 100))
    const observer = await open(port, 'MATCH3', '테스트C', 2)
    try {
      assert.equal((await state(observer.socket, () => true)).phase, 'final')
      const restarted = state(b.socket, s => s.phase === 'countdown')
      a.socket.emit('rematch')
      a.socket.emit('rematch')
      const fresh = await restarted
      assert.equal(fresh.code, ended.code)
      assert.equal(fresh.hostId, ended.hostId)
      assert.equal(fresh.roundIndex, 0)
      assert.deepEqual(fresh.matchSettings, updated.matchSettings)
      assert.equal(fresh.players.length, 7)
      assert.ok(fresh.players.every(player => player.score === 0))
      assert.deepEqual(fresh.plan.map(round => round.mode), modes)
      assert.equal(fresh.result, null)
    } finally {
      observer.socket.disconnect()
    }
  } finally {
    a.socket.disconnect(); b.socket.disconnect(); child.kill('SIGTERM'); await once(child, 'exit')
  }
})

test('intros share a server deadline, lock input and preview the first bomb holder', async () => {
  const { child, port } = await startServer({
    MM_ROUND_IDS: 'hot_potato,pair_switch,crown',
    MM_OPENING_MS: '500', MM_COUNTDOWN_MS: '500', MM_ROUND_MS: '1100', MM_RESULT_MS: '250',
  })
  const a = await open(port, 'CUT123', '말랑A', 0, { roundCount: 3 })
  const b = await open(port, 'CUT123', '말랑B', 1)
  try {
    const first = state(a.socket, s => s.phase === 'countdown')
    const guest = state(b.socket, s => s.phase === 'countdown')
    a.socket.emit('start_match')
    const [intro, peer] = await Promise.all([first, guest])
    assert.deepEqual(intro.intro, { openingMs: 500, roundMs: 500 })
    assert.equal(intro.phaseEndsAt, peer.phaseEndsAt)
    assert.equal(intro.objects.bomb.holder, peer.objects.bomb.holder)
    assert.ok(intro.objects.bomb.holder)
    assert.equal(intro.objects.bomb.fuse, 0)

    a.socket.emit('input', { x: 1, jump: true, prank: true })
    const preview = await state(a.socket, s => s.phase === 'countdown' && s.round.timeLeft < .5)
    assert.deepEqual(preview.players.map(p => [p.x, p.z, p.jumpY, p.roundScore]),
      intro.players.map(p => [p.x, p.z, 0, 0]))
    const live = await state(a.socket, s => s.phase === 'play')
    assert.equal(live.objects.bomb.holder, intro.objects.bomb.holder)
    assert.ok(live.objects.bomb.fuse > 11)
    assert.ok(live.phaseEndsAt >= intro.phaseEndsAt + 1100)

    const next = await state(a.socket, s => s.phase === 'countdown' && s.roundIndex === 1)
    assert.deepEqual(next.intro, { openingMs: 0, roundMs: 500 })
    assert.equal(next.pairs.length, 1)
  } finally {
    a.socket.disconnect(); b.socket.disconnect(); child.kill('SIGTERM'); await once(child, 'exit')
  }
})
