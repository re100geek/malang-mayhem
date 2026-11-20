import type { PartyState, Player } from './party-game'
import type { NewRoundObjects } from './round-objects'

function direction(from: Player, to: { x: number; z: number }) {
  const dx = to.x - from.x
  const dz = to.z - from.z
  if (Math.hypot(dx, dz) < 1) return '바로 여기'
  const angle = Math.atan2(dx, -dz)
  return ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'][(Math.round(angle / (Math.PI / 4)) + 8) % 8]
}

export function newRoundObjective(state: PartyState, mine: Player | undefined) {
  const round = state.objects as NewRoundObjects | undefined
  if (round?.type === 'herd') {
    const goal = round.goals.find(zone => zone.id === mine?.id)
    const text = goal && mine ? `내 골대 ${goal.seat}번 ${direction(mine, goal)} · ${mine.roundScore}P` : '미니 말랑이 1마리당 100P'
    return { text, meter: 0 }
  }
  if (round?.type === 'switch') {
    const gate = round.gates.find(item => item.pads.some(pad => pad.id === mine?.id))
    const padIndex = gate?.pads.findIndex(pad => pad.id === mine?.id) ?? -1
    const pad = gate?.pads[padIndex]
    const text = gate && pad && mine
      ? gate.opened ? `문 ${gate.id + 1} 열림 · ${round.delivered}/${round.total}`
        : `문 ${gate.id + 1} · ${padIndex === 0 ? '원형' : '사각'} ${direction(mine, pad)} · 발판 ${gate.pads.filter(p => p.down).length}/2`
      : `문 ${round.delivered}/${round.total} 열림`
    return { text, meter: gate?.progress ?? round.delivered / Math.max(1, round.total) }
  }
  if (round?.type === 'vault') {
    const mega = state.objects.mega
    const count = mega.carriers.length
    const guide = mine ? direction(mine, mega.carriers.includes(mine.id) && count === 2 ? mega.zone : mega) : ''
    const text = mega.delivered ? '금고 배달 완료' : count === 2 ? (mine && mega.carriers.includes(mine.id) ? `합동 운반 중 · 황금존 ${guide}` : '두 명이 합동 운반 중') : `금고 ${guide} · 손잡이 ${count}/2`
    return { text, meter: round.delivered / round.total }
  }
}
