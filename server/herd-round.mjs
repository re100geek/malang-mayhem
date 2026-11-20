const GOAL_RADIUS = 1.45
const PUSH_RADIUS = 2.25
const FIELD_RADIUS = 8.9
const points = 100
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z)

function wanderer(id, generation = 0, delay = 0) {
  const angle = id * Math.PI * 2 / 10 + generation * 2.4
  const radius = 1.2 + (id % 3) * 1.05
  return { id, x: Math.cos(angle) * radius, z: Math.sin(angle) * radius, angle, generation, delay }
}

export function createHerd(players) {
  return {
    type: 'herd',
    goals: players.map(player => {
      const angle = (player.seat - 1) * Math.PI / 4
      return { id: player.id, seat: player.seat, color: player.color, x: Math.cos(angle) * 7.4, z: Math.sin(angle) * 7.4, radius: GOAL_RADIUS }
    }),
    critters: Array.from({ length: 10 }, (_, id) => wanderer(id)),
    elapsed: 0,
  }
}

export function tickHerd(round, players, dt, emit) {
  round.elapsed += dt
  const live = players.filter(player => !player.respawning)
  const byId = new Map(live.map(player => [player.id, player]))
  for (const critter of round.critters) {
    if (critter.delay > 0) { critter.delay -= dt; continue }
    let closest
    let range = PUSH_RADIUS
    for (const player of live) {
      if (player.jumpY > 0.5) continue
      const gap = distance(player, critter)
      if (gap < range) { range = gap; closest = player }
    }
    const flee = closest && range > 0.001
    const angle = flee ? Math.atan2(critter.z - closest.z, critter.x - closest.x) : critter.angle + Math.sin(round.elapsed * 0.85 + critter.id) * 0.55
    const speed = flee ? 2.35 + (PUSH_RADIUS - range) * 0.6 : 0.65
    critter.x += Math.cos(angle) * speed * dt
    critter.z += Math.sin(angle) * speed * dt
    const goal = round.goals.find(zone => byId.has(zone.id) && distance(zone, critter) <= zone.radius)
    if (goal) {
      const owner = byId.get(goal.id)
      owner.roundScore += points
      owner.contribution++
      emit('herd_score', `골대 ${goal.seat}에 미니 말랑이 도착! +${points}P`, { x: goal.x, z: goal.z, playerId: owner.id })
      Object.assign(critter, wanderer(critter.id, critter.generation + 1, 1.2))
      continue
    }
    const radius = Math.hypot(critter.x, critter.z)
    if (radius > FIELD_RADIUS) {
      critter.x *= FIELD_RADIUS / radius
      critter.z *= FIELD_RADIUS / radius
      critter.angle = Math.atan2(-critter.z, -critter.x)
    }
  }
}

export function herdBotTarget(round, bot) {
  const goal = round.goals.find(zone => zone.id === bot.id)
  const critter = round.critters.filter(item => item.delay <= 0).sort((a, b) => distance(bot, a) - distance(bot, b))[0]
  if (!goal || !critter) return bot
  const length = distance(goal, critter) || 1
  const x = critter.x + (critter.x - goal.x) / length * 1.55
  const z = critter.z + (critter.z - goal.z) / length * 1.55
  const scale = Math.min(1, 9 / (Math.hypot(x, z) || 1))
  return { x: x * scale, z: z * scale }
}

export function herdSnapshot(round) {
  return {
    goals: round.goals,
    critters: round.critters.filter(item => item.delay <= 0).map(({ id, x, z, generation }) => ({ id, x, z, generation })),
  }
}
