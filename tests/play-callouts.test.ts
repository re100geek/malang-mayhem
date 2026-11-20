import { expect, it } from 'vitest'
import { PlayCallouts } from '../src/game/play-callouts'
import type { PartyState, Player } from '../src/game/party-game'

function setup() {
  const classes = new Set<string>()
  const banner = {
    textContent: '',
    classList: {
      add: (name: string) => classes.add(name),
      remove: (...names: string[]) => names.forEach(name => classes.delete(name)),
      toggle: (name: string, enabled: boolean) => enabled ? classes.add(name) : classes.delete(name),
    },
  }
  const tracker = new PlayCallouts(banner as unknown as HTMLElement)
  const mine = { id: 'mine', connected: true, roundScore: 0 } as Player
  const other = { id: 'other', connected: true, roundScore: 0 } as Player
  const state = { phase: 'play', players: [mine, other], round: { timeLeft: 15 } } as PartyState
  return { tracker, banner, classes, mine, other, state, sync: (now: number) => tracker.sync(state, mine.id, now) }
}

it('changes an urgent bomb warning when a pass changes the viewer’s role', () => {
  const { banner, classes, state, sync, tracker } = setup()
  state.objects = { type: 'bomb', bomb: { holder: 'other', fuse: 4 } }
  sync(0)
  state.objects.bomb.fuse = 3
  sync(1000)
  expect(banner.textContent).toContain('멀어져요')
  expect(classes.has('is-urgent')).toBe(true)
  state.objects.bomb.holder = 'mine'
  sync(1100)
  expect(banner.textContent).toContain('지금 넘겨요')
  tracker.tick(3000)
  sync(3100)
  expect(banner.textContent).toBe('')
})

it('detects confirmed private mission progress, respawn and the final timer crossing once', () => {
  const { banner, mine, state, sync, tracker } = setup()
  mine.secretMission = { kind: 'drop_two', text: '', target: 2 }
  mine.partnerId = 'other'
  sync(0)
  expect(banner.textContent).toContain('짝꿍 연결')
  mine.missionProgress = 2
  sync(250)
  expect(banner.textContent).toContain('비밀 장난 미션')
  mine.respawning = true
  sync(500)
  mine.respawning = false
  sync(2500)
  state.round!.timeLeft = 10
  sync(5000)
  tracker.tick(5000)
  expect(banner.textContent).toContain('복귀')
  tracker.tick(6750)
  expect(banner.textContent).toContain('마지막 10초')
  state.phase = 'result'
  sync(7000)
  expect(banner.textContent).toBe('')
})

it('calls a tail score reversal only after the viewer takes an outright lead', () => {
  const { banner, mine, other, state, sync, tracker } = setup()
  state.objects = { type: 'tail' }
  other.roundScore = 5
  sync(0)
  tracker.tailSteal({ attackerId: mine.id, targetId: other.id }, mine.id, 500)
  expect(banner.textContent).toContain('강탈 성공')
  tracker.tick(2200)
  mine.roundScore = 5
  sync(2300)
  expect(banner.textContent).toBe('')
  mine.roundScore = 6
  sync(2400)
  expect(banner.textContent).toContain('역전')
})
