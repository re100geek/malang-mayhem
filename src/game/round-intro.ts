import type { PartyState } from './party-game'

export type IntroTiming = { openingMs: number; roundMs: number }
type Point = { x: number; z: number }
type Shot = { target: Point; approach?: Point }

const center = { x: 0, z: 0 }
const rules: Record<string, string> = {
  banana: '바나나를 주워 배달존에 넣으세요.',
  pizza: '짝꿍과 피자 재료를 중앙 작업대에 모으세요.',
  crown: '왕관을 차지하고 오래 버티세요.',
  balloon: '짝꿍과 풍선을 중앙 탑에 채우세요.',
  platform: '빛나는 발판 위에서 버티세요.',
  bomb: '폭탄이 터지기 전에 잡기나 장난으로 넘기세요.',
  sweeper: '회전 막대가 다가오면 점프로 넘으세요.',
  tail: '빈손이면 꼬리를 빼앗고, 꼬리가 있으면 지키세요.',
  herd: '미니 말랑이를 내 골대로 몰아넣으세요.',
  switch: '짝꿍과 각자 발판을 2.5초 동안 함께 밟으세요.',
  vault: '둘이 금고를 잡고 장애물을 피해 황금존까지 옮기세요.',
}

export function introRule(state: PartyState) {
  return rules[state.objects?.type] ?? state.round?.short ?? ''
}

export function introShot(state: PartyState, viewerId: string): Shot {
  const mine = state.players.find(player => player.id === viewerId)
  const partner = state.players.find(player => player.id === mine?.partnerId)
  const approach = mine && partner ? midpoint(mine, partner) : undefined
  const objects = state.objects
  switch (objects?.type) {
    case 'banana': return { target: objects.delivery }
    case 'pizza': return { target: objects.station, approach }
    case 'crown': return { target: objects.crown }
    case 'balloon': return { target: objects.tower, approach }
    case 'platform': return { target: state.platforms.find(tile => tile.color === state.targetColor) ?? center }
    case 'bomb': return { target: state.players.find(player => player.id === objects.bomb.holder) ?? objects.bomb }
    case 'sweeper': return { target: center, approach: { x: objects.sweeper.radius * .55, z: 0 } }
    case 'tail': {
      const holder = objects.tails.find((tail: { id: string }) => tail.id === viewerId) ?? objects.tails[0]
      return { target: state.players.find(player => player.id === holder?.id) ?? mine ?? center }
    }
    case 'herd': return { target: objects.goals.find((goal: Point & { id: string }) => goal.id === viewerId) ?? center }
    case 'switch': {
      const gate = objects.gates.find((entry: { pads: { id: string }[] }) => entry.pads.some(pad => pad.id === viewerId)) ?? objects.gates[0]
      return { target: gate ? midpoint(gate.pads[0], gate.pads[1]) : center, approach }
    }
    case 'vault': return { target: objects.mega, approach: approach ?? objects.mega.zone }
    default: return { target: center }
  }
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }
}

export function introFrame(timing: IntroTiming, remainingMs: number, skipped: boolean) {
  if (timing.openingMs > 0 && remainingMs > timing.roundMs) {
    const progress = clamp01(1 - (remainingMs - timing.roundMs) / timing.openingMs)
    return { kind: skipped ? 'ready' : 'opening', progress } as const
  }
  return { kind: 'round', progress: clamp01(timing.roundMs > 0 ? 1 - remainingMs / timing.roundMs : 1) } as const
}

export function landingHeight(progress: number, seat: number) {
  const elapsed = clamp01((progress - .25 - (seat - 1) * .025) / .52)
  if (elapsed < .62) return 2.1 * (1 - (elapsed / .62) ** 2)
  if (elapsed >= 1) return 0
  return .38 * Math.sin(Math.PI * (elapsed - .62) / .38)
}

function clamp01(value: number) { return Math.min(1, Math.max(0, value)) }
