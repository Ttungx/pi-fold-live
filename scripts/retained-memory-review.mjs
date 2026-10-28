#!/usr/bin/env node
// Retained heap after GC, not temporary allocations. Synthetic sessions only.
import { createHash } from 'node:crypto';
import { makeProjectionFixture, disposePerformanceReview } from './performance-review.mjs';
import { loadSharedSource as loadSource, themeModule } from '../tests/test-runtime.mjs';

if (!globalThis.gc) throw new Error('Run with node --expose-gc');
const { fillBackground, clearDisplayLineCache } = await loadSource('./display-card.ts');
const heap = () => { for (let i = 0; i < 3; i++) globalThis.gc(); return process.memoryUsage().heapUsed; };
const releaseStack = () => new Promise(resolve => setImmediate(resolve));
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const results = [];
try {
  // Warm native classes before measuring fixture retention.
  for (const enabled of [false, true]) {
    let warm = makeProjectionFixture(8, enabled); warm.paint(); warm.dispose(); warm = undefined;
  }
  for (const turns of [48, 400]) for (const enabled of [false, true]) {
    const retained = [], released = [], hashes = new Set();
    for (let sample = 0; sample < 5; sample++) {
      await releaseStack();
      const before = heap();
      let fixture = makeProjectionFixture(turns, enabled);
      for (let i = 0; i < 3; i++) fixture.paint();
      retained.push(heap() - before);
      hashes.add(createHash('sha256').update(fixture.display.chatContainer.render(100).join('\n')).digest('hex'));
      fixture.dispose(); fixture = undefined;
      await releaseStack();
      released.push(heap() - before);
    }
    results.push({ turns, enabled, retainedHeapBytes: median(retained), afterDisposeBytes: median(released), samples: retained, outputHashes: [...hashes] });
  }
  // Warm this formatting path and release previous fixture stacks before the
  // saturation measurement; otherwise late collection obscures cache retention.
  for (let i = 0; i < 20000; i++) fillBackground(`warm/${i} 检查 ${'x'.repeat(100)}`, 120, themeModule.theme, 'toolPendingBg');
  clearDisplayLineCache?.(); await releaseStack();
  const before = heap(), churn = [];
  for (const count of [10000, 20000]) {
    for (let i = 0; i < count; i++) fillBackground(`${count}/${i} 检查 ${'x'.repeat(100)}`, 120, themeModule.theme, 'toolPendingBg');
    await releaseStack();
    churn.push({ formattedRows: count, retainedHeapBytes: heap() - before });
  }
  clearDisplayLineCache?.(); await releaseStack();
  console.log(JSON.stringify({ results, cacheChurn: churn, afterCacheClearBytes: heap() - before,
    limits: ['Process heap deltas after explicit GC; allocator/JIT noise applies.', 'Fixtures include native components and renderer state; compare identical scripts against baseline source.', 'Cache accounting is not a JavaScript heap limit. No model, tools, terminal transport or user data.'] }, null, 2));
} finally { disposePerformanceReview(); }
