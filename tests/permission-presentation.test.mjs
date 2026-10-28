import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertCardBackground, backgroundCells, themeModule as nativeTheme, stripAnsi } from './test-runtime.mjs';

const runtime = process.env.PI_RUNTIME || (existsSync(path.join(fileURLToPath(new URL('..', import.meta.url)), 'node_modules/@earendil-works/pi-coding-agent')) ? fileURLToPath(new URL('..', import.meta.url)) : path.join(homedir(), '.local/state/pi-config/current/runtime'));
const root = process.env.PI_INSTALL_ROOT || path.join(runtime, 'node_modules/@earendil-works/pi-coding-agent');
const require = createRequire(path.join(root, 'package.json'));
const tuiPath = require.resolve('@earendil-works/pi-tui');
const { visibleWidth, TuiAltScreen, Container, Text, getKeybindings, setKeybindings } = await import(pathToFileURL(tuiPath));
const { createEventBus } = await import(pathToFileURL(path.join(root, 'dist/core/event-bus.js')));
const { createJiti } = require('jiti');
const jiti = createJiti(import.meta.url, { fsCache: false, alias: { '@earendil-works/pi-tui': tuiPath } });
const { PermissionDialog, PermissionDetailsViewport, registerPermissionPresentation, PERMISSION_PRESENTATION_EVENT } = await jiti.import('../src/permission-presentation.ts');
const theme = { fg: (_color, value) => value };
const description = { version: 1, mode: 'tui', action: 'Run MCP operation', target: 'fixture/query',
  reason: 'Fixture policy requires approval.', details: JSON.stringify({ query: "SELECT '完整 SQL'", text: 'full exact input' }, null, 2) };
const styled = new PermissionDialog(description, nativeTheme.theme, () => {}, () => {});
for (const details of [false, true]) {
  if (details) styled.handleInput('d');
  for (const width of [1, 2, 20, 100]) {
    const rows = styled.render(width);
    const selected = rows.findIndex(row => stripAnsi(row).includes('→'));
    assert.ok(selected >= 0, 'native permission selection stays visible at narrow widths');
    assertCardBackground([rows[selected]], width, 'selectedBg');
    assert.ok(rows.filter((_, index) => index !== selected).every(row => backgroundCells(row).every(color => color === '')),
      'only the selected choice has a filled background');
    if (width === 100) {
      assert.equal(stripAnsi(rows[0]).trim(), '', 'approval has top breathing room');
      assert.equal(stripAnsi(rows.at(-1)).trim(), '', 'approval has bottom breathing room');
    }
  }
}
const approvalLines = styled.render(100).map(stripAnsi);
const firstChoice = approvalLines.findIndex(row => row.includes('Allow once'));
assert.equal(approvalLines[firstChoice - 1].trim(), '', 'summary and choices are separated');
for (const width of [16, 18, 20, 40, 80]) {
  const shortScreen = new PermissionDialog(description, theme, () => {}, () => {}, () => 24);
  shortScreen.handleInput('d');
  assert.ok(shortScreen.render(width).length <= 24, 'optional spacing yields to approval controls on a narrow screen');
}

