import assert from 'node:assert/strict';
import { loadSharedSource, themeModule } from './test-runtime.mjs';

const { DisplayLineCache } = await loadSharedSource('./display-line-cache.ts');
const { fillBackground } = await loadSharedSource('./display-card.ts');
const { default: register } = await loadSharedSource('../index.ts');
const nativeGet = DisplayLineCache.prototype.get;
let formats = 0;
DisplayLineCache.prototype.get = function(key, render) {
  return nativeGet.call(this, key, () => {
    if (key.includes('CACHE_PROBE')) formats++;
    return render();
  });
};
const probe = () => fillBackground('CACHE_PROBE', 80, themeModule.theme, 'toolPendingBg');
const expectCold = () => {
  const before = formats, output = probe();
  assert.equal(formats, before + 1, 'the shared display cache was cleared');
  assert.equal(probe(), output);
  assert.equal(formats, before + 1, 'the second render reuses the same cache');
};
const hooks = new Map(), bus = new Map();
const subscribe = (map, event, fn) => {
  const set = map.get(event) || new Set(); set.add(fn); map.set(event, set);
  return () => set.delete(fn);
};
const pi = {
  on: (event, fn) => subscribe(hooks, event, fn),
  events: { on: (event, fn) => subscribe(bus, event, fn), emit: (event, data) => {
    for (const fn of [...bus.get(event) || []]) fn(data);
  } },
  registerToolRenderer() {}, registerMarkdownTransformer() {}, registerCommand() {},
  registerShortcut() {}, appendEntry() {}, getCommands: () => [], getAllTools: () => [],
};
const ctx = { mode: 'none', hasUI: false, ui: {}, sessionManager: { getBranch: () => [], buildContextEntries: () => [] } };
const emit = event => { for (const fn of [...hooks.get(event) || []]) fn({}, ctx); };
try {
  expectCold();
  await register(pi);
  expectCold(); // Registration also removes text retained by a previous load.
  for (const event of ['session_start', 'session_tree', 'session_compact', 'session_before_switch', 'session_shutdown']) {
    emit(event); expectCold();
  }
  const before = formats;
  for (const event of ['session_start', 'session_tree', 'session_shutdown']) emit(event);
  probe();
  assert.equal(formats, before, 'disposed root callbacks do not clear a later cache');
  // A registration failure before any feature starts must still release shared text.
  await assert.rejects(() => register({ ...pi, on() { probe(); throw new Error('registration fixture'); } }), /registration fixture/);
  expectCold();
  console.log('Shared display cache lifecycle: registration, session transitions, shutdown, stale callbacks and failed startup passed');
} finally {
  emit('session_shutdown');
  DisplayLineCache.prototype.get = nativeGet;
}
