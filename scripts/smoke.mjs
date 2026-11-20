import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { EventEmitter, once } from 'node:events'
import { chromium } from 'playwright'

const out = process.env.SHOTS_DIR ?? 'shots'
const captureScreenshots = process.env.SMOKE_SCREENSHOTS !== '0'
if (captureScreenshots) mkdirSync(out, { recursive: true })
async function screenshot(page, name) {
  if (!captureScreenshots) return
  await page.bringToFront()
  await page.screenshot({ path: join(out, name) })
}
if (!existsSync('dist/index.html')) throw new Error('smoke: run `pnpm build` first')
const site = mkdtempSync(join(tmpdir(), 'malang-mayhem-smoke-'))
cpSync('dist', site, { recursive: true })
const server = spawn(process.execPath, ['server/authoritative_server.mjs'], {
  env: {
    ...process.env, HOST: '127.0.0.1', PORT: '0', STATIC_ROOT: site,
    MM_ROUND_IDS: 'herd,pair_switch,crown,vault_delivery,banana',
    MM_ROUND_MS: '18000', MM_COUNTDOWN_MS: '800', MM_RESULT_MS: '4000',
  },
  stdio: ['ignore', 'pipe', 'inherit'],
})
let browser
const errors = []
const cues = new EventEmitter()
function waitPort() { return new Promise((resolve, reject) => { const rl = createInterface({ input: server.stdout }); const timer = setTimeout(() => reject(new Error('server startup timeout')), 10000); rl.once('line', line => { clearTimeout(timer); resolve(JSON.parse(line).port) }); server.once('exit', code => reject(new Error(`server exited ${code}`))) }) }
async function open(context, url) {
  const page = await context.newPage()
  page.setDefaultTimeout(45000)
  page.on('console', message => message.type() === 'error' && errors.push(message.text()))
  page.on('pageerror', error => errors.push(String(error)))
  page.on('websocket', socket => socket.on('framereceived', ({ payload }) => {
    if (payload === '42["cue","jump"]') cues.emit('jump', page)
  }))
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      // Record each phase before brief result screens can advance.
      window.__smokePhases = {}
      new MutationObserver(() => {
        const state = window.__mmClient?.snapshot()
        if (!state || !['play', 'result'].includes(state.phase)) return
        const key = `${state.phase}:${state.roundIndex}`
        window.__smokePhases[key] ??= {
          title: state.round?.title,
          objective: document.querySelector('#progress-text')?.textContent,
          preview: document.querySelector('#result-next-title')?.textContent,
          rank: document.querySelector('.result-row strong')?.textContent,
        }
      }).observe(document.body, { attributes: true, attributeFilter: ['data-screen'] })
    }, { once: true })
  })
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.title-screen.is-active', { timeout: 30000 })
  return page
}
function cleanup() { try { server.kill('SIGTERM') } catch {} try { rmSync(site, { recursive: true, force: true }) } catch {} }
try {
  const port = await waitPort(); const base = `http://127.0.0.1:${port}/`
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--ignore-gpu-blocklist', '--no-sandbox'] })
  const one = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  const two = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const p1 = await open(one, base + '?debug')
  if (!(await p1.locator('[data-action="single"]').isVisible())) throw new Error('single mode button is not visible')
  if (await p1.locator('#bot-difficulty option').count() !== 3) throw new Error('bot difficulty options missing')
  const p2 = await open(two, base + '?debug')
  await p2.setViewportSize({ width: 320, height: 700 })
  const color = p2.locator('.title-screen [data-color="7"]')
  await color.tap()
  await p2.waitForFunction(() => {
    const swatch = document.querySelector('.title-screen [data-color="7"]')
    const a = swatch.getBoundingClientRect()
    const b = swatch.closest('.profile-card').getBoundingClientRect()
    return swatch.classList.contains('is-selected') && a.right + 2 <= b.right && a.bottom <= b.bottom
  }, null, { timeout: 2500 })
  await p2.setViewportSize({ width: 390, height: 844 })
  await p2.locator('#title-round-count').selectOption('3')
  if (await p2.locator('#title-round-badge').textContent() !== '3') throw new Error('title round count did not update')
  const mute = p2.locator('.title-screen [data-action="mute"]')
  await mute.tap()
  if (await mute.getAttribute('aria-pressed') !== 'true') throw new Error('mute did not turn on')
  await p2.reload()
  await p2.waitForSelector('[data-screen="title"].is-active')
  if (await mute.getAttribute('aria-pressed') !== 'true') throw new Error('mute was not saved')
  await mute.tap()
  await screenshot(p2, '00-title-mobile.png')
  await p1.locator('#title-bot-count').selectOption('3')
  await p1.fill('#nickname', '테스트A테스트A테스트A12')
  await p1.click('[data-action="create"]')
  await p1.waitForSelector('[data-screen="lobby"].is-active')
  await p1.waitForFunction(() => /^[A-Z0-9]{6}\b/.test(document.querySelector('.room-code')?.textContent || ''))
  const code = await p1.locator('.room-code').textContent().then(v => v?.replace(/\s+/g, '').slice(0, 6))
  if (!code || code.length !== 6) throw new Error(`invalid room code: ${code}`)
  await p2.fill('#nickname', '테스트B')
  await p2.fill('#join-code', code)
  await p2.click('[data-action="join-code"]')
  await p2.waitForSelector('[data-screen="lobby"].is-active')
  await p1.waitForFunction(() => document.querySelector('#lobby-count')?.textContent === '2/8')
  await p1.waitForFunction(() => window.__mmClient?.world().characters.some(character => character.id === 'practice-dummy'))
  await p1.locator('.lobby-details summary').click()
  await p1.waitForFunction(() => {
    const badge = document.querySelector('.warmup-panel .host-tag')
    const list = document.querySelector('.warmup-panel .player-list')
    const header = document.querySelector('.lobby-details summary').getBoundingClientRect()
    const next = document.querySelector('#next-title').getBoundingClientRect()
    return badge && badge.getBoundingClientRect().right <= list.getBoundingClientRect().right &&
      next.top - header.bottom >= 10 && parseFloat(getComputedStyle(badge).letterSpacing) < 0.5
  }, null, { timeout: 2500 })
  if (await p1.locator('#lobby-bot-count').inputValue() !== '3') throw new Error('title bot count was lost')
  await p1.locator('#lobby-bot-count').selectOption('2')
  await p2.waitForFunction(() => document.querySelector('#lobby-bot-count')?.value === '2')
  await screenshot(p1, '00-lobby-panel-desktop.png')
  await p1.locator('.lobby-details summary').click()
  if (await p2.locator('[data-prank="headbutt"]').isVisible()) throw new Error('duplicate mobile lobby headbutt')
  if (await p2.locator('#prank-btn').getAttribute('data-label') !== '박치기') throw new Error('mobile lobby headbutt missing')
  await p2.locator('.lobby-details summary').tap()
  await p2.waitForFunction(() => Boolean(document.querySelector('#next-title')?.textContent))
  if (!(await p2.locator('#lobby-round-count').isDisabled())) throw new Error('guest can edit match settings')
  if (await p2.locator('.warmup-panel').evaluate(panel => getComputedStyle(panel).backgroundColor) !== 'rgb(37, 33, 63)') {
    throw new Error('mobile panel background is translucent')
  }
  await screenshot(p2, '01-lobby-panel-mobile.png')
  await p2.locator('[data-action="toggle-qr"]').tap()
  await p2.waitForSelector('#qr-code', { state: 'visible' })
  await p2.locator('.lobby-details summary').tap()
  await p2.locator('#ready-btn').tap()
  await p1.waitForFunction(() => window.__mmClient.world().characters.some(character => character.ready))
  if (!(await p2.locator('#jump-btn').isVisible())) throw new Error('mobile lobby controls are missing')
  await p1.bringToFront()
  await p1.evaluate(() => document.activeElement?.blur())
  const [jumpSource] = await Promise.all([
    once(cues, 'jump', { signal: AbortSignal.timeout(20000) }).then(([page]) => page),
    p1.keyboard.press('Space'),
  ])
  if (jumpSource !== p1) throw new Error('PC warmup jump was not confirmed by the server')
  await screenshot(p1, '01-lobby-host.png')
  await screenshot(p2, '01-lobby-mobile.png')
  await p2.setViewportSize({ width: 844, height: 390 })
  await p2.locator('#jump-btn').waitFor({ state: 'visible' })
  if (await p2.locator('[data-prank="headbutt"]').isVisible()) throw new Error('duplicate landscape lobby headbutt')
  await p2.setViewportSize({ width: 390, height: 844 })
  await p1.bringToFront()
  await p1.click('[data-action="start"]')
  await p1.waitForFunction(() => window.__smokePhases?.['play:0']?.objective?.startsWith('내 골대'), null, { timeout: 20000 })
  await p2.waitForFunction(() => document.body.dataset.screen === 'hud', null, { timeout: 20000 })
  if (!(await p2.locator('#prank-btn').isVisible())) throw new Error('mobile prank button is not visible')
  if (await p2.locator('[data-prank="headbutt"]').isVisible()) throw new Error('duplicate mobile HUD headbutt')
  if (await p2.locator('#prank-btn').getAttribute('data-label') !== '박치기') throw new Error('mobile HUD headbutt missing')
  if (await p1.locator('[data-prank]').count() !== 4) throw new Error('motion prank picker is incomplete')
  await screenshot(p2, '03-live-mobile.png')
  await screenshot(p1, '02-live-host.png')
  await p1.keyboard.down('KeyD'); await p1.waitForTimeout(550); await p1.keyboard.up('KeyD'); await p1.keyboard.press('KeyE'); await p1.keyboard.press('KeyQ')
  if (await p2.locator('#prank-btn').isVisible()) await p2.locator('#prank-btn').tap()
  await p1.bringToFront()
  await p1.waitForFunction(() => {
    const result = window.__smokePhases?.['result:0']
    return result?.preview === '짝꿍 동시 스위치' && result.rank === '1'
  }, null, { polling: 50 })
  if (await p1.locator('.result-screen.is-active').isVisible()) await screenshot(p1, '03-round-results.png')
  const rounds = [
    { index: 1, page: p1, title: '짝꿍 동시 스위치', object: /원형/, shot: '04-switch-desktop.png' },
    { index: 3, page: p2, title: '장애물 뚫고 금고 배달', object: /손잡이 [01]\/2|합동 운반|배달 완료/, shot: '05-vault-mobile.png' },
  ]
  for (const { index, page, title, object, shot } of rounds) {
    await page.bringToFront()
    const sample = await page.waitForFunction(index => window.__smokePhases?.[`play:${index}`], index, { polling: 50, timeout: 60000 })
    const state = await sample.jsonValue()
    if (state.title !== title || !object.test(state.objective)) throw new Error(`missing objective for ${title}`)
    if (await page.locator('#round-title').textContent() === title) await screenshot(page, shot)
  }
  await p1.bringToFront()
  await p1.waitForSelector('[data-screen="final"].is-active')
  await p2.waitForSelector('[data-screen="final"].is-active')
  if (await p2.locator('[data-action="rematch"]').isVisible()) throw new Error('guest can start a rematch')
  await screenshot(p1, '06-awards-desktop.png')
  await p1.locator('[data-action="rematch"]').click()
  for (const page of [p1, p2]) {
    await page.waitForFunction(() => {
      const state = window.__mmClient.snapshot()
      return ['countdown', 'play'].includes(state.phase) && state.roundIndex === 0
    })
    if (!(await page.locator('.room-code').textContent()).startsWith(code)) throw new Error('rematch changed rooms')
  }
  if (errors.length) throw new Error(`console errors:\n${errors.join('\n')}`)
  console.log(`smoke: OK — PC/mobile lobby, five rounds, new objectives, final and rematch verified${captureScreenshots ? `; screenshots in ${out}/` : ''}`)
  await browser.close(); cleanup()
} catch (error) {
  await browser?.close().catch(() => {})
  cleanup()
  console.error(`smoke: FAIL — ${error?.stack || error}`)
  process.exit(1)
}
