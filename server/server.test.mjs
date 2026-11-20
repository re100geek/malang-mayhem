import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { io } from 'socket.io-client'

async function startServer() {
  const child = spawn(process.execPath, ['authoritative_server.mjs'], { cwd: import.meta.dirname, env: { ...process.env, HOST: '127.0.0.1', PORT: '0', ALLOWED_ORIGINS: '' }, stdio: ['ignore', 'pipe', 'pipe'] })
  const line = await new Promise((resolve, reject) => {
    let output = ''
    const timer = setTimeout(() => reject(new Error('server startup timeout')), 10000)
    child.stdout.on('data', chunk => { output += chunk; const newline = output.indexOf('\n'); if (newline >= 0) { clearTimeout(timer); resolve(JSON.parse(output.slice(0, newline))) } })
    child.once('exit', code => reject(new Error(`server exited ${code}`)))
  })
  return { child, port: line.port }
}
function open(port, room, name, colorIndex) { return new Promise((resolve, reject) => { const socket = io(`http://127.0.0.1:${port}`, { transports: ['websocket'], auth: { room, name, colorIndex } }); const timer = setTimeout(() => reject(new Error('welcome timeout')), 6000); socket.once('connect_error', reject); socket.once('welcome', welcome => { clearTimeout(timer); resolve({ socket, welcome }) }) }) }
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
