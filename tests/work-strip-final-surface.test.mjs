import assert from 'node:assert/strict';
import { backgroundCells, core, loadSource, stripAnsi, themeModule, tui } from './test-runtime.mjs';

const { finalReplyRendering } = await loadSource('./display-card.ts');
const { registerModernThinking } = await loadSource('./modern-thinking.ts');
const { registerWorkStrip } = await loadSource('./work-strip.ts');
const { registerFoldCommand } = await loadSource('./fold-command.ts');
const { createDisplayMode } = await loadSource('./display-mode.ts');
const { projectedChildren, renderFinalReply, workEvidenceType } = await loadSource('./work-strip-view.ts');
const replyText = 'FINAL **bold** and `code`\n\nSecond paragraph.\n\n- First item\n- Second item';
const message = (text = replyText, stopReason = 'stop') => ({ role: 'assistant', content: [{ type: 'text', text }], stopReason });
const token = theme => backgroundCells(theme.bg('toolPendingBg', ' '))[0];
const cells = line => backgroundCells(line.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, ''));
const withoutZones = line => line.replace(/\x1b\]133;[ABC]\x07/g, '');
// The reply keeps its native bytes: no added rows, no card tint.
const nativeText = native => native.map(stripAnsi);
function assertReplySurface(lines, theme) {
  for (const line of lines) assert.ok(!cells(line).includes(token(theme)), 'reply rows never receive the card background');
}

// The native component owns wrapping, Markdown, OSC zones and the leading gap.
// The work strip adds nothing to it; only the transient marker differs.
for (const appearance of ['dark', 'light']) {
  themeModule.initTheme(appearance, false);
  const theme = themeModule.theme;
  const row = new core.AssistantMessageComponent(message(), true);
  const markdown = row.contentContainer.children.find(child => child instanceof tui.Markdown);
  const originalRender = markdown.render;
  const ownRender = Object.getOwnPropertyDescriptor(markdown, 'render');
  for (const width of [1, 7, 30, 100]) {
    const native = row.render(width), painted = renderFinalReply(row, width, theme);
    assert.deepEqual(painted, native, `native reply rows pass through byte for byte at width ${width}`);
    assertReplySurface(painted, theme);
    assert.deepEqual(painted.join('\n').match(/\x1b\]133;[ABC]\x07/g), native.join('\n').match(/\x1b\]133;[ABC]\x07/g), 'native OSC zones remain exact');
    assert.equal(markdown.render, originalRender);
    assert.equal(Object.hasOwn(row, finalReplyRendering), false, 'successful final rendering removes its scoped marker');
    assert.deepEqual(Object.getOwnPropertyDescriptor(markdown, 'render'), ownRender, 'render projection restores the native property shape');
  }
}

// Image payloads and their cursor controls must pass through byte for byte.
{
  const row = new core.AssistantMessageComponent(message('Image placeholder.'), true);
  const markdown = row.contentContainer.children.find(child => child instanceof tui.Markdown);
  const imageLines = ['\x1b_Ga=T,f=100;AAAA\x1b\\', '\x1b[2A\x1b]1337;File=inline=1:AAAA\x07'];
  markdown.render = () => [...imageLines];
  const imageRows = renderFinalReply(row, 40, themeModule.theme);
  assert.deepEqual(imageRows.slice(1).map(withoutZones), imageLines, 'graphics payloads pass through exactly');
  assert.deepEqual(imageRows.join('\n').match(/\x1b\]133;[ABC]\x07/g), row.render(40).join('\n').match(/\x1b\]133;[ABC]\x07/g), 'native OSC zones stay exact');
  markdown.render = () => { throw new Error('synthetic Markdown failure'); };
  const render = markdown.render;
  assert.throws(() => renderFinalReply(row, 40, themeModule.theme), /synthetic Markdown failure/);
  assert.equal(markdown.render, render, 'a failed native render also restores the method');
  assert.equal(Object.hasOwn(row, finalReplyRendering), false, 'failed final rendering also removes its scoped marker');
  row[finalReplyRendering] = 'outer render';
  assert.throws(() => renderFinalReply(row, 40, themeModule.theme), /synthetic Markdown failure/);
  assert.equal(row[finalReplyRendering], 'outer render', 'nested final rendering restores an existing marker');
}

