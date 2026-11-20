const HOLD_SECONDS = 2.5
const PAD_RADIUS = 0.95
const PALETTE = ['#57c7ff', '#ffbd4a', '#a877ff', '#62e8aa']
const LANE_SPACING = 3.5
const PAD_SPACING = 1.5
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z)
const onPad = (player, pad) => Boolean(player && !player.respawning && player.jumpY <= 0.12 && distance(player, pad) <= PAD_RADIUS)

export function createSwitch(pairs) {
  return {
    type: 'switch', delivered: 0, total: pairs.length,
    gates: pairs.map(({ a, b }, index) => {
      const x = (index - (pairs.length - 1) / 2) * LANE_SPACING
      return {
        id: index, x, z: -1.9, color: PALETTE[index], hold: 0, opened: false,
        pads: [{ id: a, x: x - PAD_SPACING / 2, z: 0, down: false }, { id: b, x: x + PAD_SPACING / 2, z: 0, down: false }],
      }
    }),
  }
}

export function tickSwitch(round, players, dt, emit) {
  const byId = new Map(players.map(player => [player.id, player]))
  for (const gate of round.gates) {
    if (gate.opened) continue
    for (const pad of gate.pads) pad.down = onPad(byId.get(pad.id), pad)
    gate.hold = gate.pads.every(pad => pad.down) ? Math.min(HOLD_SECONDS, gate.hold + dt) : 0
    if (gate.hold + 1e-8 < HOLD_SECONDS) continue
    gate.opened = true
    round.delivered++
    for (const pad of gate.pads) {
      const player = byId.get(pad.id)
      player.roundScore += 250
      player.contribution++
    }
    emit('switch_open', `스위치 문 ${gate.id + 1} 열림! 짝꿍 각각 +250P`, { x: gate.x, z: gate.z })
  }
}

export function switchSnapshot(round) {
  return {
    total: round.total,
    delivered: round.delivered,
    padRadius: PAD_RADIUS,
    gates: round.gates.map(({ hold, ...gate }) => ({ ...gate, progress: Math.min(1, hold / HOLD_SECONDS) })),
  }
}

export function createVault() {
  return {
    type: 'vault', delivered: 0, total: 1, elapsed: 0,
    hazards: [
      { id: 0, x: -3, z: 1.75, radius: 0.73 },
      { id: 1, x: 3, z: -2.25, radius: 0.73 },
    ],
  }
}

export function moveVaultHazards(round, dt) {
  round.elapsed += dt
  for (const hazard of round.hazards) {
    const angle = round.elapsed * (hazard.id === 0 ? 0.95 : 1.15) - Math.PI / 2
    hazard.x = Math.sin(angle) * (hazard.id === 0 ? 3.8 : -3.8)
  }
}

export function vaultCollision(round, position, carriers) {
  return round.hazards.find(hazard => distance(hazard, position) <= hazard.radius + 0.8 ||
    carriers.some(player => distance(hazard, player) <= hazard.radius + 0.45))
}

export function vaultBotTarget(round, bot, partner) {
  const mega = round.mega
  if (mega.delivered) return bot
  if (!mega.carriers.includes(bot.id)) return mega
  if (mega.carriers.length < 2) return bot
  if (partner && !partner.isBot) {
    const range = distance(bot, partner)
    return range > 1.4 ? partner : bot
  }
  const x = 5.8
  if (mega.z > 3 && mega.x < x - 0.45) return { x, z: 4 }
  if (mega.z > -4.1) return { x, z: -4.7 }
  return mega.zone
}
