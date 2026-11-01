#!/usr/bin/env node
// Ablation probe for the OMP compact tool rows (src/omp-tool-rows.ts).
// Compares the pre-optimization full scan, a capped scan, and the shipped implementation.
// Prints one JSON line; no agent, model, tool, or network request runs.
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { loadSource } = await import(pathToFileURL(path.join(root, 'tests/test-runtime.mjs')).href);
const { compactToolRows } = await loadSource('omp-tool-rows.ts');
const { activityHeading, activityRow, cardContentWidth, clearDisplayLineCache } = await loadSource('display-card.ts');
const Tui = await import(pathToFileURL(path.join(root, 'node_modules/@earendil-works/pi-tui/dist/index.js')).href);

const width = 100;
const frames = 200;
const rounds = 5;
const sizes = [100, 5000, 50000];
const limit = 8192;
const theme = { fg: (_token, text) => text, bold: text => text };
const args = { command: 'seq 50000' };
const textOf = result => (result.content ?? []).filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n');
const tailFull = result => textOf(result).replace(/\r/g, '').split('\n').map(line => line.trimEnd()).filter(line => line.trim()).slice(-3);
const tailCapped = result => { const text = textOf(result); return (text.length > limit ? text.slice(-limit) : text).replace(/\r/g, '').split('\n').map(line => line.trimEnd()).filter(line => line.trim()).slice(-3); };
const windowRows = tail => {
  const bodyWidth = Math.max(1, cardContentWidth(width) - 3);
  const rows = [activityRow(activityHeading('▾ bash · seq 50000 · running', theme), width, theme)];
  for (const line of tail) rows.push(activityRow(`   ${theme.fg('text', Tui.truncateToWidth(line, bodyWidth, '…'))}`, width, theme));
  while (rows.length <= 3) rows.push(activityRow('', width, theme));
  return rows;
};
const arms = {
  'full-scan': result => windowRows(tailFull(result)),
  capped: result => windowRows(tailCapped(result)),
  current: result => compactToolRows('bash', args, result, true, theme, width),
};

const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
const makeText = lines => Array.from({ length: lines }, (_, index) => `output line ${index + 1} with some padding text`).join('\n');
const measurement = (render, repaintResult, streamResults) => {
  for (let index = 0; index < 20; index++) render(repaintResult);
  let start = performance.now();
  for (let index = 0; index < frames; index++) render(repaintResult);
  const repaint = (performance.now() - start) / frames;
  for (let index = 0; index < 20; index++) render(streamResults[index % frames]);
  start = performance.now();
  for (let index = 0; index < frames; index++) render(streamResults[index]);
  const stream = (performance.now() - start) / frames;
  return { repaint, stream };
};

const report = { width, frames, rounds, sizes: [] };
for (const lines of sizes) {
  const text = makeText(lines);
  // Prebuild the stream text so the measurement covers rendering, not this script's concatenation.
  const streamTexts = Array.from({ length: frames }, (_, index) => `${text}\nchunk ${index}`);
  const repaintResult = { content: [{ type: 'text', text }], details: {} };
  const scores = Object.fromEntries(Object.keys(arms).map(name => [name, { repaint: [], stream: [] }]));
  const names = Object.keys(arms);
  for (let round = 0; round < rounds; round++) {
    // Rotate the arm order so JIT warmup does not favour the first one.
    for (const name of [...names.slice(round % names.length), ...names.slice(0, round % names.length)]) {
      clearDisplayLineCache();
      // Fresh wrappers every round: the shipped renderer memoizes per result object, and a stream
      // never re-renders the same snapshot, so the cache must not leak across rounds.
      const streamResults = streamTexts.map(value => ({ content: [{ type: 'text', text: value }], details: {} }));
      const result = measurement(arms[name], repaintResult, streamResults);
      scores[name].repaint.push(result.repaint);
      scores[name].stream.push(result.stream);
    }
  }
  const measured = Object.fromEntries(names.map(name => [name, { repaintMs: +median(scores[name].repaint).toFixed(3), streamMs: +median(scores[name].stream).toFixed(3) }]));
  report.sizes.push({ lines, bytes: text.length, arms: measured, speedup: {
    repaint: +(measured['full-scan'].repaintMs / measured.current.repaintMs).toFixed(1),
    stream: +(measured['full-scan'].streamMs / measured.current.streamMs).toFixed(1),
  } });
}
console.log(JSON.stringify(report));
