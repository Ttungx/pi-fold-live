import assert from 'node:assert/strict';
import { core, loadAgent, loadSource, stripAnsi, tui } from './test-runtime.mjs';

const { registerModernTools } = await loadSource('./modern-tools.ts');
const { createDisplayMode } = await loadSource('./display-mode.ts');
const { ToolExecutionComponent } = await loadAgent('modes/interactive/components/tool-execution.js');
const { createShellRenderers } = await loadAgent('core/tools/renderers/bash.js');
const { readRenderers } = await loadAgent('core/tools/renderers/read.js');
const { codemodeRenderers } = await loadAgent('extensions/codemode/renderer.js');
const native = new Map([['bash', createShellRenderers('$')], ['read', readRenderers], ['codemode', codemodeRenderers]]);
const hooks = new Map(), bus = new Map();
let resolver;
const pi = {
  registerToolRenderer(fn) { resolver = fn; },
  on(name, fn) {
    const listeners = hooks.get(name) || new Set(); listeners.add(fn); hooks.set(name, listeners);
    return () => listeners.delete(fn);
  },
  events: {
    on(name, fn) {
      const listeners = bus.get(name) || new Set(); listeners.add(fn); bus.set(name, listeners);
      return () => listeners.delete(fn);
    },
    emit(name, value) { for (const fn of [...(bus.get(name) || [])]) fn(value); },
  },
};
const mode = createDisplayMode();
const dispose = registerModernTools(pi, mode);
const result = text => ({ content: [{ type: 'text', text }] });
const mcpName = 'mcp__fixture__query_readonly';
// In-memory PNG data only; the recorded read path is never opened.
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
const image = () => ({ type: 'image', mimeType: 'image/png', data: png });
const fixture = [
  { name: 'bash', id: 'history-bash', args: { command: 'printf recorded-bash' }, result: { ...result('EXACT_RECORDED_BASH_OUTPUT'), details: { exitCode: 0 } } },
  { name: mcpName, id: 'history-mcp', args: { sql: 'SELECT synthetic_fixture' }, result: result('EXACT_RECORDED_MCP_OUTPUT') },
  { name: 'codemode', id: 'history-code', args: { code: 'text("RECORDED_CODE_SOURCE");' }, result: { ...result('EXACT_RECORDED_CODE_OUTPUT'), details: { calls: [] }, durationMs: 25 } },
  { name: 'read', id: 'history-image-read', args: { path: '/synthetic-reload/image.png' }, result: { content: [...result('EXACT_RECORDED_IMAGE_READ_OUTPUT').content, image()] } },
  { name: 'codemode', id: 'history-image-code', args: { code: 'text("RECORDED_IMAGE_CODE_SOURCE");' }, result: { content: [...result('EXACT_RECORDED_IMAGE_CODE_OUTPUT').content, image(), image()], details: { calls: [] }, durationMs: 25 } },
];
const recorded = core.SessionManager.inMemory('/synthetic-reload');
for (const item of fixture) {
  recorded.appendMessage({ role: 'assistant', content: [{ type: 'toolCall', id: item.id, name: item.name, arguments: item.args }] });
  recorded.appendMessage({ role: 'toolResult', toolCallId: item.id, toolName: item.name, ...item.result });
}
const originalBranch = JSON.stringify(recorded.getBranch());
const ui = { requestRender() {}, onTerminalInput() { return () => {}; } };
const ctx = { hasUI: true, sessionManager: recorded, ui };
const event = (name, value = {}) => { for (const fn of [...(hooks.get(name) || [])]) fn(value, ctx); };
const paint = row => stripAnsi(row.render(160).join('\n'));
const invalidate = rows => { for (const row of rows) row.invalidate(); };
const original = name => native.get(name) || {};
const create = item => {
  const row = new ToolExecutionComponent(item.name, item.id, item.args, { showImages: true, outputPad: 0 }, resolver(item.name, () => original(item.name)), ui, '/synthetic-reload');
  row.setArgsComplete(); row.updateResult(item.result);
  return row;
};
// Replay through the real native InteractiveMode methods. No tool body executes.
const display = {
  sessionManager: recorded, session: {}, ui, renderer: undefined,
  chatContainer: new tui.Container(), pendingTools: new Map(), outputPad: 0, toolOutputExpanded: false,
  settingsManager: { getShowCacheMissNotices: () => false, getShowImages: () => true, getImageWidthCells: () => 60 },
  addMessageToChat() {},
  getRegisteredToolDefinition(name) { return resolver(name, () => original(name)); },
  renderSessionEntries: core.InteractiveMode.prototype.renderSessionEntries,
  renderSessionItems: core.InteractiveMode.prototype.renderSessionItems,
};
const replay = () => {
  core.InteractiveMode.prototype.rebuildChatFromMessages.call(display);
  return display.chatContainer.children.filter(row => row instanceof ToolExecutionComponent);
};
const assertCompactHistory = (rows, label) => {
  assert.match(paint(rows[0]), /▸ 3 actions/, `${label}: historical bash, namespaced MCP and clean codemode results stay grouped`);
  assert.doesNotMatch(paint(rows[0]), /EXACT_RECORDED_BASH_OUTPUT|EXACT_RECORDED_MCP_OUTPUT/, `${label}: grouped output stays collapsed`);
  assert.equal(paint(rows[1]), '', `${label}: the second historical action does not duplicate the group`);
  assert.equal(paint(rows[2]), '', `${label}: historical codemode does not duplicate the mixed group`);
  assert.match(paint(rows[3]), /▸ read .*1 image/, `${label}: direct image read keeps its compact heading and image count`);
  assert.match(paint(rows[4]), /▸ codemode.*2 images/, `${label}: image-bearing codemode keeps its compact heading and image count`);
  for (const [row, count] of [[rows[3], 1], [rows[4], 2]]) {
    assert.equal(row.imageComponents.length, count, `${label}: native image objects remain available`);
    assert.deepEqual(row.imageSources.map(source => source.data), Array(count).fill(png), `${label}: exact recorded image sources remain available`);
    assert.equal(row.render(160).length, 2, `${label}: image-bearing row has one collapsed heading and its native spacer`);
    assert.ok(!row.render(160).some(line => line.includes('\x1b_G')), `${label}: collapsed images emit no image protocol`);
  }
};
const assertImageExpansion = (rows, label) => {
  for (const [row, count] of [[rows[3], 1], [rows[4], 2]]) {
    row.setExpanded(true);
    assert.equal(row.render(160).filter(line => line.includes('\x1b_G')).length, count, `${label}: expansion renders every native PNG preview`);
    row.setExpanded(false);
    assert.ok(!row.render(160).some(line => line.includes('\x1b_G')), `${label}: collapsing hides every PNG preview`);
  }
};

