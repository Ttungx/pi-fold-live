import assert from 'node:assert/strict';
import { core, tui, loadSource, loadAgent, stripAnsi } from './test-runtime.mjs';

const { inspectRuntime } = await loadSource('runtime-compatibility.ts');
const { registerModernTools } = await loadSource('modern-tools.ts');
const { SubagentProjection } = await loadSource('modern-subagent-groups.ts');
const { ToolExecutionComponent } = await loadAgent('modes/interactive/components/tool-execution.js');
const plain = component => stripAnsi(component.render(100).join('\n'));

function fixture(entries = []) {
  const hooks = new Map(), events = new Map();
  let resolver;
  const on = (map, name, callback) => {
    const list = map.get(name) || [];
    map.set(name, [...list, callback]);
    return () => map.set(name, (map.get(name) || []).filter(item => item !== callback));
  };
  const pi = {
    on: (name, callback) => on(hooks, name, callback),
    registerCommand() {}, registerMarkdownTransformer() {}, getCommands: () => [], appendEntry() {},
    registerToolRenderer(callback) { resolver = callback; },
    events: {
      on: (name, callback) => on(events, name, callback),
      emit(name, value) { for (const callback of events.get(name) || []) callback(value); },
    },
  };
  const context = { hasUI: true, sessionManager: { getBranch: () => entries }, ui: { onTerminalInput: () => () => {} } };
  return {
    pi, hooks,
    mode: { isEnabled: () => true, onChange: () => () => {} },
    start() { for (const callback of hooks.get('session_start') || []) callback({}, context); },
    create(name, id, args, stock) {
      const component = new ToolExecutionComponent(name, id, args, { showImages: false, outputPad: 0 }, resolver(name, () => stock), { requestRender() {} }, '/synthetic');
      component.setArgsComplete();
      return component;
    },
  };
}

// This sequence would hide the tool behind a custom-message group leader.
// A missing resolver must leave that tool available in its own card.
{
  const receipt = { role: 'toolResult', toolCallId: 'status-1', toolName: 'subagent', content: [{ type: 'text', text: 'Exact visible status receipt' }], details: { agent: 'worker' }, timestamp: 3 };
  const entries = [
    { type: 'custom_message', id: 'notice-1', customType: 'subagent-notify', content: 'Exact native completion notice', details: { runs: [{ agent: 'worker', status: 'completed' }] }, display: true, timestamp: 1 },
    { type: 'message', id: 'call-1', message: { role: 'assistant', content: [{ type: 'toolCall', id: receipt.toolCallId, name: 'subagent', arguments: { agent: 'worker', action: 'status' } }], timestamp: 2 } },
    { type: 'message', id: 'result-1', message: receipt },
  ];
  const projection = new SubagentProjection();
  projection.rebuild(entries);
  assert.equal(projection.viewTool(receipt.toolCallId).hidden, true, 'fixture exercises a hidden tool follower');
  const f = fixture(entries);
  const report = inspectRuntime(f.pi, { ...core, ExtensionRunner: undefined }, tui);
  assert.equal(report.available('subagents'), false);
  assert.equal(report.available('tools'), true);
  const dispose = registerModernTools(f.pi, f.mode, { images: report.available('images'), subagents: report.available('subagents') });
  try {
    f.start();
    const component = f.create('subagent', receipt.toolCallId, { agent: 'worker', action: 'status' }, {
      renderCall: () => new tui.Text('Native status call', 0, 0),
      renderResult: () => new tui.Text('Native status result', 0, 0),
    });
    component.updateResult(receipt);
    component.setExpanded(true);
    assert.match(plain(component), /Exact visible status receipt/);
    assert.equal(f.hooks.get('message_update')?.length, undefined, 'disabled grouping acquires no shared projection listener');
    const choices = [];
    f.pi.events.emit('compact-renderer:inspect:v1', { add: choice => choices.push(choice) });
    assert.equal(choices.length, 1, 'standalone subagent tool remains inspectable');
  } finally { dispose(); }
}

// The result can introduce an image after the compact call component exists.
// Both native renderer shell contracts must retain their complete output.
for (const self of [false, true]) {
  const f = fixture();
  const nativeRender = ToolExecutionComponent.prototype.render;
  const dispose = registerModernTools(f.pi, f.mode, { images: false, subagents: false });
  try {
    assert.equal(ToolExecutionComponent.prototype.render, nativeRender, 'disabled images install no prototype hook');
    f.start();
    const component = f.create('read', `image-fallback-${self}`, { path: '/synthetic/image.png' }, {
      ...(self ? { renderShell: 'self' } : {}),
      renderCall: () => new tui.Text('STOCK CALL', 0, 0),
      renderResult: () => new tui.Text('STOCK IMAGE RESULT', 0, 0),
    });
    component.render(100);
    component.updateResult({ content: [{ type: 'image', data: 'synthetic', mimeType: 'image/png' }], details: {} });
    const output = plain(component);
    assert.match(output, /STOCK CALL/);
    assert.match(output, /STOCK IMAGE RESULT/);
    assert.doesNotMatch(output, /▸ read/);
    const choices = [];
    f.pi.events.emit('compact-renderer:inspect:v1', { add: choice => choices.push(choice) });
    assert.equal(choices.length, 0, 'native image fallback is absent from Pi Fold inspection');
  } finally { dispose(); }
  assert.equal(ToolExecutionComponent.prototype.render, nativeRender);
}
console.log('compatibility fallbacks: missing subagent resolver preserves tool output; disabled images preserve native shells and cleanup');
