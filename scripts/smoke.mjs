import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { chromium } from 'playwright'

const out = process.env.SHOTS_DIR ?? 'shots'
mkdirSync(out, { recursive: true })
if (!existsSync('dist/index.html')) throw new Error('smoke: run `pnpm build` first')
const site = mkdtempSync(join(tmpdir(), 'malang-mayhem-smoke-'))
cpSync('dist', site, { recursive: true })
const server = spawn(process.execPath, ['server/authoritative_server.mjs'], { env: { ...process.env, HOST: '127.0.0.1', PORT: '0', STATIC_ROOT: site }, stdio: ['ignore', 'pipe', 'inherit'] })
let browser
const errors = []
function waitPort() { return new Promise((resolve, reject) => { const rl = createInterface({ input: server.stdout }); const timer = setTimeout(() => reject(new Error('server startup timeout')), 10000); rl.once('line', line => { clearTimeout(timer); resolve(JSON.parse(line).port) }); server.once('exit', code => reject(new Error(`server exited ${code}`))) }) }
async function open(context, url) { const page = await context.newPage(); page.on('console', m => m.type() === 'error' && errors.push(m.text())); page.on('pageerror', e => errors.push(String(e))); await page.goto(url); await page.waitForSelector('[data-screen="title"].is-active', { timeout: 30000 }); return page }
function cleanup() { try { server.kill('SIGTERM') } catch {} try { rmSync(site, { recursive: true, force: true }) } catch {} }
try {
  const port = await waitPort(); const base = `http://127.0.0.1:${port}/`
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--ignore-gpu-blocklist', '--no-sandbox'] })
  const one = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  const two = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const p1 = await open(one, base)
  if (!(await p1.locator('[data-action="single"]').isVisible())) throw new Error('single mode button is not visible')
  if (await p1.locator('#bot-difficulty option').count() !== 3) throw new Error('bot difficulty options missing')
  await p1.fill('#nickname', '테스트A')
  await p1.click('[data-action="create"]')
  await p1.waitForSelector('[data-screen="lobby"].is-active')
  const code = await p1.locator('.room-code').textContent().then(v => v?.replace(/\s+/g, '').slice(0, 6))
  if (!code || code.length !== 6) throw new Error(`invalid room code: ${code}`)
  await p1.screenshot({ path: join(out, '01-lobby-host.png') })
  const p2 = await open(two, base)
  await p2.fill('#nickname', '테스트B')
  await p2.fill('#join-code', code)
  await p2.click('[data-action="join-code"]')
  await p2.waitForSelector('[data-screen="lobby"].is-active')
  await p1.waitForFunction(() => document.querySelector('#lobby-count')?.textContent === '2/8')
  await p1.click('[data-action="start"]')
  await p1.waitForFunction(() => document.querySelector('[data-screen="hud"]')?.classList.contains('is-active'), null, { timeout: 20000 })
  await p2.waitForFunction(() => document.querySelector('[data-screen="hud"]')?.classList.contains('is-active'), null, { timeout: 20000 })
  if (!(await p2.locator('#prank-btn').isVisible())) throw new Error('mobile prank button is not visible')
  if (await p1.locator('[data-prank]').count() !== 4) throw new Error('motion prank picker is incomplete')
  await p1.keyboard.down('KeyD'); await p1.waitForTimeout(550); await p1.keyboard.up('KeyD'); await p1.keyboard.press('KeyE'); await p1.keyboard.press('KeyQ')
  await p2.locator('#prank-btn').dispatchEvent('pointerdown')
  await p1.screenshot({ path: join(out, '02-live-host.png') })
  await p2.screenshot({ path: join(out, '03-live-mobile.png') })
  if (errors.length) throw new Error(`console errors:\n${errors.join('\n')}`)
  console.log(`smoke: OK — room ${code}, two players joined, live HUD visible; screenshots in ${out}/`)
  await browser.close(); cleanup()
} catch (error) {
  await browser?.close().catch(() => {})
  cleanup()
  console.error(`smoke: FAIL — ${error?.stack || error}`)
  process.exit(1)
}
