import { audioButton } from './game-audio'
import { matchSettings } from './match-settings'

export function warmupPanel(colors: string[], names: string[]): string {
  return `
    <section class="screen lobby-screen warmup-screen" data-screen="lobby" aria-label="몸풀기 광장">
      <aside class="warmup-panel">
        <header>
          <h2>몸풀기 광장 <small id="lobby-count">0/8</small></h2>
          <button class="room-code" data-action="copy" aria-label="방 초대 링크 복사">------</button>
          ${audioButton}
        </header>
        <div class="warmup-actions">
          <button data-action="ready" id="ready-btn" aria-pressed="false">준비 완료</button>
          <button class="primary" data-action="start" id="start-btn">게임 시작</button>
        </div>
        <details class="lobby-details">
          <summary>매치 설정 · 초대 · 프로필</summary>
          <div class="warmup-settings">
            <section class="warmup-next" aria-label="첫 라운드">
              <strong id="next-title"></strong> <small id="next-stats"></small>
              <p id="next-desc"></p>
            </section>
            ${matchSettings('lobby')}
            <div class="lobby-rename">
              <label for="lobby-nickname">닉네임</label>
              <input id="lobby-nickname" maxlength="14" autocomplete="off">
              <button data-action="rename">변경</button>
              <div class="lobby-colors">${colors.map((color, i) => `<button class="color-pick" data-color="${i}" style="--pick:${color}" aria-label="${names[i]}"></button>`).join('')}</div>
            </div>
            <div class="player-list" id="player-list"></div>
            <div class="invite-panel">
              <input id="invite-link" aria-label="방 초대 링크" readonly>
              <div class="warmup-actions">
                <button data-action="share">공유</button>
                <button data-action="copy-invite">링크 복사</button>
                <button data-action="toggle-qr" aria-controls="qr-code" aria-expanded="false">QR 보기</button>
              </div>
              <canvas id="qr-code" width="156" height="156" aria-label="방 초대 QR 코드"></canvas>
            </div>
            <button data-action="leave">방 나가기</button>
          </div>
        </details>
      </aside>
    </section>`
}
