export type MatchSettings = { roundCount: number; botCount: number | null }

export function matchSettings(scope: 'title' | 'lobby') {
  return `
    <div class="match-settings">
      <label>라운드 수 <select id="${scope}-round-count">
        <option value="3">3판</option><option value="5" selected>5판</option>
      </select></label>
      <label>봇 수 <select id="${scope}-bot-count" aria-describedby="${scope}-bot-note">
        <option value="2">2명</option><option value="3">3명</option>
        <option value="4">4명</option><option value="5">5명</option>
      </select></label>
      <small id="${scope}-bot-note">최대 8명까지 참가</small>
    </div>`
}

export function matchSelect(scope: 'title' | 'lobby', setting: 'round-count' | 'bot-count') {
  return document.querySelector<HTMLSelectElement>(`#${scope}-${setting}`)!
}
