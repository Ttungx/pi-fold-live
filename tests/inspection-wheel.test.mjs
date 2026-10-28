import assert from 'node:assert/strict';
import { createWorkStripPreview } from '../scripts/preview-work-strip.mjs';

const preview = await createWorkStripPreview({ inspection: true });
const terminal = { columns: 110, rows: 45, kittyProtocolActive: false, start() {}, stop() {}, async drainInput() {} };
for (const name of ['write', 'moveBy', 'hideCursor', 'showCursor', 'clearLine', 'clearFromCursor', 'clearScreen', 'setTitle', 'setProgress', 'setProgramStatus']) terminal[name] = () => {};
const plain = rows => rows.join('\n').replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]/g, '');
let ui;
try {
  ui = new preview.core.InteractiveMode(preview.runtime, { tuiMode: 'fullscreen', terminal });
  await ui.init();
  const runner = preview.runtime.session.extensionRunner;
  await runner.getCommand('fold').handler('expand', runner.createContext());
  const renderer = ui.renderer;
  renderer.renderNow();
  const screen = () => renderer.getScreenLines().map(row => plain([row]));
  const click = (component, pattern) => {
    const rows = component.render(110), y = rows.findIndex(row => pattern.test(plain([row])));
    assert.ok(y >= 0, String(pattern));
    assert.equal(component.handleMouse({ type: 'click', button: 'left', x: 8, y, width: 110, height: rows.length })?.handled, true);
    renderer.renderNow();
  };
  const wheel = (y, down) => {
    renderer.handleTerminalInput(`\x1b[<${down ? 65 : 64};15;${y + 1}M`);
    renderer.renderNow();
  };
  const choices = [];
  preview.eventBus.emit('compact-renderer:inspect:v1', { add: choice => choices.push(choice) });
  const thinking = choices.find(choice => /Thinking · 3 rounds/.test(choice.label));
  assert.ok(thinking);
  thinking.focus(); renderer.renderNow();
  const component = thinking.target();
  click(component, /1\. Review recorded sample/);
  const beforeThinking = plain(component.render(110));
  click(component, /more ↓/);
  assert.notEqual(plain(component.render(110)), beforeThinking);
  assert.doesNotMatch(plain(component.render(110)), /Thinking\.\.\./);

  // The recorded read and codemode now share an action pane owned by the read.
  const leader = ui.chatContainer.children.find(row => row.toolCallId === 'inspection-1');
  const wrapper = ui.chatContainer[Symbol.for('compact-renderer:projected-children:v1')].find(row => row.children?.[0] === leader);
  assert.ok(wrapper);
  click(wrapper, /▸ 2 actions/);
  click(wrapper, /2\. codemode/);
  click(wrapper, /more ↓/);
  preview.eventBus.emit('compact-renderer:focus:v1', { owner: 'tools', target: row => row === leader });
  renderer.renderNow();
  const scroll = renderer.getPrimaryScrollView();
  // At the transcript end, auto-clamping can mask a shrinking pane by moving
  // it down under the pointer. Test away from that boundary.
  scroll.scrollTo(scroll.scrollTop - 3, { disableFollow: true }); renderer.renderNow();
  const top = scroll.scrollTop;
  let footerY = -1;
  for (let n = 0; n < 200; n++) {
    const rows = screen(), headerY = rows.findIndex(row => /▾ 2 actions/.test(row));
    assert.ok(headerY >= 0);
    const nextY = rows.findIndex((row, i) => i > headerY && i < headerY + 21 && /more ↓/.test(row));
    if (nextY < 0) break;
    if (footerY >= 0) assert.equal(nextY, footerY, 'footer remains under the pointer');
    footerY = nextY;
    wheel(footerY, true);
    assert.equal(scroll.scrollTop, top, 'downward wheel stays inside the pane');
  }
  const end = screen();
  assert.ok(footerY >= 0);
  assert.match(end[footerY], /more ↑/, 'end of pane retains its footer hit area');
  wheel(footerY, false);
  assert.equal(scroll.scrollTop, top, 'upward wheel at the unchanged footer stays inside the pane');
  assert.notEqual(screen().join('\n'), end.join('\n'), 'upward wheel reveals earlier output');
  assert.equal(renderer.getFocusedComponent(), ui.defaultEditor);
  console.log('Native overflow footer retains wheel routing in both directions');
} finally {
  ui?.stop();
  await preview.cleanup();
}
