// Runs a host mode (web/src/modes/*) against headless ROMs with a stub app.
import { boot } from './harness.mjs';
import { FlatLink } from '../web/src/linkgeo.js';

// gb: where the GB screen appears over the TV picture, in FlatLink units
// (the picture is 4 x 3, y down), or null for not linked.
export async function makeHost(Mode, game, { gb: gbRect = null, save = {} } = {}) {
  const gb = await boot('gb', `game${game}.gb`);
  const ps1 = await boot('ps1', `game${game}.exe`);
  gb.kind = 'gb';
  ps1.kind = 'ps1';
  const app = {
    gb, ps1, save, wins: [],
    linkGeo: new FlatLink(gbRect),
    effects: { zap() {}, burst() {} },
    persist() {},
    onWin(g) { this.wins.push(g); },
  };
  const mode = new Mode(app);
  const host = {
    app, mode, gb, ps1, msgs: [],
    // Steps both systems one frame with the given pad masks.
    step(gbMask = 0, psMask = 0) {
      for (const [sys, mask] of [[gb, gbMask], [ps1, psMask]]) {
        sys.input = mask;   // (as the app has it: what the modes see)
        sys.emu.setInput(mask);
        sys.emu.run();
        for (const m of sys.link.receive()) { host.msgs.push([sys.kind, m]); mode.onMessage(sys.kind, m); }
        mode.onFrame?.(sys);
      }
      mode.update(1 / 60);
    },
    run(n, gbMask = 0, psMask = 0) { for (let i = 0; i < n; i++) host.step(gbMask, psMask); },
    until(pred, max = 1200, masks = () => [0, 0]) {
      for (let i = 0; i < max; i++) {
        const [a, b] = masks(i);
        host.step(a, b);
        if (pred()) return true;
      }
      return false;
    },
  };
  return host;
}
