import assert from 'node:assert/strict';
import { loadSource } from './test-runtime.mjs';
const { createDisplayMode } = await loadSource('./display-mode.ts');
const mode = createDisplayMode();
let count = 0, unsubscribe;
const redraw = () => { count++; unsubscribe(); unsubscribe = mode.onChange(redraw); };
unsubscribe = mode.onChange(redraw);
for (const enabled of [false, true, false, true]) {
  const before = count;
  assert.equal(mode.setEnabled(enabled), true);
  assert.equal(count, before + 1, 'synchronous re-registration redraws once and remains registered');
}
assert.equal(mode.setEnabled(true), false);
assert.equal(count, 4);
let afterFailure = 0;
const removeFailure = mode.onChange(() => { throw new Error('fixture'); });
mode.onChange(() => afterFailure++);
assert.throws(() => mode.setEnabled(false), AggregateError);
assert.equal(afterFailure, 1, 'one refresh failure does not prevent remaining cleanup/refresh');
removeFailure();
mode.dispose();
assert.equal(mode.isEnabled(), false);
assert.equal(mode.setEnabled(true), false);
assert.equal(count, 5);
console.log('display mode synchronous redraw and disposal passed');