// Multiple text blocks stay native. A thinking region keeps its mouse target
// because no row is inserted around the reply.
{
  const row = new core.AssistantMessageComponent({ role: 'assistant', stopReason: 'stop', content: [
    { type: 'text', text: 'FIRST_TEXT_BLOCK' }, { type: 'thinking', thinking: 'CLICKED_NATIVE_THINKING' },
    { type: 'text', text: 'SECOND_TEXT_BLOCK' },
  ] }, true);
  const native = row.render(60), children = [...row.contentContainer.children];
  const rendered = renderFinalReply(row, 60, themeModule.theme);
  assert.deepEqual(rendered.map(stripAnsi), nativeText(native), 'multiple native text blocks are unchanged');
  assert.deepEqual(row.contentContainer.children, children, 'native child identity and order are untouched');
  const y = rendered.findIndex(line => stripAnsi(line).includes('Thinking'));
  assert.ok(row.handleMouse({ type: 'click', button: 'left', x: 2, y, width: 60, height: rendered.length, screenX: 2, screenY: y })?.handled, 'native container maps a thinking click shifted by top padding');
  assert.match(stripAnsi(renderFinalReply(row, 60, themeModule.theme).join('\n')), /CLICKED_NATIVE_THINKING/);
}

function fixture({ thinking = false } = {}) {
  const hooks = new Map(), bus = new Map(), commands = new Map();
  const subscribe = (map, name, fn) => {
    const set = map.get(name) || new Set(); map.set(name, set); set.add(fn); return () => set.delete(fn);
  };
  const manager = core.SessionManager.inMemory('/synthetic-final-surface');
  const pi = {
    on: (name, fn) => subscribe(hooks, name, fn),
    events: { on: (name, fn) => subscribe(bus, name, fn), emit(name, value) { for (const fn of [...bus.get(name) || []]) fn(value); } },
    getAllTools: () => [], appendEntry: (kind, data) => manager.appendCustomEntry(kind, data),
    registerCommand: (name, definition) => commands.set(name, definition),
  };
  const mode = createDisplayMode(), workControls = registerWorkStrip(pi, mode);
  const stopThinking = thinking ? registerModernThinking(pi, mode) : () => {};
  const dispose = () => { stopThinking(); workControls.dispose(); };
  registerFoldCommand(pi, mode, workControls);
  const ui = { theme: themeModule.theme, isFollowingOutput: true, notify() {}, requestRender() {} };
  if (thinking) ui.setHiddenThinkingLabel = () => { for (const row of display.chatContainer.children) if (row instanceof core.AssistantMessageComponent) row.setHiddenThinkingLabel('Thinking...'); };
  const ctx = { mode: 'tui', hasUI: true, ui, sessionManager: manager, isIdle: () => true };
  const display = {
    chatContainer: new tui.Container(), ui, pendingTools: new Map(), outputPad: 1,
    toolOutputExpanded: false, hideThinkingBlock: true, sessionManager: manager,
    session: { extensionRunner: { getMessageRenderer() {} } },
    getUserMessageText: value => value.content,
    getMarkdownThemeWithSettings: () => themeModule.getMarkdownTheme(), getMarkdownTransformers: () => [],
    editor: { addToHistory() {} },
  };
  const event = (name, value = {}) => { for (const fn of [...hooks.get(name) || []]) fn(value, ctx); };
  const add = value => {
    value.timestamp ??= 1000 + manager.getBranch().length;
    manager.appendMessage(value);
    const entry = manager.getBranch().at(-1);
    core.InteractiveMode.prototype.addMessageToChat.call(display, value);
    return { row: display.chatContainer.children.at(-1), entry };
  };
  const tool = () => {
    const row = new core.ToolExecutionComponent('read', 'surface-read', {}, { outputPad: 1 }, undefined, ui, '/synthetic-final-surface');
    row.setArgsComplete(); row.updateResult({ content: [{ type: 'text', text: 'READ_RESULT' }], isError: false });
    display.chatContainer.addChild(row); return row;
  };
  const paint = () => display.chatContainer.render(60);
  const view = row => { paint(); return display.chatContainer[projectedChildren].find(item => item === row || item.children?.[0] === row); };
  return { add, tool, event, emit: pi.events.emit, paint, view, mode, dispose, ui, display, manager, ctx, commands };
}

