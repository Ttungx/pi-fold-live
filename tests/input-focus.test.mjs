import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSource, loadAgent, core, tui, themeModule, stripAnsi } from './test-runtime.mjs';
const { registerModernTools } = await loadSource('./modern-tools.ts');
const { registerModernThinking } = await loadSource('./modern-thinking.ts');
const { registerModernPrompts } = await loadSource('./modern-prompts.ts');
const { createDisplayMode } = await loadSource('./display-mode.ts');
const { ToolExecutionComponent } = await loadAgent('modes/interactive/components/tool-execution.js');
const { readRenderers } = await loadAgent('core/tools/renderers/read.js');
const dir = mkdtempSync(join(tmpdir(), 'compact-editor-focus-'));
const template = join(dir, 'fixture.md');
const prompt = 'Original fixture instructions long enough to identify the prompt.\nKeep these exact words.';
writeFileSync(template, prompt);
const thinking = { role: 'assistant', content: [{ type: 'thinking', thinking: 'Recorded fixture text only.' }, { type: 'toolCall', id: 'read-fixture', name: 'read', arguments: { path: '/fixture' } }], stopReason: 'toolUse' };
const listeners = new Map(), bus = new Map(), inputs = new Set(), transformers = [];
const subscribe = (map, event, fn) => { const set = map.get(event) || new Set(); map.set(event, set); set.add(fn); return () => set.delete(fn); };
let resolver;
const pi = {
  on: (event, fn) => subscribe(listeners, event, fn),
  events: { on: (event, fn) => subscribe(bus, event, fn), emit: (event, data) => { for (const fn of [...bus.get(event) || []]) fn(data); } },
  registerToolRenderer(fn) { resolver = fn; },
  registerMarkdownTransformer(fn) { transformers.push(fn); },
  getCommands: () => [{ source: 'prompt', name: 'fixture', sourceInfo: { path: template } }],
};
const mode = createDisplayMode();
const disposers = [registerModernTools(pi, mode), registerModernThinking(pi, mode), registerModernPrompts(pi, mode)];
const ctx = { mode: 'tui', hasUI: true, sessionManager: { getBranch: () => [{ type: 'message', message: thinking }] }, ui: { theme: themeModule.theme, setHiddenThinkingLabel() {}, onTerminalInput(fn) { inputs.add(fn); return () => inputs.delete(fn); } } };
const emit = (event, data = {}) => { for (const fn of [...listeners.get(event) || []]) fn(data, ctx); };
const key = data => [...inputs].some(fn => fn(data)?.consume);
const editor = new tui.Editor({ requestRender() {}, terminal: { columns: 100, rows: 30 } }, themeModule.getEditorTheme());
const submitted = [];
editor.onSubmit = text => submitted.push(text);
const send = data => { if (!key(data)) editor.handleInput(data); };
try {
  emit('session_start');
  const tool = new ToolExecutionComponent('read', 'read-fixture', { path: '/fixture' }, { showImages: false, outputPad: 0 }, resolver('read', () => readRenderers), { requestRender() {} }, dir);
  tool.setArgsComplete(); tool.updateResult({ content: [{ type: 'text', text: 'Fixture output' }] }); tool.render(100);
  const thought = new core.AssistantMessageComponent(thinking, true, themeModule.getMarkdownTheme()); thought.render(100);
  const card = new core.UserMessageComponent(prompt, themeModule.getMarkdownTheme(), 1, transformers); card.render(100);
  // Exercise the same terminal-input -> native Editor path for all inspection owners.
  for (const shortcut of ['\x1bg', '\x1bt', '\x1bi']) {
    for (const scenario of [
      { chunks: ['calculate'], expected: 'calculate' },
      { chunks: ['©', '†'], expected: '©†' },
      { chunks: ['c', 'ostmade'], expected: 'costmade' },
      { chunks: ['d', 'ensity'], expected: 'density' },
      { chunks: [' ', 'status'], expected: ' status' },
      { chunks: ['\x1b[200~', 'pasted status', '\x1b[201~'], expected: 'pasted status' },
      { initial: 'statux', chunks: ['\x7f', 's'], expected: 'status' },
    ]) {
      editor.setText(scenario.initial || '');
      assert.equal(key(shortcut), true, 'explicit inspection shortcut is available');
      for (const chunk of scenario.chunks) send(chunk);
      assert.equal(editor.getText(), scenario.expected, 'inspection preserves native editor text');
      assert.equal(key('\r'), false, 'Enter returns to native prompt submission after editing');
      editor.handleInput('\r');
      assert.equal(submitted.at(-1), scenario.expected.trim(), 'the native editor submits the intended prompt');
    }
  }
  // Mouse expansion must never require Escape before submitting from the editor.
  for (const component of [tool, thought, card]) {
    pi.events.emit('compact-renderer:focus:v1', { owner: 'editor' });
    const lines = component.render(100);
    const header = lines.findIndex(row => /(?:read · \/fixture|Thinking ·|prompt ·)/.test(stripAnsi(row)));
    assert.ok(header >= 0);
    component.handleMouse({ type: 'click', button: 'left', x: 2, y: header, width: 100, height: lines.length });
    assert.equal(key('\r'), false, 'a card click does not intercept editor submission');
  }
  // Details clicks preserve editor focus; /inspect Tab only changes the inline target.
  pi.events.emit('compact-renderer:focus:v1', { owner: 'editor' });
  tool.setExpanded(true);
  const detailRows = tool.render(100), detailRow = detailRows.findIndex(row => row.includes('Details'));
  assert.ok(detailRow >= 0);
  tool.handleMouse({ type: 'click', button: 'left', x: 3, y: detailRow, width: 100, height: detailRows.length });
  assert.equal(key('\t'), false, 'editor Tab stays native after clicking Details');
  assert.equal(key('\r'), false, 'Details mouse expansion never captures editor Enter');
  assert.equal(key('\x1bg'), true); assert.equal(key('\t'), true); assert.equal(key('\x1b[Z'), true);
  send('density'); assert.equal(key('\r'), false, 'typing releases Details inspection for normal submission');
  // Explicit keyboard inspection still supports Enter until the user starts editing.
  for (const shortcut of ['\x1bg', '\x1bt', '\x1bi']) {
    assert.equal(key(shortcut), true); assert.equal(key('\r'), true);
    assert.equal(key('\x1b'), true); assert.equal(key('\r'), false);
  }
  for (const shortcut of ['\x1bg', '\x1bt']) {
    assert.equal(key(shortcut), true);
    for (const enhanced of ['\x1b[13u', '\x1b[1;1C', '\x1b[1;1A', '\x1b[1;1H']) {
      assert.equal(key(enhanced), true, 'native enhanced keyboard sequence remains inside inspection');
    }
    assert.equal(key('\x1b'), true);
  }
  emit('session_shutdown');
  console.log('input focus: native Editor typing, Space/c, paste, editing, submit, mouse and explicit inspection passed');
} finally { disposers.reverse().forEach(dispose => dispose()); rmSync(dir, { recursive: true, force: true }); }
