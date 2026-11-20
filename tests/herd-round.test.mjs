import { expect, test } from 'vitest'
import { createHerd, herdSnapshot, tickHerd } from '../server/herd-round.mjs'

const player = (id, seat) => ({ id, seat, x: 0, z: 0, color: '#ff5d8f', jumpY: 0, roundScore: 0, contribution: 0 })

test('미니 말랑이는 뒤에서 쫓아오면 달아나며 골대 주인만 100점을 한 번 얻는다', () => {
  const owner = player('owner', 1)
  const chaser = player('chaser', 2)
  const round = createHerd([owner, chaser])
  const [critter] = round.critters
  critter.x = 5.9; critter.z = 0
  chaser.x = 4.5
  const events = []
  const emit = type => events.push(type)
  tickHerd(round, [owner, chaser], 0.05, emit)
  expect(owner.roundScore).toBe(100)
  expect(chaser.roundScore).toBe(0)
  expect(herdSnapshot(round).critters.some(item => item.id === critter.id)).toBe(false)
  for (let step = 0; step < 25; step++) tickHerd(round, [owner, chaser], 0.05, emit)
  expect(owner.roundScore).toBe(100)
  expect(events).toEqual(['herd_score'])
  expect(herdSnapshot(round).critters.find(item => item.id === critter.id)?.generation).toBe(1)
})

test('리스폰과 공중 플레이어는 밀 수 없고 비활성 골대에는 득점할 수 없다', () => {
  const owner = { ...player('owner', 1), respawning: true }
  const chaser = { ...player('chaser', 2), x: 4.5, jumpY: 1 }
  const round = createHerd([owner, chaser])
  const [critter] = round.critters
  critter.x = 5.9; critter.z = 0
  tickHerd(round, [owner, chaser], 0.05, () => { throw new Error('unexpected score') })
  expect(critter.x - 5.9).toBeLessThan(0.05)
  expect(owner.roundScore).toBe(0)
})
