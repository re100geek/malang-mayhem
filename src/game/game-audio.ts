export const audioButton = '<button class="hud-btn audio-toggle" data-action="mute" type="button" aria-label="음소거">🔊</button>'

type Cue = { notes: number[]; wave?: OscillatorType; length?: number; glide?: number; volume?: number }

const cues: Record<string, Cue> = {
  jump: { notes: [245], glide: 690, length: .15 },
  headbutt: { notes: [225], wave: 'triangle', glide: 65, length: .18 },
  bonk: { notes: [770, 350], wave: 'triangle', length: .08 },
  tackle: { notes: [130, 82], wave: 'sawtooth', length: .14, volume: .07 },
  hug: { notes: [330, 440, 494] },
  banana_peel: { notes: [650], wave: 'triangle', glide: 120, length: .25 },
  bomb_tick: { notes: [880], wave: 'triangle', length: .065, volume: .08 },
  bomb_boom: { notes: [90, 52], wave: 'sawtooth', glide: 32, length: .24 },
  tail_steal: { notes: [620, 490, 910], length: .09 },
  score: { notes: [520, 780] },
  match_opening: { notes: [262, 392, 523, 659, 784], wave: 'triangle', length: .24 },
  round_start: { notes: [392, 523, 784] },
  round_result: { notes: [660, 523, 392], length: .18 },
  final: { notes: [392, 523, 659, 784], length: .2 },
  vault_hit: { notes: [180, 108], wave: 'triangle' },
  vault_grab: { notes: [263, 330] },
  vault_delivered: { notes: [440, 554, 660, 880] },
}
const scoreEvents = new Set(['herd_score', 'switch_open', 'mega', 'crown', 'bomb_pass', 'sweeper_assist'])

export class GameAudio {
  private context?: AudioContext
  private output?: GainNode
  private lastPlayed = new Map<string, number>()
  private bombSecond = 0

  constructor(public muted: boolean) {}

  unlock = () => {
    if (this.muted || !window.AudioContext) return
    if (!this.context) {
      try {
        this.context = new AudioContext()
        this.output = this.context.createGain()
        this.output.connect(this.context.destination)
      } catch {
        return
      }
    }
    if (this.context.state === 'suspended') void this.context.resume().catch(() => {})
  }

  toggle() {
    this.muted = !this.muted
    if (this.output) this.output.gain.value = this.muted ? 0 : 1
    if (!this.muted) this.unlock()
  }

  event(type: string, itemType?: string) {
    if (type === 'prank' || (type === 'prank_item' && itemType === 'banana_peel')) {
      if (itemType) this.play(itemType)
    } else this.play(scoreEvents.has(type) ? 'score' : type)
  }

  bomb(fuse: number) {
    const second = Math.ceil(fuse)
    if (second > 0 && second !== this.bombSecond) this.play('bomb_tick')
    this.bombSecond = second
  }

  play(type: string) {
    const cue = Object.hasOwn(cues, type) ? cues[type] : undefined
    const context = this.context
    const output = this.output
    if (!cue || this.muted || !output || context?.state !== 'running') return
    const now = context.currentTime
    if (now - (this.lastPlayed.get(type) ?? -Infinity) < .12) return
    this.lastPlayed.set(type, now)
    const length = cue.length ?? .14
    for (const [index, frequency] of cue.notes.entries()) {
      const start = now + index * .075
      const tone = context.createOscillator()
      const gain = context.createGain()
      tone.type = cue.wave ?? 'sine'
      tone.frequency.setValueAtTime(frequency, start)
      if (cue.glide) tone.frequency.exponentialRampToValueAtTime(cue.glide, start + length)
      gain.gain.setValueAtTime(.001, start)
      gain.gain.exponentialRampToValueAtTime(cue.volume ?? .13, start + .014)
      gain.gain.exponentialRampToValueAtTime(.001, start + length)
      tone.connect(gain).connect(output)
      tone.start(start)
      tone.stop(start + length)
      tone.onended = () => { tone.disconnect(); gain.disconnect() }
    }
  }
}
