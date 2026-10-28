import assert from 'node:assert/strict';
import { core, tui, loadAgent, loadSource, themeModule } from './test-runtime.mjs';
const { installSubagentSpacingAdapter } = await loadSource('./modern-subagent-spacing.ts');
const { CustomEntryComponent } = await loadAgent('modes/interactive/components/custom-entry.js');
const hidden = Symbol.for('compact-renderer:subagent-hidden:v1');
const original = tui.Container.prototype.render;
let swallowed = true;
const renderer = () => ({ [hidden]: () => swallowed, render: () => swallowed ? [] : ['recorded content'], invalidate() {} });
const message = new core.CustomMessageComponent({ role: 'custom', customType: 'subagent-notify', content: 'recorded content', display: true }, renderer, themeModule.getMarkdownTheme());
const entry = new CustomEntryComponent({ type: 'custom', customType: 'subagent_supervisor_reply', data: {} }, renderer);
const nativeEmpty = new core.CustomMessageComponent({ role: 'custom', customType: 'other', content: '', display: true }, () => ({ render: () => [], invalidate() {} }));
const before = nativeEmpty.render(80);
assert.deepEqual(message.render(80), [''], 'native host owns a spacer even when inner output is empty');
const dispose = installSubagentSpacingAdapter();
try {
  assert.deepEqual(message.render(80), []);
  assert.deepEqual(entry.render(80), []);
  assert.deepEqual(nativeEmpty.render(80), before, 'unmarked empty renderers preserve native spacing');
  const ordinary = new tui.Container(); ordinary.customComponent = renderer(); ordinary.addChild(ordinary.customComponent);
  ordinary.addChild(new tui.Text('ordinary row', 0, 0));
  assert.deepEqual(ordinary.render(80), original.call(ordinary, 80), 'ordinary containers are untouched even with a marker');
  swallowed = false;
  assert.deepEqual(message.render(80), ['', 'recorded content']);
  assert.deepEqual(entry.render(80), ['', 'recorded content']);
  swallowed = true;
  dispose(); dispose();
  assert.equal(tui.Container.prototype.render, original);
  assert.deepEqual(message.render(80), ['']);
  { const cleanup = installSubagentSpacingAdapter('future'); assert.equal(typeof cleanup, 'function'); cleanup(); }
  const first = installSubagentSpacingAdapter(), second = installSubagentSpacingAdapter();
  first(); assert.deepEqual(message.render(80), [], 'stale cleanup cannot remove a newer owner');
  second(); assert.equal(tui.Container.prototype.render, original);
  console.log('subagent spacing: native message/entry followers, fallback and disposal passed');
} finally { dispose(); }
