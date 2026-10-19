// A browser-style Worker for node tests, on worker_threads: enough of one
// (postMessage, onmessage, terminate) to run web/src/emu.worker.js.
import { Worker as NodeWorker } from 'node:worker_threads';

const BOOT = `
import { parentPort, workerData } from 'node:worker_threads';
globalThis.self = globalThis;
globalThis.postMessage = (d, t) => parentPort.postMessage(d, t);
const early = [];
parentPort.on('message', (d) => (self.onmessage ? self.onmessage({ data: d }) : early.push(d)));
await import(workerData.url);
for (const d of early) self.onmessage({ data: d });
`;

export class Worker {
  constructor(url) {
    this.w = new NodeWorker(new URL('data:text/javascript,' + encodeURIComponent(BOOT)), { workerData: { url: String(url) } });
    this.w.on('message', (data) => this.onmessage?.({ data }));
    this.w.on('error', (e) => this.onerror?.(e));
  }

  postMessage(data, transfer = []) { this.w.postMessage(data, transfer); }
  terminate() { this.w.terminate(); }
}
