// The background music: both consoles play the same song all the time, in
// step, and only the one the player's on is heard:
// in the platformer and the fighter, wherever the player's character is; in
// the shooter, whichever screen the last zapper shot hit. The other one keeps
// counting, muted, so switching swaps the version mid-bar.
//
// The GB runs at 59.73 frames a second and the GelatoStation at 59.94, so the
// muted one drifts: it's put back where the heard one is whenever it's two rows
// (16ths) or more out (one row is just the time the news takes to get there).
const CTRL_ON = 26, CTRL_POS = 27, CTRL_SEQ = 29, CTRL_SONG = 30, STATE_POS = 46;

export class Music {
  constructor(app) {
    this.app = app;
    this.seq = { gb: 0, ps1: 0 };
  }

  // Which console is heard now: 'gb', 'ps1' or null (no music).
  heard() {
    const m = this.app.mode;
    if (!m || !this.song()) return null;
    return m.musicOn ?? 'ps1';
  }

  // The song for what's running (0: none): each game its own (song 1 the
  // platformer's, 2 the fighter's, 3 the shooter's: see assets/music/tools).
  song() {
    const g = this.app.modeGame;
    return g === 1 || g === 2 || g === 3 ? g : 0;
  }

  update() {
    const app = this.app, song = this.song(), heard = this.heard();
    const systems = { gb: app.gb, ps1: app.ps1 };
    for (const [name, sys] of Object.entries(systems)) {
      if (!sys.ready) continue;
      sys.link.setCtrl(CTRL_SONG, song);
      sys.link.setCtrl(CTRL_ON, name === heard ? 1 : 0);
    }
    if (!heard) return;
    const lead = systems[heard], name = heard === 'gb' ? 'ps1' : 'gb', other = systems[name];
    if (!lead.ready || !other.ready) return;
    const pos = (s) => s.link.state(STATE_POS) | (s.link.state(STATE_POS + 1) << 8);
    const at = pos(lead);
    if (Math.abs(pos(other) - at) >= 2) {
      other.link.setCtrl(CTRL_POS, at & 0xff);
      other.link.setCtrl(CTRL_POS + 1, at >> 8);
      other.link.setCtrl(CTRL_SEQ, (this.seq[name] = (this.seq[name] + 1) & 0xff));
    }
  }
}
