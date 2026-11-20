import { describe, expect, it } from 'vitest'
import { introFrame, introRule, introShot, landingHeight } from '../src/game/round-intro'
import type { PartyState, Player } from '../src/game/party-game'

describe('intro presentation', () => {
  it('skips only the opening camera without moving the round deadline', () => {
    const timing = { openingMs: 2200, roundMs: 2000 }
    expect(introFrame(timing, 4200, false)).toEqual({ kind: 'opening', progress: 0 })
    expect(introFrame(timing, 3100, true)).toEqual({ kind: 'ready', progress: .5 })
    expect(introFrame(timing, 2000, true)).toEqual({ kind: 'round', progress: 0 })
    expect(introFrame(timing, 0, true)).toEqual({ kind: 'round', progress: 1 })
  })

  it('shows the authoritative bomb holder and uses the round rule', () => {
    const holder = { id: 'holder', x: -5, z: 3 } as Player
    const state = { players: [holder], objects: { type: 'bomb', bomb: { holder: holder.id, x: 0, z: 0 } } } as PartyState
    expect(introShot(state, 'guest').target).toBe(holder)
    expect(introRule(state)).toContain('터지기 전에')
  })

  it('lands every seat above the arena surface before play', () => {
    for (let seat = 1; seat <= 8; seat++) {
      expect(landingHeight(0, seat)).toBeGreaterThan(1)
      expect(landingHeight(.73, seat)).toBeGreaterThanOrEqual(0)
      expect(landingHeight(1, seat)).toBe(0)
    }
  })
})