// A direct answer gets a final surface without introducing a Work header.
{
  const f = fixture();
  try {
    f.add({ role: 'user', content: 'Answer directly.' });
    const commentary = f.add(message('Intermediate reply.'));
    const final = f.add(message());
    const canonical = [...f.display.chatContainer.children], native = final.row.render(60);
    const transcript = JSON.stringify(f.manager.getBranch());
    f.event('session_start'); f.paint();
    assert.equal(f.view(commentary.row), commentary.row, 'earlier commentary stays plain');
    assert.ok(!f.display.chatContainer[projectedChildren].some(row => row.constructor.name === 'WorkStripHeader'));
    const surface = f.view(final.row);
    assert.notEqual(surface, final.row);
    assertReplySurface(surface.render(60), f.ui.theme);
    assert.deepEqual(surface.render(60).map(stripAnsi), nativeText(native), 'the projected reply keeps its native rows');
    // Theme caching stays native: the projected view never paints its own bytes.
    themeModule.initTheme('dark', false); f.ui.theme = themeModule.theme;
    const changed = f.view(final.row).render(60);
    assert.deepEqual(changed, final.row.render(60), 'the final view reports the native rows after a theme change');
    assertReplySurface(changed, f.ui.theme);
    f.mode.setEnabled(false);
    assert.deepEqual(f.paint(), canonical.flatMap(row => row.render(60)), 'compact-off retains native bytes');
    f.mode.setEnabled(true); f.paint();
    assert.deepEqual(f.display.chatContainer.children, canonical);
    assert.equal(JSON.stringify(f.manager.getBranch()), transcript, 'direct final styling adds no transcript metadata');
  } finally { f.dispose(); f.mode.dispose(); }
}

// A stop reason alone cannot turn a live intermediate response into a final.
for (const stopReason of ['stop', 'toolUse', 'error', 'aborted', 'length']) {
  const f = fixture();
  try {
    f.event('session_start'); f.event('agent_start');
    f.add({ role: 'user', content: 'Live response.' });
    const final = f.add(message('LIVE_REPLY', stopReason));
    assert.equal(f.view(final.row), final.row, 'live replies retain native rendering before settlement');
    f.event('agent_settled');
    assert.equal(f.view(final.row) !== final.row, stopReason !== 'toolUse', 'only a settled terminal reply receives a surface');
    assert.match(stripAnsi(f.paint().join('\n')), /LIVE_REPLY/, 'terminal errors and interruptions retain their reply');
    const failure = { error: 'Error: Unknown error', aborted: 'Operation aborted', length: 'Response was truncated before completion.' }[stopReason];
    if (failure) assert.ok(stripAnsi(f.paint().join('\n')).includes(failure), 'native failure details remain distinct and visible');
    final.row.isStreaming = true;
    assert.equal(f.view(final.row), final.row, 'a streaming component is never styled as settled');
  } finally { f.dispose(); f.mode.dispose(); }
}

