import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { EventEmitter, once } from 'node:events'
import { chromium } from 'playwright'

const out = process.env.SHOTS_DIR ?? 'shots'
const captureScreenshots = process.env.SMOKE_SCREENSHOTS !== '0'
const renderScale = Number(process.env.SMOKE_RENDER_SCALE || 1)
if (!(renderScale > 0 && renderScale <= 1)) throw new Error('SMOKE_RENDER_SCALE must be within (0, 1]')
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
    MM_ROUND_MS: '15000', MM_OPENING_MS: '2200', MM_COUNTDOWN_MS: '2000', MM_RESULT_MS: '4000',
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
  page.on('pageerror', error => errors.push(error.stack || String(error)))
  page.on('websocket', socket => socket.on('framereceived', ({ payload }) => {
    if (payload === '42["cue","jump"]') cues.emit('jump', page)
  }))
  await page.addInitScript(() => {
    window.__smokeOpeningAudio = 0
    const setFrequency = AudioParam.prototype.setValueAtTime
    AudioParam.prototype.setValueAtTime = function (value, when) {
      if (value === 262) window.__smokeOpeningAudio++
      return setFrequency.call(this, value, when)
    }
    document.addEventListener('DOMContentLoaded', () => {
      window.__smokeNotices = []
      window.__smokeIntros = new Set()
      new MutationObserver(records => {
        for (const { target } of records) {
          if (target.id === 'play-callout' && target.textContent) window.__smokeNotices.push(target.textContent)
          if (target.id === 'intro-title' || target.id === 'intro-rule') window.__smokeIntros.add(target.textContent)
        }
        // Hit-test the actual mobile tap surface while the short opening frame is on screen.
        if (window.__smokeTapOpening && document.querySelector('#intro-title')?.textContent === '말랑이 입장!') {
          const hit = document.elementFromPoint(95, 250)
          if (hit?.matches('.intro-tap')) {
            window.__smokeTapOpening = false
            hit.click()
          }
        }
      }).observe(document.getElementById('ui'), { childList: true, subtree: true })
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
  await page.goto(url, { waitUntil: 'commit', timeout: 90000 })
  await page.waitForSelector('.title-screen.is-active', { timeout: 90000 })
  if (renderScale < 1) await page.evaluate(scale => {
    // Reduce software WebGL raster work while preserving the CSS viewport and game timing.
    const renderer = window.__mm.renderer
    renderer.setPixelRatio(renderer.getPixelRatio() * scale)
  }, renderScale)
  return page
}
async function press(button) {
  await button.evaluate(el => {
    if (el.disabled || !el.getClientRects().length || getComputedStyle(el).visibility === 'hidden') {
      throw new Error('smoke control is unavailable')
    }
    el.click()
  })
}

async function selectOption(locator, value) {
  await locator.evaluate((select, selected) => {
    if (select.disabled || !select.getClientRects().length) throw new Error('smoke setting is unavailable')
    select.value = selected
    select.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
}

async function checkInviteRow(page) {
  const complete = await page.locator('.invite-panel .warmup-actions').evaluate(row => {
    const scroll = row.closest('.warmup-settings').getBoundingClientRect()
    const bounds = row.getBoundingClientRect()
    return bounds.top >= scroll.top && bounds.bottom <= Math.min(scroll.bottom, innerHeight) &&
      [...row.children].every(button => button.getBoundingClientRect().right <= scroll.right)
  })
  if (!complete) throw new Error('lobby invitation row is clipped')
}
async function checkNotifications(page) {
  const problem = await page.evaluate(() => {
    const screen = document.body.dataset.screen
    document.body.dataset.screen = 'hud'
    const fixtures = [
      ['#respawn-hud', '2.0초 뒤 아레나 복귀'],
      ['#play-callout', '폭탄 3초 이하! 폭탄에서 멀어져요!'],
      ['#game-toast', '말랑이가 폭탄을 받았다! 12초 안에 넘겨라!'],
      ['#prank-log', '말랑이가 친구에게 발 걸기 태클! 아이템을 떨어뜨렸다!'],
    ]
    const restore = fixtures.map(([selector, message]) => {
      const card = document.querySelector(selector)
      const text = document.createElement('div')
      text.textContent = message
      const wasVisible = card.classList.contains('is-visible')
      card.prepend(text)
      card.classList.add('is-visible')
      return () => { text.remove(); card.classList.toggle('is-visible', wasVisible) }
    })
    try {
      const hud = document.querySelector('.hud-screen')
      const blocked = [...hud.querySelectorAll('.hud-top button, .objective, .stick, .action-round')]
        .map(el => el.getBoundingClientRect()).filter(rect => rect.width && rect.height)
      const headerBottom = Math.max(...[...hud.querySelectorAll('.hud-top button')].map(el => el.getBoundingClientRect().bottom))
      const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
      const right = hud.querySelector('.hud-panels').getBoundingClientRect().right
      for (const [selector] of fixtures) {
        const el = hud.querySelector(selector)
        const box = (selector === '#prank-log' ? el.firstElementChild : el).getBoundingClientRect()
        if (!box.height || box.left < innerWidth / 2 || Math.abs(box.right - right) > 1 || box.top < headerBottom + 8) {
          return `${selector} is outside the top-right notification column`
        }
        if (blocked.some(rect => overlaps(box, rect))) return `${selector} overlaps the HUD or controls`
      }
    } finally {
      restore.forEach(reset => reset())
      document.body.dataset.screen = screen
    }
    return ''
  })
  if (problem) throw new Error(`${page.viewportSize().width}×${page.viewportSize().height}: ${problem}`)
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
  await press(color)
  await p2.waitForFunction(() => {
    const swatch = document.querySelector('.title-screen [data-color="7"]')
    const a = swatch.getBoundingClientRect()
    const b = swatch.closest('.profile-card').getBoundingClientRect()
    return swatch.classList.contains('is-selected') && a.right + 2 <= b.right && a.bottom <= b.bottom
  }, null, { polling: 50, timeout: 12000 })
  await p2.setViewportSize({ width: 390, height: 844 })
  await selectOption(p2.locator('#title-round-count'), '3')
  if (await p2.locator('#title-round-badge').textContent() !== '3') throw new Error('title round count did not update')
  const mute = p2.locator('.title-screen [data-action="mute"]')
  await press(mute)
  if (await mute.getAttribute('aria-pressed') !== 'true') throw new Error('mute did not turn on')
  await p2.reload()
  await p2.waitForSelector('[data-screen="title"].is-active')
  if (await mute.getAttribute('aria-pressed') !== 'true') throw new Error('mute was not saved')
  await press(mute)
  await screenshot(p2, '00-title-mobile.png')
  await selectOption(p1.locator('#title-bot-count'), '3')
  await p1.evaluate(() => {
    document.querySelector('#nickname').value = '테스트A테스트A테스트A12'
    document.querySelector('[data-action="create"]').click()
  })
  await p1.waitForSelector('[data-screen="lobby"].is-active')
  await p1.waitForFunction(() => /^[A-Z0-9]{6}\b/.test(document.querySelector('.room-code')?.textContent || ''))
  const code = await p1.locator('.room-code').textContent().then(v => v?.replace(/\s+/g, '').slice(0, 6))
  if (!code || code.length !== 6) throw new Error(`invalid room code: ${code}`)
  await p2.evaluate(code => {
    document.querySelector('#nickname').value = '테스트B'
    document.querySelector('#join-code').value = code
    document.querySelector('[data-action="join-code"]').click()
  }, code)
  await p2.waitForSelector('[data-screen="lobby"].is-active')
  console.log('smoke: two players connected')
  await p1.waitForFunction(() => document.querySelector('#lobby-count')?.textContent === '2/8')
  await p1.waitForFunction(() => window.__mmClient?.world().characters.some(character => character.id === 'practice-dummy'))
  await press(p1.locator('.lobby-details summary'))
  await p1.locator('.lobby-details[open]').waitFor()
  await p1.waitForFunction(() => {
    const badge = document.querySelector('.warmup-panel .host-tag')
    const list = document.querySelector('.warmup-panel .player-list')
    const header = document.querySelector('.lobby-details summary').getBoundingClientRect()
    const next = document.querySelector('#next-title').getBoundingClientRect()
    return badge && badge.getBoundingClientRect().right <= list.getBoundingClientRect().right &&
      next.top - header.bottom >= 10 && parseFloat(getComputedStyle(badge).letterSpacing) < 0.5
  }, null, { polling: 50, timeout: 12000 })
  if (await p1.locator('#lobby-bot-count').inputValue() !== '3') throw new Error('title bot count was lost')
  await selectOption(p1.locator('#lobby-bot-count'), '2')
  await p2.waitForFunction(() => document.querySelector('#lobby-bot-count')?.value === '2')
  await checkInviteRow(p1)
  await screenshot(p1, '00-lobby-panel-desktop.png')
  await press(p1.locator('.lobby-details summary'))
  if (await p2.locator('[data-prank="headbutt"]').isVisible()) throw new Error('duplicate mobile lobby headbutt')
  if (await p2.locator('#prank-btn').getAttribute('data-label') !== '박치기') throw new Error('mobile lobby headbutt missing')
  await press(p2.locator('.lobby-details summary'))
  await p2.waitForFunction(() => Boolean(document.querySelector('#next-title')?.textContent))
  if (!(await p2.locator('#lobby-round-count').isDisabled())) throw new Error('guest can edit match settings')
  if (await p2.locator('.warmup-panel').evaluate(panel => getComputedStyle(panel).backgroundColor) !== 'rgb(37, 33, 63)') {
    throw new Error('mobile panel background is translucent')
  }
  await checkInviteRow(p2)
  await screenshot(p2, '01-lobby-panel-mobile.png')
  await press(p2.locator('[data-action="toggle-qr"]'))
  await p2.waitForSelector('#qr-code', { state: 'visible' })
  await press(p2.locator('.lobby-details summary'))
  await press(p2.locator('#ready-btn'))
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
  await press(p2.locator('.lobby-details summary'))
  await checkInviteRow(p2)
  await press(p2.locator('.lobby-details summary'))
  await checkNotifications(p2)
  await p2.setViewportSize({ width: 390, height: 844 })
  await checkNotifications(p2)
  await checkNotifications(p1)
  console.log('smoke: notification layout verified at 1280×720, 390×844 and 844×390')
  await p2.bringToFront()
  await p2.evaluate(() => { window.__smokeTapOpening = true })
  // Keep the touch page foregrounded during the opening. The desktop already unlocked audio with the warmup jump.
  await press(p1.locator('[data-action="start"]'))
  await p2.waitForFunction(() => window.__smokeIntros.has('라운드 준비 중'), null, { polling: 50, timeout: 20000 })
  if (captureScreenshots && await p1.locator('.intro-skip').isVisible()) await screenshot(p1, '02-match-opening-desktop.png')
  await p1.waitForFunction(() => window.__smokeOpeningAudio === 1, null, { polling: 50, timeout: 20000 })
  await p2.waitForFunction(() => [...window.__smokeIntros].some(text => text.includes('내 골대')), null, { polling: 50, timeout: 20000 })
  if (await p2.locator('.intro-screen.is-active').isVisible()) await screenshot(p2, '02-round-intro-mobile.png')
  console.log('smoke: opening audio, mobile tap and round card verified')
  await p1.waitForFunction(() => window.__smokePhases?.['play:0']?.objective?.startsWith('내 골대'), null, { timeout: 20000 })
  await p2.waitForFunction(() => document.body.dataset.screen === 'hud', null, { timeout: 20000 })
  if (!(await p2.locator('#prank-btn').isVisible())) throw new Error('mobile prank button is not visible')
  if (await p2.locator('[data-prank="headbutt"]').isVisible()) throw new Error('duplicate mobile HUD headbutt')
  if (await p2.locator('#prank-btn').getAttribute('data-label') !== '박치기') throw new Error('mobile HUD headbutt missing')
  if (await p1.locator('[data-prank]').count() !== 4) throw new Error('motion prank picker is incomplete')
  await p2.setViewportSize({ width: 844, height: 390 })
  await p2.bringToFront()
  await p2.evaluate(() => window.__mmInput({ x: 1, z: 1 }))
  try {
    await p2.waitForFunction(() => /2초 뒤 복귀/.test(document.querySelector('#prank-log').textContent), null, { timeout: 6500 })
  } finally {
    await p2.evaluate(() => window.__mmInput({ x: 0, z: 0 }))
  }
  const overlap = await p2.locator('#prank-log').evaluate(log => {
    const a = log.firstElementChild.getBoundingClientRect()
    const b = document.querySelector('.objective').getBoundingClientRect()
    return a.height === 0 || (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top)
  })
  if (overlap) throw new Error('landscape prank log overlays the objective')
  await screenshot(p2, '03-prank-log-landscape.png')
  await p2.waitForFunction(() => ['복귀', '마지막 10초'].every(text =>
    window.__smokeNotices.some(notice => notice.includes(text))), null, { timeout: 11000 })
  await p2.setViewportSize({ width: 390, height: 844 })
  if (await p1.locator('.hud-screen.is-active').isVisible() && await p2.locator('#prank-btn').isVisible()) {
    await p1.keyboard.down('KeyD'); await p1.waitForTimeout(550); await p1.keyboard.up('KeyD'); await p1.keyboard.press('KeyE'); await p1.keyboard.press('KeyQ')
    if (await p2.locator('#prank-btn').isVisible()) await press(p2.locator('#prank-btn'))
  }
  console.log('smoke: landscape log and timed callouts verified')
  if (await p2.locator('.hud-screen.is-active').isVisible()) await screenshot(p2, '03-live-mobile.png')
  if (await p1.locator('.hud-screen.is-active').isVisible()) await screenshot(p1, '02-live-host.png')
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
    if (index === 1) await page.waitForFunction(() => window.__smokeNotices.some(notice => notice.includes('짝꿍 연결')), null, { timeout: 4000 })
    if (await page.locator('#round-title').textContent() === title) await screenshot(page, shot)
  }
  await p1.bringToFront()
  // Allow time for both remaining rounds, their transitions and browser scheduling.
  try {
    await p1.waitForSelector('[data-screen="final"].is-active', { timeout: 75000 })
  } catch (error) {
    const phases = await Promise.all([p1, p2].map(page => page.evaluate(() => ({
      screen: document.body.dataset.screen,
      phase: window.__mmClient.snapshot().phase,
      round: window.__mmClient.snapshot().roundIndex,
      seen: Object.keys(window.__smokePhases),
    }))))
    throw new Error(`final screen did not appear: ${JSON.stringify(phases)}`, { cause: error })
  }
  await p2.waitForSelector('[data-screen="final"].is-active', { timeout: 75000 })
  if (await p2.locator('[data-action="rematch"]').isVisible()) throw new Error('guest can start a rematch')
  await screenshot(p1, '06-awards-desktop.png')
  await press(p1.locator('[data-action="rematch"]'))
  for (const page of [p1, p2]) {
    await page.waitForFunction(() => {
      const state = window.__mmClient.snapshot()
      return ['countdown', 'play'].includes(state.phase) && state.roundIndex === 0
    })
    if (!(await page.locator('.room-code').textContent()).startsWith(code)) throw new Error('rematch changed rooms')
  }
  if (errors.length) throw new Error(`console errors:\n${errors.join('\n')}`)
  console.log(`smoke: OK — PC/mobile lobby, intros, callouts, five rounds, final and rematch verified${captureScreenshots ? `; screenshots in ${out}/` : ''}`)
  await browser.close(); cleanup()
} catch (error) {
  await browser?.close().catch(() => {})
  cleanup()
  console.error(`smoke: FAIL — ${error?.stack || error}`)
  if (errors.length) console.error(errors.join('\n'))
  process.exit(1)
}