// Native keybindings, safe default, single resolution and bounded Details.
let resolutions = [];
const dialog = new PermissionDialog(description, theme, () => {}, value => resolutions.push(value));
assert.match(dialog.render(80).join('\n'), /→ Deny/);
assert.ok(!dialog.render(80).join('\n').includes('SELECT'));
dialog.handleInput('d');
assert.match(dialog.render(80).join('\n'), /SELECT '完整 SQL'/);
for (const width of [1, 2, 10, 20, 40, 80]) {
  assert.ok(dialog.render(width).every(row => visibleWidth(row) <= width), `fits width ${width}`);
}
dialog.handleInput('\r'); dialog.handleInput('\x1b[A'); dialog.handleInput('\r'); dialog.dispose();
assert.deepEqual(resolutions, [false], 'Enter defaults to deny and can only settle once');
const allow = new PermissionDialog(description, theme, () => {}, value => resolutions.push(value));
allow.handleInput('\x1b[A'); allow.handleInput('\r');
assert.deepEqual(resolutions, [false, true], 'native up + Enter permits once');
const cancel = new PermissionDialog(description, theme, () => {}, value => resolutions.push(value));
cancel.handleInput('\x1b'); cancel.dispose();
assert.deepEqual(resolutions, [false, true, false], 'native Escape denies once');
const big = new PermissionDialog({ ...description, details: Array.from({ length: 1000 }, (_, i) => `exact line ${i}`).join('\n') }, theme, () => {}, () => {});
big.handleInput('d');
let painted = big.render(40);
assert.ok(painted.length < 25 && !painted.join('\n').includes('exact line 999'), 'paint only the bounded Details viewport');
big.handleInput('\x1b[F');
assert.match(big.render(40).join('\n'), /Full reason:/, 'End reaches the complete Details source including full summary fields');
big.handleInput('\x1b[H'); big.render(40); big.handleInput('\x1b[6~');
assert.match(big.render(40).join('\n'), /exact line 8/, 'PageDown scrolls Details');
big.handleInput('\x1b[5~');
assert.match(big.render(40).join('\n'), /exact line 0/, 'PageUp returns to first page');
big.handleInput('\x1b[C');
assert.match(big.render(40).join('\n'), /exact line 8/, 'Right pages Details without relying on fullscreen transcript keys');
big.handleInput('\x1b[D');
assert.match(big.render(40).join('\n'), /exact line 0/, 'Left pages Details backwards');
const controls = new PermissionDialog({ ...description, target: '\x1b]52;c;unsafe\x07' }, theme, () => {}, () => {});
assert.ok(!controls.render(80).join('\n').includes('\x1b'), 'labels cannot inject terminal controls');
const unicode = new PermissionDialog({ ...description, action: '处理😀', target: '文件/目录' }, theme, () => {}, () => {});
unicode.handleInput('d');
for (const width of [1, 2, 10, 20, 80]) assert.ok(unicode.render(width).every(row => visibleWidth(row) <= width));
const huge = new PermissionDetailsViewport(['x'.repeat(4_000_000), '\nEXACT END']);
let work = huge.workUnits;
assert.ok(huge.render(40, 8).length <= 8);
assert.ok(huge.workUnits - work < 4096, 'opening scans only viewport chunks');
work = huge.workUnits;
huge.render(40, 8);
assert.equal(huge.workUnits, work, 'unchanged paint reuses the viewport');
huge.pageDown(); huge.render(40, 8);
assert.ok(huge.workUnits - work < 4096, 'PageDown scans only the next viewport');
work = huge.workUnits;
huge.render(1, 8);
assert.ok(huge.workUnits - work < 4096, 'narrow resize does not wrap the full source');
work = huge.workUnits;
huge.end(40, 8);
assert.match(huge.render(40, 8).join('\n'), /EXACT END/);
assert.ok(huge.workUnits - work < 4096, 'End scans only a bounded suffix');
work = huge.workUnits;
const beforeBackward = huge.range.start;
huge.pageUp(); huge.render(40, 8);
assert.ok(huge.range.start > 0 && huge.range.start < beforeBackward && huge.range.end <= beforeBackward, 'PageUp after End seeks adjacent preceding content');
assert.ok(huge.workUnits - work < 4096, 'PageUp scans only a bounded predecessor viewport');
huge.render(1, 8);
work = huge.workUnits;
const beforeNarrowBackward = huge.range.start;
huge.pageUp(); huge.render(1, 8);
assert.equal(huge.range.start, beforeNarrowBackward - 8, 'narrow resize changes the preceding page length');
assert.equal(huge.range.end, beforeNarrowBackward);
assert.ok(huge.workUnits - work < 4096, 'PageUp after narrow resize stays bounded');
const exact = new PermissionDetailsViewport([Array.from({ length: 1000 }, (_, i) => `exact line ${i}`).join('\n')]);
exact.end(40, 8);
assert.match(exact.render(40, 8).join('\n'), /exact line 999/, 'the exact arguments tail remains reachable');
exact.pageUp();
assert.deepEqual(exact.render(40, 8), Array.from({ length: 8 }, (_, i) => `exact line ${984 + i}`), 'End then PageUp shows the preceding page, not navigation history');
exact.pageUp();
assert.deepEqual(exact.render(40, 8), Array.from({ length: 8 }, (_, i) => `exact line ${976 + i}`), 'backward paging continues through the source');
exact.pageDown();
assert.deepEqual(exact.render(40, 8), Array.from({ length: 8 }, (_, i) => `exact line ${984 + i}`), 'forward paging after backward seek preserves exact adjacency');
exact.end(40, 8); exact.render(40, 4); exact.pageUp();
assert.deepEqual(exact.render(40, 4), Array.from({ length: 4 }, (_, i) => `exact line ${988 + i}`), 'PageUp uses the resized viewport height');
for (const source of ['\x1b'.repeat(100), '\t'.repeat(100), '😀x'.repeat(100), 'line\n'.repeat(100)]) {
  for (const width of [1, 2, 3, 5, 20]) for (const height of [1, 2, 8]) {
    const tail = new PermissionDetailsViewport([source]);
    tail.end(width, height); tail.render(width, height);
    assert.equal(tail.range.end, tail.range.total, 'End includes the final source unit even when control escapes wrap');
  }
}
const giantSummary = new PermissionDialog({ ...description, target: 't'.repeat(4_000_000) }, theme, () => {}, () => {});
assert.match(giantSummary.render(40).join('\n'), /Summary shortened/);
giantSummary.handleInput('d');
assert.ok(giantSummary.render(40).length <= 24, 'large labels do not expand the summary unboundedly');
assert.ok(giantSummary.detailsViewport.workUnits < 4096, 'full summary fields are lazy Details sources');
giantSummary.handleInput('\x1b[F');
assert.ok(giantSummary.render(40).length <= 24, 'bounded suffix access works with huge full summary fields');