// Execution commentary keeps one gutter through streaming and later replies.
// Only the settled terminal reply moves out of the work section.
{
  const f = fixture();
  try {
    f.event('session_start'); f.event('agent_start');
    f.add({ role: 'user', content: 'Follow the live reply lifecycle.' });
    const first = f.add(message('FIRST_LIVE_COMMENTARY')).row;
    assert.equal(f.view(first), first, 'commentary alone does not introduce a work section');
    f.tool();
    const firstView = f.view(first);
    assert.equal(firstView.constructor.name, 'WorkChild', 'execution activity indents the current commentary immediately');
    assert.match(stripAnsi(firstView.render(60).join('\n')), /\n   FIRST_LIVE_COMMENTARY/);
    const nextMessage = message('NEXT_LIVE_COMMENTARY');
    f.event('message_start', { message: nextMessage });
    const next = f.add(nextMessage).row;
    next.updateContent(nextMessage, true);
    assert.equal(f.view(first), firstView, 'a newer reply does not shift the preceding commentary');
    const nextView = f.view(next);
    assert.equal(nextView.constructor.name, 'WorkChild', 'streaming commentary uses the same child gutter');
    next.updateContent(nextMessage, false); f.event('message_end', { message: nextMessage });
    assert.equal(f.view(next), nextView, 'message_end and stop alone do not promote commentary');
    const canonical = [...f.display.chatContainer.children];
    f.mode.setEnabled(false);
    assert.deepEqual(f.paint(), canonical.flatMap(row => row.render(60)), 'compact-off keeps native live rendering byte for byte');
    f.mode.setEnabled(true);
    assert.equal(f.view(next), nextView, 'compact-on restores the same commentary gutter');

    const finalMessage = message('CONFIRMED_FINAL_REPLY');
    f.event('message_start', { message: finalMessage });
    const final = f.add(finalMessage).row;
    final.updateContent(finalMessage, true);
    f.event('agent_settled');
    assert.equal(f.view(final).constructor.name, 'WorkChild', 'a streaming reply remains a work child even after agent settlement');
    final.updateContent(finalMessage, false); f.event('message_end', { message: finalMessage });
    const surface = f.view(final);
    assert.notEqual(surface.constructor.name, 'WorkChild', 'confirmed final reply leaves the work gutter');
    assertReplySurface(surface.render(60), f.ui.theme);
    assert.match(stripAnsi(surface.render(60).join('\n')), /\n CONFIRMED_FINAL_REPLY/);
    assert.equal(f.view(first), firstView, 'earlier commentary retains its gutter after final confirmation');
    assert.deepEqual(f.display.chatContainer.children, [...canonical, final], 'projection preserves the native child tree');
  } finally { f.dispose(); f.mode.dispose(); }
}

// Parent settlement cannot style a reply as final while its descendants run.
{
  const f = fixture();
  try {
    f.event('session_start'); f.event('agent_start');
    f.add({ role: 'user', content: 'Wait for the owned child.' }); f.tool();
    f.emit('subagent:async-started', { id: 'surface-child' });
    const final = f.add(message('WAITING_REPLY')).row;
    f.event('agent_settled');
    assert.equal(f.view(final).constructor.name, 'WorkChild', 'waiting reply remains inside the work section');
    assert.match(stripAnsi(f.paint().join('\n')), /Waiting/);
    f.emit('subagent:async-complete', { id: 'surface-child', state: 'complete', success: true });
    assertReplySurface(f.view(final).render(60), f.ui.theme);
  } finally { f.dispose(); f.mode.dispose(); }
}

{
  const f = fixture();
  try {
    f.add({ role: 'user', content: 'Tool call with commentary.' });
    const intermediate = message('Tool commentary.', 'stop');
    intermediate.content.push({ type: 'toolCall', id: 'surface-tool', name: 'read', arguments: {} });
    const row = f.add(intermediate).row;
    f.event('session_start');
    assert.equal(f.view(row).constructor.name, 'WorkChild', 'text accompanying a tool call stays inside the work section');
    assert.deepEqual(f.view(row).children, [row], 'tool-call text retains its native component');
  } finally { f.dispose(); f.mode.dispose(); }
}

