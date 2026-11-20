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
