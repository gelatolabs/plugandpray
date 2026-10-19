// The background music on the GelatoBoy (gb/musictest: song 1, as the games
// play it): it sounds, it loops, the host can mute it and move it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, state16, setCtrl16 } from './harness.mjs';

const CTRL = { ON: 26, POS: 27, SEQ: 29, SONG: 30 }, STATE_POS = 46;

// The loudness of what n frames played: the RMS of its changes (a steady
// offset, like a GB channel left on at volume 0, is silence).
function listen(sys, n) {
  let sum = 0, sq = 0, count = 0;
  sys.emu.drainAudio();
  for (let i = 0; i < n; i++) {
    sys.run(1);
    for (const s of sys.emu.drainAudio()) { sum += s; sq += s * s; count++; }
  }
  const mean = sum / Math.max(1, count);
  return Math.sqrt(Math.max(0, sq / Math.max(1, count) - mean * mean));
}

test('GB music: plays, mutes and unmutes, and jumps where the host says', async () => {
  const gb = await boot('gb', 'musictest.gb');
  assert.ok(listen(gb, 120) > 1000, 'it plays');
  const pos = state16(gb.link, STATE_POS);
  assert.ok(pos > 0, `it counts (row ${pos})`);
  // muted: silent, but still counting
  gb.link.setCtrl(CTRL.ON, 0);
  gb.run(2);
  assert.ok(listen(gb, 60) < 200, 'muted');
  assert.ok(state16(gb.link, STATE_POS) > pos, 'still counting while muted');
  gb.link.setCtrl(CTRL.ON, 1);
  assert.ok(listen(gb, 120) > 1000, 'back on');
  // jump to row 64 (bar 5)
  setCtrl16(gb.link, CTRL.POS, 64);
  gb.link.setCtrl(CTRL.SEQ, 1);
  gb.run(2);
  const at = state16(gb.link, STATE_POS);
  assert.ok(at >= 64 && at < 68, `jumped to row 64 (at ${at})`);
  // no song: silence
  gb.link.setCtrl(CTRL.SONG, 0);
  gb.run(2);
  assert.ok(listen(gb, 60) < 200, 'stopped');
});

test('GB music: loops back to the start at the end of the song', async () => {
  const gb = await boot('gb', 'musictest.gb');
  let max = 0, wrapped = false, last = 0;
  for (let i = 0; i < 60 * 20 && !wrapped; i++) {
    gb.run(1);
    const pos = state16(gb.link, STATE_POS);
    if (pos < last) wrapped = true;
    max = Math.max(max, pos);
    last = pos;
  }
  assert.ok(wrapped, 'it went back to the start');
  assert.ok(max >= 124 && max <= 127, `the demo's 8 bars are 128 rows (the last was ${max})`);
  assert.ok(listen(gb, 30) > 1000, 'and plays on');
});
