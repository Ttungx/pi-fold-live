import assert from 'node:assert/strict';
import { loadSource, tui, backgroundCells } from './test-runtime.mjs';

const { DisplayLineCache } = await loadSource('./display-line-cache.ts');
const { activityRow, fillBackground, clearDisplayLineCache } = await loadSource('./display-card.ts');

// Reuse, eviction, oversized bypass and clearing must never change the result.
const cache = new DisplayLineCache(512, 2);
let calculations = 0;
const get = key => cache.get(key, () => { calculations++; return `formatted:${key}`; });
assert.equal(get('a'), get('a')); assert.equal(calculations, 1);
get('b'); get('a'); get('c'); // b is the least recently used entry.
get('a'); assert.equal(calculations, 3);
get('b'); assert.equal(calculations, 4);
for (let i = 0; i < 1000; i++) {
  const key = `${i}:${'x'.repeat(i % 300)}`;
  assert.equal(get(key), `formatted:${key}`);
  assert.ok(cache.chargedBytes <= 512);
}
cache.clear(); assert.equal(cache.chargedBytes, 0);
const prior = calculations;
get('x'.repeat(1000)); get('x'.repeat(1000));
assert.equal(calculations, prior + 2, 'oversized entries are not retained');
assert.equal(cache.chargedBytes, 0);

// A theme can change its colors without changing object identity.
let color = 42;
const theme = { bg: (_token, text) => `\x1b[${color}m${text}\x1b[49m` };
for (const line of ['Read files', '检查结果 🧪 e\u0301', '\x1b[1mBold\x1b[0m and \x1b[48;5;49mcolored\x1b[49m', 'x'.repeat(5000)]) {
  for (const width of [1, 7, 80]) {
    for (color of [42, 44, 42]) {
      for (const selected of [false, true]) {
        const warm = activityRow(line, width, theme, selected);
        assert.equal(activityRow(line, width, theme, selected), warm);
        clearDisplayLineCache();
        assert.equal(activityRow(line, width, theme, selected), warm, 'eviction preserves Unicode, ANSI and selection');
        assert.ok(tui.visibleWidth(warm) <= width);
      }
      const filled = fillBackground('sample', width, theme, 'ignored');
      assert.ok(backgroundCells(filled).every(cell => cell === String(color)), 'in-place theme change uses current color');
      assert.equal(tui.visibleWidth(filled), width);
    }
  }
}
assert.notEqual(fillBackground('old', 10, theme, ''), fillBackground('new', 10, theme, ''));
assert.equal(fillBackground('text', 8, undefined, ''), 'text    ');
assert.equal(fillBackground('text', 8, { bg: () => '' }, ''), 'text    \x1b[49m');
console.log('Display-line cache: reuse, bounds, eviction, clearing, Unicode, ANSI, themes, widths and selection passed');
