// The background music on the GelatoStation (ps1/musictest: song 1, as the
// games play it): it sounds, through the reverb, and the host can mute it
// and move it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, state16, setCtrl16 } from './harness.mjs';

const CTRL = { ON: 26, POS: 27, SEQ: 29, SONG: 30 }, STATE_POS = 46;

// The loudness (RMS) of what n frames played. (Waiting goes through this too:
// it empties the core's audio buffer as it goes, or the next listen would hear
// old sound.)
function listen(sys, n) {
  let sq = 0, count = 0;
  sys.emu.drainAudio();
  for (let i = 0; i < n; i++) {
    sys.run(1);
    for (const s of sys.emu.drainAudio()) { sq += s * s; count++; }
  }
  return Math.sqrt(sq / Math.max(1, count));
}

test('PS1 music: plays, mutes (the reverb dying away) and unmutes, and jumps where the host says', async () => {
  const ps = await boot('ps1', 'musictest.exe');
  assert.ok(listen(ps, 120) > 1000, 'it plays');
  const pos = state16(ps.link, STATE_POS);
  assert.ok(pos > 0, `it counts (row ${pos})`);
  // muted: the notes let go, their releases and the reverb ring on a little, then silence
  ps.link.setCtrl(CTRL.ON, 0);
  const tail = listen(ps, 30);
  assert.ok(tail > 20, `a tail after muting (${tail.toFixed(0)})`);
  listen(ps, 240);
  const quiet = listen(ps, 60);
  assert.ok(quiet < 20, `then silent (${quiet.toFixed(1)})`);
  assert.ok(state16(ps.link, STATE_POS) > pos, 'still counting while muted');
  ps.link.setCtrl(CTRL.ON, 1);
  assert.ok(listen(ps, 120) > 1000, 'back on');
  // jump to row 64 (bar 5)
  setCtrl16(ps.link, CTRL.POS, 64);
  ps.link.setCtrl(CTRL.SEQ, 1);
  ps.run(2);
  const at = state16(ps.link, STATE_POS);
  assert.ok(at >= 64 && at < 68, `jumped to row 64 (at ${at})`);
  // no song: silence
  ps.link.setCtrl(CTRL.SONG, 0);
  listen(ps, 240);
  assert.ok(listen(ps, 60) < 20, 'stopped');
});
