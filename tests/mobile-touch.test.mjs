import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { once } from 'node:events'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const serverDir = join(here, '..', 'server')
const distDir = join(here, '..', 'dist')
const executablePath = process.env.CHROMIUM_PATH || '/usr/bin/chromium'
const hasBrowser = existsSync(executablePath) && existsSync(join(distDir, 'index.html'))

let chromium
let browser
let server
let port
const errors = []

const snap = page => page.evaluate(() => window.__mmClient.snapshot())

beforeAll(async () => {
  if (!hasBrowser) return
  ;({ chromium } = await import('playwright'))
  server = spawn(process.execPath, ['authoritative_server.mjs'], {
    cwd: serverDir,
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0', STATIC_ROOT: distDir, MM_COUNTDOWN_MS: '300', MM_ROUND_MS: '90000', MM_ROUND_IDS: 'banana', MM_COOLDOWN_SCALE: '20' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  port = await new Promise((resolve, reject) => {
    let buffer = ''
    const timer = setTimeout(() => reject(new Error('server startup timeout')), 15000)
    server.stdout.on('data', chunk => {
      buffer += chunk
      const newline = buffer.indexOf('\n')
      if (newline >= 0) { clearTimeout(timer); resolve(JSON.parse(buffer.slice(0, newline)).port) }
    })
    server.once('exit', code => reject(new Error(`server exited ${code}`)))
  })
  browser = await chromium.launch({ executablePath, args: ['--no-sandbox', '--ignore-gpu-blocklist'] })
}, 40000)

afterAll(async () => {
  await browser?.close().catch(() => {})
  if (server) { server.kill('SIGTERM'); await once(server, 'exit').catch(() => {}) }
})

async function openPhone() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  const page = await context.newPage()
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('pageerror', error => errors.push(String(error)))
  await page.goto(`http://127.0.0.1:${port}/?debug`)
  await page.waitForSelector('[data-screen="title"].is-active', { timeout: 40000 })
  await page.tap('[data-action="single"]')
  await page.waitForSelector('[data-screen="hud"].is-active', { timeout: 30000 })
  await page.waitForFunction(() => window.__mmClient?.snapshot().phase === 'play', null, { timeout: 30000 })
  const cdp = await context.newCDPSession(page)
  /** 진짜 터치 이벤트로 한 번 탭한다(Playwright 래퍼 지연 없이). */
  const tapAt = async (selector) => {
    const box = await page.locator(selector).boundingBox()
    const x = box.x + box.width / 2, y = box.y + box.height / 2
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    return { x, y }
  }
  return { context, page, cdp, tapAt }
}

