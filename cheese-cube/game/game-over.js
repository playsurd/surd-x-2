// The end of a match as _zm.gsc end_game() runs it: two hud lines fade in over a second ("GAME OVER", font scale 3,
// 130 units above centre, and "You Survived N Rounds", scale 2, 100 units above), the scoreboard is forced up, and
// after 15 s the text goes; 1.5 s later the level exits. The escape ending uses "ZK would be proud! You Have Escaped".
const el = (tag, cls, parent, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; parent?.append(e); return e; };
const PLAYER_COLORS = ['#f0d54a', '#5aa9ff', '#ffd23f', '#5fd068'];
export const GAME_OVER_TEXT = 15, GAME_OVER_EXIT = 16.5;

export const survivedText = round => `You Survived ${round} Round${round === 1 ? '' : 's'}`;

export class GameOver {
  constructor() {
    this.root = el('div', 'game-over', document.body); this.root.hidden = true;
    this.title = el('div', 'game-over-title', this.root);
    this.subtitle = el('div', 'game-over-subtitle', this.root);
    const board = this.board = el('section', 'game-over-board', this.root);
    const head = el('header', 'game-over-head', board);
    this.map = el('span', 'map', head); this.round = el('span', 'round', head);
    const columns = el('div', 'game-over-row columns', board);
    for (const name of ['', 'Score', 'Kills', 'Downs', 'Revives', 'Headshots']) el('span', '', columns, name);
    this.rows = el('div', 'game-over-rows', board);
    this.footer = el('footer', 'game-over-footer', this.root);
    this.time = 0;
  }
  get visible() { return !this.root.hidden; }

  /** `players`: [{name, slot, points, kills, downs, revives, headshots, local}]. */
  show({won, round, map, players, footer = ''}) {
    this.title.textContent = won ? 'ZK would be proud! You Have Escaped' : 'GAME OVER';
    this.title.classList.toggle('escaped', Boolean(won));
    this.subtitle.textContent = survivedText(round);
    this.map.textContent = map; this.round.textContent = `Round ${round}`;
    this.setPlayers(players);
    this.footer.textContent = footer;
    this.time = 0; this.root.hidden = false; this.update(0);
  }
  setPlayers(players) {
    const key = JSON.stringify(players);
    if (key === this.playersKey) return;
    this.playersKey = key;
    this.rows.replaceChildren(...players.map(p => {
      const row = el('div', `game-over-row player${p.local ? ' local' : ''}`);
      el('span', 'name', row, p.name).style.color = PLAYER_COLORS[p.slot % PLAYER_COLORS.length];
      for (const value of [p.points, p.kills, p.downs, p.revives, p.headshots]) el('span', '', row, String(value ?? 0));
      return row;
    }));
  }
  setFooter(text) { if (this.footer.textContent !== text) this.footer.textContent = text; }
  /** Advances the sequence: the lines fade in over 1 s after 0.1 s and are removed at 15 s. */
  update(dt) {
    if (this.root.hidden) return;
    this.time += dt;
    const alpha = this.time >= GAME_OVER_TEXT ? 0 : Math.min(1, Math.max(0, (this.time - .1) / 1));
    this.title.style.opacity = this.subtitle.style.opacity = String(alpha);
  }
  hide() { this.root.hidden = true; this.playersKey = null; }
}