function fixture() {
  const events = createEventBus();
  const hooks = new Map();
  let enabled = true;
  const listeners = new Set();
  const mode = { isEnabled: () => enabled, onChange: callback => { listeners.add(callback); return () => listeners.delete(callback); } };
  const pi = { events, on(event, callback) { hooks.set(event, [...hooks.get(event) || [], callback]); } };
  let customCalls = 0, fallbackCalls = 0, component;
  const ui = { custom(factory) {
    customCalls++;
    return new Promise(resolve => { component = factory({ requestRender() {} }, theme, {}, resolve); });
  } };
  const request = (overrides = {}) => {
    let presenter;
    let accepting = true;
    const value = { ...description, ui, ...overrides, offer(candidate) {
      if (presenter || !accepting) return false;
      presenter = candidate; return true;
    } };
    events.emit(PERMISSION_PRESENTATION_EVENT, value);
    accepting = false;
    return { value, result: presenter ? presenter() : (fallbackCalls++, Promise.resolve(false)) };
  };
  return { pi, mode, ui, request, hooks, get component() { return component; },
    get customCalls() { return customCalls; }, get fallbackCalls() { return fallbackCalls; },
    setEnabled(value) { enabled = value; for (const callback of [...listeners]) callback(); } };
}

const f = fixture();
const dispose = registerPermissionPresentation(f.pi, f.mode);
const disposeDuplicate = registerPermissionPresentation(f.pi, f.mode);
let pending = f.request();
assert.equal(f.customCalls, 1, 'only the first synchronous offer creates UI');
f.component.handleInput('\x1b[A'); f.component.handleInput('\r');
assert.equal(await pending.result, true);
assert.equal(f.fallbackCalls, 0);
assert.equal(await f.request({ version: 2 }).result, false);
assert.equal(await f.request({ mode: 'rpc' }).result, false, 'RPC keeps native confirm');
assert.equal(await f.request({ ui: {} }).result, false, 'incompatible UI keeps native confirm');
f.setEnabled(false);
assert.equal(await f.request().result, false, 'disabled renderer keeps native confirm');
assert.equal(f.customCalls, 1);
f.setEnabled(true);
const abort = new AbortController();
pending = f.request({ signal: abort.signal }); abort.abort();
assert.equal(await pending.result, false, 'abort denies and closes pending dialog');
pending = f.request(); f.setEnabled(false);
assert.equal(await pending.result, false, 'disable cancels a pending dialog without fallback');
f.setEnabled(true);
for (const event of ['session_switch', 'session_tree', 'session_compact', 'session_shutdown']) {
  pending = f.request();
  for (const callback of f.hooks.get(event)) callback();
  assert.equal(await pending.result, false, `${event} closes pending approval`);
}
pending = f.request(); dispose(); disposeDuplicate();
assert.equal(await pending.result, false, 'dispose cancels pending approval');
assert.equal(await f.request().result, false, 'dispose removes provider');
assert.equal(f.fallbackCalls, 5, 'cancellation never reopens a fallback prompt');

const failed = fixture();
registerPermissionPresentation(failed.pi, failed.mode);
failed.ui.custom = () => { throw new Error('UI unavailable'); };
await assert.rejects(failed.request().result, /UI unavailable/);
assert.equal(failed.fallbackCalls, 0, 'claimed failure never asks twice');
const before = new AbortController(); before.abort();
assert.equal(await failed.request({ signal: before.signal }).result, false, 'pre-aborted request creates no UI');