const savedCapabilities = tui.getCapabilities();
try {
  tui.setCapabilities({ ...savedCapabilities, images: 'kitty' });
  // Native AgentSession.reload invokes beforeSessionStart (which rebuilds chat)
  // before emitting session_start. Theme/runtime refresh then invalidates rows.
  const rows = replay();
  assert.equal(rows.length, 5);
  const nativeImages = [rows[3].imageComponents.slice(), rows[4].imageComponents.slice()];
  event('session_start', { reason: 'reload' });
  assertCompactHistory(rows, 'session start reconnects replayed rows');
  invalidate(rows);
  assertCompactHistory(rows, 'native reload order');
  assertImageExpansion(rows, 'native reload order');
  assert.deepEqual(rows[3].imageComponents, nativeImages[0], 'reload reuses the direct read native image object');
  assert.deepEqual(rows[4].imageComponents, nativeImages[1], 'reload reuses the codemode native image objects');

  mode.setEnabled(false);
  assert.match(paint(rows[0]), /EXACT_RECORDED_BASH_OUTPUT/, 'native mode reveals exact historical bash output');
  assert.match(paint(rows[1]), /EXACT_RECORDED_MCP_OUTPUT/, 'native mode reveals exact historical MCP output');
  assert.match(paint(rows[2]), /EXACT_RECORDED_CODE_OUTPUT/, 'native mode reveals exact historical codemode output');
  assert.equal(rows[3].imageComponents.length, 1, 'native mode retains the direct image read');
  assert.equal(rows[4].imageComponents.length, 2, 'native mode retains codemode images');
  mode.setEnabled(true);
  invalidate(rows);
  assertCompactHistory(rows, 'toggle on after reload');
  assertImageExpansion(rows, 'toggle on after reload');
  assert.deepEqual(rows[3].imageComponents, nativeImages[0], 'mode toggles preserve the direct read native image object');
  assert.deepEqual(rows[4].imageComponents, nativeImages[1], 'mode toggles preserve codemode native image objects');

  event('message_end', { message: { role: 'user', content: 'Synthetic boundary after reload' } });
  const freshBash = create({ ...fixture[0], id: 'fresh-bash' });
  const freshMcp = create({ ...fixture[1], id: 'fresh-mcp' });
  assert.match(paint(freshBash), /▸ 2 actions/, 'fresh post-reload calls join their own group');
  assert.equal(paint(freshMcp), '');
  assert.doesNotMatch(paint(freshBash), /EXACT_RECORDED_BASH_OUTPUT|EXACT_RECORDED_MCP_OUTPUT/);
  const freshCode = create({ ...fixture[2], id: 'fresh-code' });
  assert.match(paint(freshBash), /▸ 3 actions/);
  assert.equal(paint(freshCode), '');
  assert.doesNotMatch(paint(freshCode), /RECORDED_CODE_SOURCE|EXACT_RECORDED_CODE_OUTPUT/);
  assertCompactHistory(rows, 'fresh calls preserve historical groups');

  // Reuse recorded tool IDs in the replacement session. Detached rows must not
  // acquire that session's projection merely because their IDs still exist.
  event('session_before_switch');
  const replacement = core.SessionManager.inMemory('/synthetic-replacement');
  for (const entry of recorded.getBranch()) if (entry.type === 'message') replacement.appendMessage(entry.message);
  ctx.sessionManager = replacement; display.sessionManager = replacement;
  event('session_start', { reason: 'switch' });
  const replacementRows = replay();
  invalidate(replacementRows);
  assertCompactHistory(replacementRows, 'replacement session');
  invalidate(rows);
  assert.match(paint(rows[0]), /EXACT_RECORDED_BASH_OUTPUT/, 'detached old bash row uses native fallback after switch');
  assert.match(paint(rows[1]), /EXACT_RECORDED_MCP_OUTPUT/, 'detached old MCP row uses native fallback after switch');
  assert.doesNotMatch(paint(rows[0]), /▸ 3 actions/, 'detached row cannot adopt the new session group');
  assertCompactHistory(replacementRows, 'late detached-row invalidation');

  event('session_shutdown', { reason: 'shutdown' });
  invalidate(replacementRows);
  assert.match(paint(replacementRows[0]), /EXACT_RECORDED_BASH_OUTPUT/, 'shutdown rows use native fallback');
  assert.match(paint(replacementRows[1]), /EXACT_RECORDED_MCP_OUTPUT/, 'shutdown keeps exact MCP output available');
  assert.doesNotMatch(paint(replacementRows[2]), /▸ codemode/, 'shutdown rows cannot retain a live compact codemode projection');
  assert.equal(JSON.stringify(recorded.getBranch()), originalBranch, 'reload display leaves recorded messages unchanged');
  console.log('Native reload lifecycle regression passed');
} finally {
  dispose(); mode.dispose(); tui.setCapabilities(savedCapabilities);
}