describe.skipIf(!hasBrowser)('모바일 터치 스킬·쿨타임', () => {
  test('장난 버튼과 픽커가 터치로 발동하고, 같은 스킬은 쿨타임 동안 다시 나가지 않는다', async () => {
    const { context, page, tapAt } = await openPhone()
    try {
      // 1) 장난 버튼(기본 선택 = 박치기): 발동 후 0.6초 뒤 재터치는 쿨타임이라 전송되지 않는다.
      const before = (await snap(page)).sentPranks
      await tapAt('#prank-btn')
      await page.waitForFunction(start => window.__mmClient.snapshot().sentPranks > start, before, { timeout: 10000 })
      const first = await snap(page)
      expect(first.skill).toBe('headbutt')
      expect(first.cds.lastCast.type).toBe('headbutt')
      expect(first.cds.lastCast.lockedUntil).toBeGreaterThan(first.cds.lastCast.now)
      expect(first.shownCd.headbutt).toMatch(/\d/)

      await page.waitForTimeout(600)
      await tapAt('#prank-btn')
      await page.waitForTimeout(250)
      const blocked = await snap(page)
      expect(blocked.sentPranks).toBe(before + 1)

      // 2) 다른 스킬(태클)은 자기 쿨타임을 따로 가진다 → 박치기가 잠겨 있어도 발동한다.
      await tapAt('[data-prank="tackle"]')
      await page.waitForFunction(start => window.__mmClient.snapshot().sentPranks > start, before + 1, { timeout: 10000 })
      const tackle = await snap(page)
      expect(tackle.sentPranks).toBe(before + 2)
      expect(tackle.skill).toBe('tackle')
      expect(tackle.cds.lastCast.type).toBe('tackle')
      expect(tackle.shownCd.tackle).toMatch(/\d/)
      expect(tackle.shownCd.headbutt).toMatch(/\d/)

      // 3) 픽커 게이지가 줄어든다(서버가 내려준 쿨타임 표를 클라이언트가 그대로 쓴다).
      await page.waitForTimeout(2500)
      const ticked = await snap(page)
      expect(parseFloat(ticked.shownCd.tackle)).toBeLessThan(parseFloat(tackle.shownCd.tackle) - 0.5)

      // 4) 태클도 같은 스킬 재터치는 막힌다.
      await tapAt('[data-prank="tackle"]')
      await page.waitForTimeout(250)
      expect((await snap(page)).sentPranks).toBe(before + 2)
    } finally {
      await context.close()
    }
  }, 180000)

  test('잡기 버튼도 쿨타임 게이지가 표시되고, 버튼 위를 덮는 요소가 없다', async () => {
    const { context, page, tapAt } = await openPhone()
    try {
      await tapAt('#interact-btn')
      await page.waitForFunction(() => Boolean(window.__mmClient.snapshot().shownCd.grab), null, { timeout: 10000 })
      const after = await snap(page)
      expect(after.shownCd.grab).toMatch(/\d/)
      expect(after.cds.lastCast.type).toBe('grab')

      // 버튼 중심의 최상위 요소가 그 버튼이어야 한다(다른 요소가 터치를 가로채면 안 된다).
      const hits = await page.evaluate(() => {
        const pick = (selector) => {
          const element = document.querySelector(selector)
          const rect = element.getBoundingClientRect()
          const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
          return { selector, top: top?.id || top?.className || top?.tagName || '', matches: Boolean(top && (top === element || element.contains(top))) }
        }
        return ['#prank-btn', '#jump-btn', '#interact-btn', '[data-prank="bonk"]', '#stick'].map(pick)
      })
      for (const hit of hits) expect(hit.matches, `${hit.selector} 위를 ${hit.top}가 덮고 있음`).toBe(true)
    } finally {
      await context.close()
    }
  }, 150000)

  test('스틱을 잡고 이동하는 멀티터치 중에도 장난 버튼이 발동한다', async () => {
    const { context, page, cdp } = await openPhone()
    try {
      await page.waitForFunction(() => window.__mmClient.snapshot().remaining.headbutt === 0, null, { timeout: 20000 })
      const stick = await page.locator('#stick').boundingBox()
      const prank = await page.locator('#prank-btn').boundingBox()
      const sx = stick.x + stick.width / 2, sy = stick.y + stick.height / 2
      const px = prank.x + prank.width / 2, py = prank.y + prank.height / 2
      const before = (await snap(page)).sentPranks
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy, id: 1 }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: sx, y: sy - 40, id: 1 }] })
      await page.waitForTimeout(200)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy - 40, id: 1 }, { x: px, y: py, id: 2 }] })
      await page.waitForTimeout(120)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: sx, y: sy - 40, id: 1 }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await page.waitForFunction(start => window.__mmClient.snapshot().sentPranks > start, before, { timeout: 10000 })
      const after = await snap(page)
      expect(after.sentPranks).toBe(before + 1)
      expect(after.cds.lastCast.type).toBe('headbutt')
      expect(after.shownCd.headbutt).toMatch(/\d/)
    } finally {
      await context.close()
    }
  }, 150000)

  test('콘솔 오류 없이 모바일 화면이 유지된다', () => {
    expect(errors.filter(message => !message.includes('GLB load failed'))).toEqual([])
  })
})