// Exercise the native fullscreen listener chain and InteractiveMode's actual
// custom-component mounting, input focus and restoration. No terminal process,
// session, network, credentials or model is needed for this UI boundary.
const { InteractiveMode, initTheme } = await import(pathToFileURL(path.join(root, 'dist/index.js')));
const { KeybindingsManager } = await import(pathToFileURL(path.join(root, 'dist/core/keybindings.js')));
initTheme('dark', false);
const previousKeys = getKeybindings();
const nativeKeys = new KeybindingsManager();
setKeybindings(nativeKeys);
let input;
const terminal = { columns: 80, rows: 30, kittyProtocolActive: false,
  start(onInput) { input = onInput; }, stop() {}, write() {}, hideCursor() {}, showCursor() {},
  clearLine() {}, clearFromCursor() {}, clearScreen() {}, moveBy() {}, setTitle() {}, setProgress() {}, setProgramStatus() {} };
const fullscreen = new TuiAltScreen(terminal, false, undefined, { mouse: false });
const editor = { text: 'preserved draft', getText() { return this.text; }, setText(value) { this.text = value; },
  render() { return [this.text]; }, invalidate() {}, handleInput() {} };
const editorContainer = new Container(); editorContainer.addChild(editor);
fullscreen.addChild(new Text(Array.from({ length: 120 }, (_, i) => `Background transcript ${i}`).join('\n'), 0, 0));
fullscreen.addChild(editorContainer);
const nativeUI = Object.assign(Object.create(InteractiveMode.prototype), {
  ui: fullscreen, editor, editorContainer, keybindings: nativeKeys,
  extensionTerminalInputSubscriptions: new Set(),
  extensionDialogs: [], programStatus: { setBlocked() {} },
});
const pipeline = fixture();
const disposePipeline = registerPermissionPresentation(pipeline.pi, pipeline.mode);
try {
  fullscreen.start(); fullscreen.renderNow();
  const pending = pipeline.request({ ui: nativeUI.createExtensionUIContext(),
    details: Array.from({ length: 1000 }, (_, i) => `Pipeline exact line ${i}`).join('\n') });
  await new Promise(resolve => setImmediate(resolve));
  fullscreen.renderNow();
  const card = fullscreen.getFocusedComponent();
  assert.ok(card instanceof PermissionDialog, 'native custom UI focuses the permission component');
  input('d'); fullscreen.renderNow();
  assert.match(card.render(80).join('\n'), /←\/→ page Details/, 'show the usable fullscreen controls');
  input('\x1b[F'); fullscreen.renderNow();
  const atEnd = card.detailsViewport.range.start;
  const backgroundBeforePageUp = fullscreen.viewportTop;
  let extensionPagingCalls = 0;
  const removeProbe = nativeUI.addExtensionTerminalInputListener(() => { extensionPagingCalls++; });
  input('\x1b[5~'); fullscreen.renderNow();
  assert.equal(card.detailsViewport.range.start, atEnd, 'native fullscreen consumes PageUp before the custom dialog');
  assert.ok(fullscreen.viewportTop < backgroundBeforePageUp, 'the original failure scrolls the native transcript');
  assert.equal(extensionPagingCalls, 0, 'a public extension listener runs too late to override transcript PageUp');
  removeProbe();
  const background = fullscreen.viewportTop;
  input('\x1b[D'); fullscreen.renderNow();
  const preceding = card.detailsViewport.range.start;
  assert.ok(preceding < atEnd && preceding > 0, 'Left after End reaches adjacent preceding Details');
  assert.equal(fullscreen.viewportTop, background, 'Left leaves the background transcript in place');
  input('\x1b[C'); fullscreen.renderNow();
  assert.ok(card.detailsViewport.range.start > preceding, 'Right pages Details forward through the native input pipeline');
  assert.equal(fullscreen.viewportTop, background);
  input('\x1b[H'); fullscreen.renderNow();
  assert.equal(card.detailsViewport.range.start, 0, 'Home remains reachable in fullscreen');
  input('\x1b[A'); fullscreen.renderNow();
  assert.match(card.render(80).join('\n'), /→ Allow once/, 'plain Up still reaches native permission choice navigation');
  input('\x1b[B'); fullscreen.renderNow();
  assert.match(card.render(80).join('\n'), /→ Deny/, 'plain Down still reaches native permission choice navigation');
  input('\x1b');
  assert.equal(await pending.result, false, 'native Escape denies and closes the one prompt');
  assert.equal(fullscreen.getFocusedComponent(), editor, 'native close restores editor focus');
  assert.equal(editor.text, 'preserved draft');
  assert.equal(pipeline.fallbackCalls, 0, 'fullscreen paging never starts another approval');
} finally {
  disposePipeline(); nativeUI.clearExtensionTerminalInputListeners(); fullscreen.stop(); setKeybindings(previousKeys);
}
console.log('Permission presentation: native fullscreen input pipeline, keyboard, exact Details, bounded viewport, narrow Unicode, fallback, single resolution, abort, mode and session lifecycle passed.');
