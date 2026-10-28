#!/usr/bin/env node
// Isolated synthetic preview. No model, tool, network, or active user session.
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { createWorkStripPreview } from '../scripts/preview-work-strip.mjs';
const preview = await createWorkStripPreview();
let ui;
try {
  const { matchesKey, setKittyProtocolActive } = await import(pathToFileURL(preview.tuiPath));
  let receive, kitty = true;
  const terminal = {
    columns: 110,
    rows: 40,
    get kittyProtocolActive() { return kitty; },
    start(onInput) { receive = onInput; },
    stop() {},
    async drainInput() {},
  };
  for (const method of ['write', 'moveBy', 'hideCursor', 'showCursor', 'clearLine', 'clearFromCursor', 'clearScreen', 'setTitle', 'setProgress', 'setProgramStatus']) terminal[method] = () => {};

  ui = new preview.core.InteractiveMode(preview.runtime, { tuiMode: 'fullscreen', terminal });
  // Native init owns shortcut registration, input subscriptions, and focus.
  await ui.init();
  const runner = preview.runtime.session.extensionRunner;
  const errors = [];
  runner.onError(error => errors.push(error));
  const context = runner.createContext();
  const fold = runner.getCommand('fold');
  const headers = () => ui.chatContainer[Symbol.for('compact-renderer:projected-children:v1')].filter(row => row.constructor.name === 'WorkStripHeader');
  const expand = async () => {
    await fold.handler('expand', context);
    ui.renderer.renderNow();
    assert.equal(headers().length, 3);
    assert.ok(headers().every(header => header.open), 'all fixture work sections open');
  };
  const collapse = async (data, label) => {
    receive(data);
    await Promise.resolve();
    assert.ok(headers().every(header => !header.open), label);
    assert.equal(ui.renderer.getFocusedComponent(), ui.defaultEditor, `${label}: native editor retains focus`);
  };
  assert.equal(typeof receive, 'function', 'native terminal callback installed');
  assert.equal(typeof ui.defaultEditor.onExtensionShortcut, 'function', 'native startup binds extension shortcuts');
  assert.ok(runner.getShortcuts(ui.keybindings.getEffectiveConfig()).has('ctrl+alt+w'));
  assert.deepEqual(runner.getShortcutDiagnostics(), []);

  const encodings = [
    ['CSI-u', '\x1b[119;7u', true],
    ['xterm modifyOtherKeys', '\x1b[27;7;119~', false],
    ['legacy ESC plus Ctrl+W', '\x1b\x17', false],
  ];
  for (const [label, data, active] of encodings) {
    kitty = active;
    setKittyProtocolActive(active);
    assert.equal(matchesKey(data, 'ctrl+alt+w'), true, `${label}: parser matches`);
    await expand();
    ui.defaultEditor.setText('unfinished prompt');
    await collapse(data, `${label}: native terminal callback collapses work`);
    receive(data);
    await Promise.resolve();
    assert.ok(headers().every(header => header.open), `${label}: repeated key expands work`);
    assert.equal(ui.defaultEditor.getText(), 'unfinished prompt', 'shortcut preserves editor text');
  }

  kitty = true;
  setKittyProtocolActive(true);
  const choices = [];
  preview.eventBus.emit('compact-renderer:inspect:v1', { add(choice) { choices.push(choice); } });
  assert.ok(choices.length > 0);
  const owners = {};
  for (const choice of choices) {
    await expand();
    choice.focus();
    ui.renderer.renderNow();
    await collapse('\x1b[119;7u', `${choice.kind} ${choice.id}: inspection forwards shortcut`);
    owners[choice.kind] = (owners[choice.kind] || 0) + 1;
  }
  assert.deepEqual(errors, []);

  const plain = rows => rows.map(line => line.replace(/\x1b\[[0-9;]*m/g, '')).join('\n');
  const click = (component, match) => {
    const rows = component.render(110);
    const y = rows.findIndex(line => match.test(plain([line])));
    assert.ok(y >= 0, `mouse target exists: ${match}`);
    assert.equal(component.handleMouse({ type: 'click', button: 'left', x: 6, y, width: 110, height: rows.length, shift: false, alt: false, ctrl: false })?.handled, true);
    ui.renderer.renderNow();
  };
  const disclosures = () => {
    const result = [];
    preview.eventBus.emit('compact-renderer:disclosures:v1', { add(target, open) { result.push({ target, open }); } });
    return result;
  };
  // Open through native component mouse routing, without inspection focus().
  await expand();
  let mouseOpened = 0;
  for (const row of ui.chatContainer.children) {
    if (!['ToolExecutionComponent', 'AssistantMessageComponent'].includes(row.constructor.name)) continue;
    const pattern = /▸ (?:codemode|Thinking|Subagent workflow|\d+ actions|read|Read|bash|Run|Question)/;
    if (row.render(110).some(line => pattern.test(plain([line])))) { click(row, pattern); mouseOpened++; }
  }
  assert.ok(mouseOpened >= 3, 'native mouse routing opens tool, thinking, and workflow/codemode fixture panes');
  assert.ok(disclosures().some(pane => pane.open), 'mouse opens owner-managed panes');
  await fold.handler('collapse', context); ui.renderer.renderNow();
  assert.ok(disclosures().every(pane => !pane.open), '/fold collapse resets every eligible nested owner');
  await expand();
  assert.ok(disclosures().every(pane => !pane.open), 'reopening work starts with nested panes closed');

  // The DDD attention row remains visible while its completed strip is closed.
  await fold.handler('collapse', context); ui.renderer.renderNow();
  const projected = ui.chatContainer[Symbol.for('compact-renderer:projected-children:v1')];
  const ddd = projected.find(row => row.render(110).some(line => /▸ DDD ·/.test(plain([line]))));
  assert.ok(ddd, 'retained DDD attention row is visible under collapsed work');
  click(ddd, /▸ DDD ·/);
  assert.match(plain(ddd.render(110)), /▾ DDD ·/);
  assert.ok(headers().every(header => !header.open), 'mouse opening DDD leaves outer work collapsed');
  await collapse('\x1b[119;7u', 'visible nested DDD makes shortcut choose collapse');
  assert.match(plain(ddd.render(110)), /▸ DDD ·/, 'shortcut closes retained nested attention pane');
  const decision = ui.chatContainer[Symbol.for('compact-renderer:projected-children:v1')].find(row => row.render(110).some(line => /▸ Subagent.*scout.*decision/.test(plain([line]))));
  assert.ok(decision, 'retained subagent decision row is visible under collapsed work');
  click(decision, /▸ Subagent.*scout.*decision/);
  assert.match(plain(decision.render(110)), /▾ Subagent.*scout.*decision/);
  assert.ok(headers().every(header => !header.open));
  await collapse('\x1b[119;7u', 'visible subagent decision makes shortcut choose collapse');
  assert.match(plain(decision.render(110)), /▸ Subagent.*scout.*decision/);
  assert.ok(disclosures().every(pane => !pane.open), 'subagent disclosure owner resets along with the other completed panes');
  receive('\x1b[119;7u'); await Promise.resolve();
  assert.ok(headers().every(header => header.open), 'next shortcut expands after nested reset');

  await expand();
  const dialog = context.ui.select('Choose a fixture', ['A', 'B']);
  await new Promise(resolve => setTimeout(resolve, 0));
  receive('\x1b[119;7u');
  assert.ok(headers().every(header => header.open), 'dialog retains input ownership');
  receive('\x1b');
  assert.equal(await dialog, undefined, 'Escape cancels dialog');
  await collapse('\x1b[119;7u', 'shortcut works after dialog closes');
  console.log('Pi Fold shortcut: native startup, three key encodings, repeated toggle, editor text, inspection and dialog focus passed');
} finally {
  ui?.stop();
  await preview.cleanup();
}
