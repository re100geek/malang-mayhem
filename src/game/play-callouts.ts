import type { PartyState, Player } from './party-game'

type Notice = { text: string; priority: number }
const keepMs = 1650

export class PlayCallouts {
  private previous?: { time: number; mission: number; respawning: boolean }
  private leader?: string
  private bombWarningFor?: boolean
  private active?: Notice
  private queue: Notice[] = []
  private expires = 0

  constructor(private readonly banner: HTMLElement) {}

  sync(state: PartyState | null, viewerId: string, now: number) {
    if (state?.phase !== 'play' || !state.round) {
      this.previous = undefined
      this.leader = undefined
      this.bombWarningFor = undefined
      this.clear()
      return
    }
    const mine = state.players.find(player => player.id === viewerId)
    if (!mine) return
    const prior = this.previous
    const time = state.round.timeLeft
    const fuse = state.objects?.bomb?.fuse ?? 0
    const mission = mine.missionProgress ?? 0
    const respawning = Boolean(mine.respawning)
    this.previous = { time, mission, respawning }

    if (!prior && mine.partnerId) this.offer({ text: '짝꿍 연결 완료! 고무줄이 당기면 발맞춰요.', priority: 1 }, now)
    if (prior && !state.round.completed && prior.time > 10 && time <= 10) {
      this.offer({ text: '마지막 10초! 말랑하게 스퍼트!', priority: 2 }, now)
    }
    if (prior?.respawning && !respawning) this.offer({ text: '말랑이 복귀! 지금은 잠깐 무적이에요.', priority: 3 }, now)
    const card = mine.secretMission
    if (prior && card && card.kind !== 'bonk_winner' && prior.mission < card.target && mission >= card.target) {
      this.offer({ text: '쉿! 비밀 장난 미션 성공!', priority: 3 }, now)
    }
    const holdingBomb = state.objects?.bomb?.holder === mine.id
    if (fuse <= 0 || fuse > 3) {
      this.bombWarningFor = undefined
    } else if (this.bombWarningFor !== holdingBomb) {
      this.bombWarningFor = holdingBomb
      const text = holdingBomb ? '폭탄 3초 이하! 지금 넘겨요!' : '폭탄 3초 이하! 폭탄에서 멀어져요!'
      this.offer({ text, priority: 4 }, now)
    }
    if (state.objects?.type === 'tail') this.checkTailLead(state.players, mine, now)
  }

  tailSteal(event: { attackerId: string; targetId: string }, viewerId: string, now: number) {
    const text = event.attackerId === viewerId ? '꼬리 강탈 성공! 이제 도망쳐요!'
      : event.targetId === viewerId ? '꼬리를 빼앗겼어요! 다시 낚아채요!' : '꼬리 강탈! 보유자가 바뀌었어요.'
    this.offer({ text, priority: 2 }, now)
  }

  tick(now: number) {
    if (!this.active || now < this.expires) return
    const next = this.queue.shift()
    if (next) this.show(next, now)
    else this.clear()
  }

  private checkTailLead(players: Player[], mine: Player, now: number) {
    const opponent = players.reduce((high, player) =>
      player.connected && player.id !== mine.id && (!high || player.roundScore > high.roundScore) ? player : high,
    undefined as Player | undefined)
    if (!opponent || mine.roundScore === opponent.roundScore) return
    const leader = mine.roundScore > opponent.roundScore ? mine.id : opponent.id
    if (this.leader && this.leader !== mine.id && leader === mine.id) {
      this.offer({ text: '역전! 꼬리를 지켜 선두를 유지해요!', priority: 2 }, now)
    }
    this.leader = leader
  }

  private offer(notice: Notice, now: number) {
    if (this.active?.text === notice.text || this.queue.some(item => item.text === notice.text)) return
    if (!this.active || notice.priority > this.active.priority || notice.priority === 4) {
      if (this.active?.priority === 3 && this.queue.length < 2) this.queue.unshift(this.active)
      this.show(notice, now)
    } else if (this.queue.length < 2 && notice.priority !== 4) this.queue.push(notice)
  }

  private show(notice: Notice, now: number) {
    this.active = notice
    this.expires = now + keepMs
    this.banner.textContent = notice.text
    this.banner.classList.add('is-visible')
    this.banner.classList.toggle('is-urgent', notice.priority === 4)
  }

  private clear() {
    if (!this.active) return
    this.active = undefined
    this.queue.length = 0
    this.banner.classList.remove('is-visible', 'is-urgent')
    this.banner.textContent = ''
  }
}
