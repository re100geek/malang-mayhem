import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { GameAudio } from '../src/game/game-audio'

const start = vi.fn()
const parameter = () => ({ value: 1, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() })
const gain = { gain: parameter(), connect: vi.fn(), disconnect: vi.fn() }
const oscillator = {
  type: 'sine',
  frequency: parameter(),
  connect: vi.fn(() => gain),
  start,
  stop: vi.fn(),
  disconnect: vi.fn(),
}
class TestAudioContext {
  state = 'running'
  currentTime = 0
  destination = {}
  createGain = () => gain
  createOscillator = () => oscillator
}

beforeEach(() => {
  vi.stubGlobal('window', { AudioContext: TestAudioContext })
  vi.stubGlobal('AudioContext', TestAudioContext)
  start.mockClear()
  gain.gain.value = 1
})
afterEach(() => vi.unstubAllGlobals())

test('server hit and score events synthesize the corresponding notes after unlock', () => {
  const audio = new GameAudio(false)
  audio.play('jump')
  expect(start).not.toHaveBeenCalled()
  audio.unlock()
  audio.play('jump')
  audio.event('prank', 'bonk')
  audio.event('herd_score')
  audio.event('prank_item', 'jelly_pool')
  expect(start).toHaveBeenCalledTimes(5)
})

test('bomb snapshots play once per displayed second and mute silences playback', () => {
  const audio = new GameAudio(false)
  audio.unlock()
  audio.bomb(8.9)
  audio.bomb(8.7)
  expect(start).toHaveBeenCalledTimes(1)
  audio.toggle()
  expect(gain.gain.value).toBe(0)
  audio.event('round_start')
  expect(start).toHaveBeenCalledTimes(1)
  audio.toggle()
  expect(gain.gain.value).toBe(1)
  audio.event('bomb_boom')
  expect(start).toHaveBeenCalledTimes(3)
})

test('opening fanfare synthesizes five notes and respects the saved mute setting', () => {
  const audio = new GameAudio(true)
  audio.unlock()
  audio.play('match_opening')
  expect(start).not.toHaveBeenCalled()
  audio.toggle()
  audio.play('match_opening')
  audio.play('match_opening')
  expect(start).toHaveBeenCalledTimes(5)
})