// Folding and unfolding use the same final surface at the native main margin.
{
  const f = fixture();
  try {
    const user = f.add({ role: 'user', content: 'Inspect a file.' });
    f.add(message('Checking the file.')); f.tool();
    const final = f.add({ role: 'assistant', stopReason: 'stop', content: [
      { type: 'thinking', thinking: 'Native thinking remains inspectable.' }, { type: 'text', text: 'FINAL_REPLY' },
    ] });
    f.manager.appendCustomEntry(workEvidenceType, {
      version: 1, userId: user.entry.id, finalId: final.entry.id, endId: final.entry.id,
      startedAt: 1000, endedAt: 2000, outcome: 'completed',
    });
    f.event('session_start');
    const folded = f.view(final.row).render(60);
    const nativeRows = final.row.render(60).map(stripAnsi);
    assert.deepEqual(folded.map(stripAnsi), [nativeRows[0], nativeRows.at(-1)], 'a direct answer keeps the native gap and reply rows with thinking folded');
    assertReplySurface(folded, f.ui.theme);
    await f.commands.get('fold').handler('expand', f.ctx);
    const surface = f.view(final.row), expanded = surface.render(60);
    assert.match(stripAnsi(expanded.join('\n')), /Thinking/);
    const thinkingIndex = expanded.findIndex(line => stripAnsi(line).includes('Thinking'));
    assert.ok(cells(expanded[thinkingIndex]).every(cell => !cell), 'native thinking stays on the plain surface');
    const finalLine = expanded.find(line => stripAnsi(line).includes('FINAL_REPLY'));
    assert.match(stripAnsi(finalLine), /^ FINAL_REPLY/, 'final text retains the native main margin');
    assert.ok(!cells(finalLine).includes(token(f.ui.theme)), 'the final text keeps the plain native surface');
    const click = { type: 'click', button: 'left', x: 2, y: thinkingIndex, width: 60, height: expanded.length, screenX: 2, screenY: thinkingIndex };
    assert.ok(surface.handleMouse(click)?.handled, 'native thinking mouse coordinates remain valid');
    assert.match(stripAnsi(surface.render(60).join('\n')), /Native thinking remains inspectable/);
  } finally { f.dispose(); f.mode.dispose(); }
}

console.log('Final reply native surface: byte-exact Markdown, images, resets, themes, settlement, direct replies, folding, mouse coordinates and compact-off passed');

// Restored transcript: two tool rounds and leading thinking on the final answer.
// Both adapters must cooperate while final padding and work folding are active.
{
  const f = fixture({ thinking: true });
  try {
    const user = f.add({ role: 'user', content: 'Inspect the recorded samples.' });
    for (let n = 1; n <= 2; n++) {
      f.add({ role: 'assistant', stopReason: 'toolUse', content: [
        { type: 'thinking', thinking: `Round ${n} summary.\nRecorded round ${n} body.` },
        { type: 'toolCall', id: `round-${n}`, name: 'read', arguments: {} },
      ] });
      f.tool();
    }
    const final = f.add({ role: 'assistant', stopReason: 'stop', content: [
      { type: 'thinking', thinking: 'Final source summary.\nRecorded final body.' },
      { type: 'text', text: 'GROUPED_FINAL_REPLY' },
    ] });
    f.manager.appendCustomEntry(workEvidenceType, { version: 1, userId: user.entry.id,
      finalId: final.entry.id, endId: final.entry.id, startedAt: 1000, endedAt: 2000, outcome: 'completed' });
    const transcript = JSON.stringify(f.manager.getBranch());
    f.event('session_start');
    assert.doesNotMatch(stripAnsi(f.paint().join('\n')), /Thinking/);
    for (let repeat = 0; repeat < 3; repeat++) {
      await f.commands.get('fold').handler('expand', f.ctx);
      const rendered = stripAnsi(f.paint().join('\n'));
      assert.match(rendered, /Thinking · 3 rounds/);
      assert.doesNotMatch(rendered, /Thinking\.\.\./);
      assert.equal((rendered.match(/Thinking ·/g) || []).length, 1);
      const surface = f.view(final.row), rows = surface.render(60);
      const y = rows.findIndex(line => stripAnsi(line).includes('Thinking ·'));
      assert.equal(surface.handleMouse({ type: 'click', button: 'left', x: 2, y, width: 60, height: rows.length })?.handled, true);
      assert.match(stripAnsi(f.paint().join('\n')), /3\. Final source summary/);
      await f.commands.get('fold').handler('collapse', f.ctx);
      assert.doesNotMatch(stripAnsi(f.paint().join('\n')), /Thinking|Recorded final body/);
      assert.match(stripAnsi(f.paint().join('\n')), /GROUPED_FINAL_REPLY/);
    }
    assert.equal(JSON.stringify(f.manager.getBranch()), transcript);
  } finally { f.dispose(); f.mode.dispose(); }
}
