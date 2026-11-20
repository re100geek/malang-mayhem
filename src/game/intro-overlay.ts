import { introFrame, introRule, type IntroTiming } from './round-intro'
import type { CameraIntro } from './intro-camera'
import type { PartyState } from './party-game'

export const introMarkup = `
  <section class="screen intro-screen" data-screen="intro" aria-label="라운드 시작 연출">
    <button class="intro-tap" type="button" data-action="skip-intro" aria-label="개막 건너뛰기" tabindex="-1" hidden></button>
    <button class="intro-skip" type="button" data-action="skip-intro" hidden>건너뛰기</button>
    <div class="intro-card" role="status">
      <span class="eyebrow" id="intro-label"></span>
      <strong id="intro-title"></strong>
      <span id="intro-rule"></span>
    </div>
  </section>`

export class IntroOverlay {
  private state?: PartyState
  private timing?: IntroTiming
  private deadline = 0
  private skipped = false
  private shown = ''
  private readonly motion = matchMedia('(prefers-reduced-motion: reduce)')
  private readonly buttons = document.querySelectorAll<HTMLButtonElement>('[data-action="skip-intro"]')
  private readonly label = document.getElementById('intro-label')!
  private readonly title = document.getElementById('intro-title')!
  private readonly rule = document.getElementById('intro-rule')!

  constructor(private readonly onOpening: () => void) {}

  sync(state: PartyState | null) {
    if (state?.phase !== 'countdown' || !state.round || !state.intro) {
      this.state = this.timing = undefined
      this.shown = ''
      this.skipped = false
      return
    }
    const deadline = performance.now() + state.round.timeLeft * 1000
    this.deadline = this.state ? Math.min(this.deadline, deadline) : deadline
    this.state = state
    this.timing = state.intro
  }

  skip() { if (this.shown === 'opening') this.skipped = true }

  frame(now: number): CameraIntro | undefined {
    if (!this.state || !this.timing) return
    const frame = introFrame(this.timing, Math.max(0, this.deadline - now), this.skipped)
    if (frame.kind !== this.shown) {
      const opening = frame.kind === 'opening'
      const round = frame.kind === 'round'
      if (opening) {
        this.onOpening()
      }
      for (const button of this.buttons) button.hidden = !opening
      if (opening) this.buttons[1].focus({ preventScroll: true })
      else if (this.buttons[1] === document.activeElement) this.buttons[1].blur()
      this.label.textContent = round ? `ROUND ${this.state.roundIndex + 1} / ${this.state.plan?.length ?? 5}` : 'MALANG MAYHEM'
      this.title.textContent = round ? this.state.round!.title : opening ? '말랑이 입장!' : '라운드 준비 중'
      this.rule.textContent = round ? introRule(this.state) : ''
      this.shown = frame.kind
    }
    return { ...frame, reducedMotion: this.motion.matches }
  }
}
