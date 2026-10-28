import assert from 'node:assert/strict';
import { core, loadSource, themeModule, tui, stripAnsi } from './test-runtime.mjs';

const { registerWorkStrip } = await loadSource('./work-strip.ts');
const { registerFoldCommand } = await loadSource('./fold-command.ts');
const { createDisplayMode } = await loadSource('./display-mode.ts');
const { projectedChildren, workEvidenceType, recordedWorkEvidence } = await loadSource('./work-strip-view.ts');

function fixture() {
  const hooks = new Map(), bus = new Map(), commands = new Map(), shortcuts = new Map(), inputs = new Set(), notices = [];
  const subscribe = (map, name, fn) => {
    const set = map.get(name) || new Set(); map.set(name, set); set.add(fn); return () => set.delete(fn);
  };
  const manager = core.SessionManager.inMemory('/synthetic-hierarchy');
  let ownership;
  const pi = {
    on: (name, fn) => subscribe(hooks, name, fn),
    events: { on: (name, fn) => subscribe(bus, name, fn), emit(name, value) { for (const fn of [...bus.get(name) || []]) fn(value); } },
    getAllTools: () => [], appendEntry: (kind, data) => manager.appendCustomEntry(kind, data),
    registerCommand: (name, definition) => commands.set(name, definition),
    registerShortcut: (name, definition) => shortcuts.set(name, definition),
  };
  pi.events.on('compact-renderer:work-strip:v1', value => { ownership = value.ownsExecutionStatus; });
  const mode = createDisplayMode(), workControls = registerWorkStrip(pi, mode), dispose = workControls.dispose;
  registerFoldCommand(pi, mode, workControls);
  const ui = {
    isFollowingOutput: true, theme: themeModule.theme, requestRender() {},
    onTerminalInput(fn) { inputs.add(fn); return () => inputs.delete(fn); },
    notify(message, tone) { notices.push({ message, tone }); },
  };
  const ctx = { mode: 'tui', hasUI: true, ui, sessionManager: manager, isIdle: () => true };
  const display = {
    chatContainer: new tui.Container(), ui, pendingTools: new Map(), outputPad: 1,
    toolOutputExpanded: false, hideThinkingBlock: true, sessionManager: manager,
    session: { extensionRunner: { getMessageRenderer() {} } },
    getUserMessageText: message => message.content,
    getMarkdownThemeWithSettings: () => themeModule.getMarkdownTheme(), getMarkdownTransformers: () => [],
    editor: { addToHistory() {} },
  };
  const event = (name, value = {}) => { for (const fn of [...hooks.get(name) || []]) fn(value, ctx); };
  const add = message => {
    message.timestamp ??= 1000 + manager.getBranch().length;
    manager.appendMessage(message);
    const entry = manager.getBranch().at(-1);
    core.InteractiveMode.prototype.addMessageToChat.call(display, message);
    return { row: display.chatContainer.children.at(-1), entry };
  };
  const assistant = content => add({ role: 'assistant', content: typeof content === 'string' ? [{ type: 'text', text: content }] : content, stopReason: 'stop' });
  const tool = () => {
    const row = new core.ToolExecutionComponent('read', 'hierarchy-read', { path: '/synthetic/file.txt' }, { outputPad: 1 }, undefined, ui, '/synthetic-hierarchy');
    row.setArgsComplete(); row.updateResult({ content: [{ type: 'text', text: 'HIDDEN_TOOL_CONTENT' }], isError: false });
    display.chatContainer.addChild(row); return row;
  };
  const save = (user, final) => manager.appendCustomEntry(workEvidenceType, {
    version: 1, userId: user.entry.id, finalId: final.entry.id, endId: final.entry.id,
    startedAt: 1000, endedAt: 3000, outcome: 'completed',
  });
  const paint = (width = 100) => {
    const rendered = display.chatContainer.render(width);
    return { rows: display.chatContainer[projectedChildren], lines: rendered.map(stripAnsi), text: stripAnsi(rendered.join('\n')) };
  };
  const choices = () => { const items = []; pi.events.emit('compact-renderer:inspect:v1', { add: item => items.push(item) }); return items; };
  const work = args => commands.get('fold').handler(args, ctx);
  return { manager, mode, dispose, display, event, add, assistant, tool, save, paint, choices, work, shortcuts, notices, get ownership() { return ownership; } };
}

// Valid completion metadata cannot create execution activity where none occurred.
for (const saved of [false, true]) for (const thought of ['none', 'separate', 'mixed']) {
  const f = fixture();
  try {
    const user = f.add({ role: 'user', content: `Direct answer ${thought}.` });
    if (thought === 'separate') f.assistant([{ type: 'thinking', thinking: 'Recorded reasoning without tools.' }]);
    const final = f.assistant([
      ...(thought === 'mixed' ? [{ type: 'thinking', thinking: 'Recorded mixed reasoning without tools.' }] : []),
      { type: 'text', text: 'DIRECT_FIRST_PARAGRAPH\n\nDIRECT_SECOND_PARAGRAPH' },
    ]);
    if (saved) f.save(user, final);
    const native = f.paint().lines;
    assert.equal(recordedWorkEvidence(f.manager.getBranch()).size, saved ? 1 : 0, 'saved fixture evidence is valid');
    f.event('session_start');
    const projected = f.paint();
    assert.deepEqual(projected.lines, native, `${thought} response keeps its native reply rows with saved=${saved}`);
    assert.ok(!projected.rows.some(row => row.constructor.name === 'WorkStripHeader'), 'response and thinking alone receive no work strip');
    assert.equal(f.choices().filter(item => item.kind === 'Work').length, 0, 'nonactivity does not enter Work inspection');
    assert.equal(f.ownership, false, 'nonactivity leaves execution-status ownership native');
    f.shortcuts.get('ctrl+alt+w').handler();
    assert.ok(!f.paint().rows.some(row => row.constructor.name === 'WorkStripHeader'), 'shortcut with no work sections is a no-op');
    await f.work('collapse'); assert.deepEqual(f.paint().lines, native, '/fold cannot fold a direct response');
  } finally { f.dispose(); f.mode.dispose(); }
}

{
  const f = fixture();
  try {
    const user = f.add({ role: 'user', content: 'Review the recorded decisions.' });
    f.tool();
    const question = new core.ToolExecutionComponent('ask_user_question', 'hierarchy-question', { question: 'Recorded question?' }, { outputPad: 1 }, undefined, f.display.ui, '/synthetic-hierarchy');
    question.setArgsComplete(); question.updateResult({ content: [{ type: 'text', text: 'RECORDED_ANSWER' }], isError: false });
    f.display.chatContainer.addChild(question);
    const notices = [
      ['subagent_supervisor_request', 'PENDING_DECISION'],
      ['subagent_supervisor_reply', 'ANSWERED_DECISION'],
      ['subagent-failed', 'FAILED_CHILD'],
      ['ddd', 'RECORDED_HOOK'],
    ].map(([customType, content]) => f.add({ role: 'custom', customType, content, display: true }).row);
    const final = f.assistant('VISIBLE_FINAL_REPLY');
    f.save(user, final);
    const canonical = [...f.display.chatContainer.children];
    f.event('session_start');
    for (const action of ['collapse', 'expand', 'collapse']) {
      await f.work(action);
      const view = f.paint();
      for (const original of [question, ...notices]) {
        const child = view.rows.find(row => row.constructor.name === 'WorkChild' &&
          (row.children[0] === original || original.message?.customType === 'ddd' && row.render(100).some(line => stripAnsi(line).includes('RECORDED_HOOK'))));
        assert.ok(child, `${original.toolName || original.message?.customType} stays visible and indented during ${action}`);
        assert.ok(child.render(100).map(stripAnsi).filter(line => line.trim()).every(line => line.startsWith('  ')), 'attention content stays inside the child gutter');
      }
      assert.match(view.lines.find(line => line.includes('VISIBLE_FINAL_REPLY')), /^ VISIBLE_FINAL_REPLY/, 'final reply remains at the main margin');
      assert.ok(!view.rows.some(row => row.constructor.name === 'WorkChild' && row.children[0] === final.row));
      assert.deepEqual(f.display.chatContainer.children, canonical, 'visibility and indentation preserve canonical row identity');
    }
  } finally { f.dispose(); f.mode.dispose(); }
}

{
  const f = fixture();
  try {
    f.event('session_start'); f.event('agent_start');
    f.add({ role: 'user', content: 'Give a direct answer without tools.' });
    f.assistant([{ type: 'thinking', thinking: 'LIVE_RECORDED_REASONING' }]);
    assert.ok(!f.paint().rows.some(row => row.constructor.name === 'WorkStripHeader'), 'a live response clock and thinking do not create a strip');
    f.assistant('LIVE_DIRECT_ANSWER'); f.paint(); f.event('agent_settled');
    await new Promise(resolve => setTimeout(resolve, 130));
    assert.match(f.paint().text, /LIVE_DIRECT_ANSWER/);
    assert.ok(!f.paint().rows.some(row => row.constructor.name === 'WorkStripHeader'), 'settlement keeps a direct response outside work strips');
    assert.equal(recordedWorkEvidence(f.manager.getBranch()).size, 0, 'no-tool settlement adds no work completion evidence');
    assert.equal(f.ownership, false);
  } finally { f.dispose(); f.mode.dispose(); }
}

{
  const f = fixture();
  try {
    const user = f.add({ role: 'user', content: 'Inspect the recorded file.' });
    const commentary = f.assistant('HIDDEN_COMMENTARY');
    const activity = f.tool();
    const final = f.assistant([
      { type: 'thinking', thinking: 'EXACT_FINAL_RECORDED_THINKING' },
      { type: 'text', text: 'FINAL_FIRST_PARAGRAPH\n\nFINAL_SECOND_PARAGRAPH\n\n- retained first item\n- retained second item' },
    ]);
    f.save(user, final);
    const canonical = [...f.display.chatContainer.children];
    const messages = JSON.stringify(f.manager.getBranch());
    f.event('session_start');
    const collapsed = f.paint(), header = collapsed.rows.find(row => row.constructor.name === 'WorkStripHeader');
    assert.ok(header, 'recorded tool activity receives a work strip');
    assert.equal(header.open, false, 'completed activity folds automatically');
    assert.doesNotMatch(collapsed.text, /HIDDEN_COMMENTARY|HIDDEN_TOOL_CONTENT|Thinking|EXACT_FINAL_RECORDED_THINKING/);
    const heading = collapsed.lines.findIndex(line => line.includes('Worked for'));
    const first = collapsed.lines.findIndex(line => line.includes('FINAL_FIRST_PARAGRAPH'));
    const second = collapsed.lines.findIndex(line => line.includes('FINAL_SECOND_PARAGRAPH'));
    assert.equal(first, heading + 2, 'collapsed strip keeps one outer gap before the native reply');
    assert.equal(collapsed.lines[heading + 1].trim(), '');
    assert.notEqual(collapsed.lines.at(-1).trim(), '', 'no filled padding row follows the native reply');
    assert.equal(second, first + 2, 'native final paragraph gap remains intact');
    assert.equal(collapsed.lines[first + 1].trim(), '');
    assert.match(collapsed.text, /retained first item[\s\S]*retained second item/);
    const finalChildren = [...final.row.contentContainer.children];
    f.paint();
    assert.deepEqual(final.row.contentContainer.children, finalChildren, 'folded final view restores the native thinking/text tree after painting');
    assert.deepEqual(f.display.chatContainer.children, canonical, 'projection preserves canonical row identity');
    await f.work('expand');
    const expanded = f.paint();
    assert.equal(header.open, true);
    assert.match(expanded.text, /HIDDEN_COMMENTARY/);
    assert.match(expanded.text, /HIDDEN_TOOL_CONTENT/);
    for (const original of [commentary.row, activity]) {
      const child = expanded.rows.find(row => row.constructor.name === 'WorkChild' && row.children[0] === original);
      assert.ok(child, 'activity children retain identity inside a native indentation wrapper');
      for (const width of [7, 20, 100]) {
        const inset = width >= 8 ? 2 : 0;
        const expected = original.render(Math.max(1, width - inset * 2)).map(stripAnsi).map(line => (' '.repeat(inset) + line).trimEnd());
        assert.deepEqual(child.render(width).map(stripAnsi).map(line => line.trimEnd()), expected, `child indentation follows native wrapping at width ${width}`);
      }
    }
    assert.match(expanded.lines.find(line => line.includes('HIDDEN_COMMENTARY')), /^ {3}HIDDEN_COMMENTARY/, 'commentary is indented beneath the work heading');
    assert.match(expanded.lines.find(line => line.includes('FINAL_FIRST_PARAGRAPH')), /^ FINAL_FIRST_PARAGRAPH/, 'terminal reply keeps its native column');
    assert.ok(!expanded.rows.some(row => row.constructor.name === 'WorkChild' && row.children[0] === final.row), 'final reply is outside the activity child indentation');
    await f.work('collapse');
    assert.doesNotMatch(f.paint().text, /HIDDEN_COMMENTARY|HIDDEN_TOOL_CONTENT/);
    await f.work('expand'); await f.work('shortcut off');
    f.shortcuts.get('ctrl+alt+w').handler();
    assert.equal(header.open, true, 'disabled session shortcut leaves work expanded');
    await f.work('shortcut on'); f.shortcuts.get('ctrl+alt+w').handler();
    assert.equal(header.open, false, 'enabled native shortcut toggles completed work closed');
    f.shortcuts.get('ctrl+alt+w').handler();
    assert.equal(header.open, true, 'repeated shortcut toggles completed work open');
    assert.ok(f.notices.some(notice => notice.message === 'Toggle work shortcut: off'));
    assert.ok(f.notices.some(notice => notice.message === 'Toggle work shortcut: on'));
    f.shortcuts.get('ctrl+alt+w').handler();
    assert.equal(header.open, false, 'return to the folded state before checking native thinking visibility');
    final.row.setHideThinkingBlock(false);
    assert.match(f.paint().text, /EXACT_FINAL_RECORDED_THINKING/, 'explicit native thinking expansion remains visible even when the strip is folded');
    f.mode.setEnabled(false);
    assert.equal(f.paint().text, stripAnsi(canonical.flatMap(row => row.render(100)).join('\n')), 'compact-off retains complete native rendering');
    assert.equal(JSON.stringify(f.manager.getBranch()), messages, 'hierarchy and command controls leave recorded messages and evidence unchanged');
  } finally { f.dispose(); f.mode.dispose(); }
}

{
  const f = fixture();
  try {
    f.event('session_start');
    for (const label of ['First completed turn.', 'Second completed turn.']) {
      const user = f.add({ role: 'user', content: label });
      f.tool(); const final = f.assistant(`DONE ${label}`); f.save(user, final);
    }
    f.event('session_start');
    const headers = f.paint().rows.filter(row => row.constructor.name === 'WorkStripHeader');
    assert.equal(headers.length, 2, 'fixture contains two completed work sections');
    headers[0].manual = true; headers[0].open = true;
    headers[1].manual = true; headers[1].open = false;
    f.shortcuts.get('ctrl+alt+w').handler();
    assert.deepEqual(headers.map(header => header.open), [false, false], 'any expanded eligible section makes the toggle collapse all eligible sections');
    f.shortcuts.get('ctrl+alt+w').handler();
    assert.deepEqual(headers.map(header => header.open), [true, true], 'when all eligible sections are collapsed, the toggle expands all');

    f.event('agent_start');
    f.add({ role: 'user', content: 'Waiting work.' }); f.tool();
    f.event('message_start', { message: { role: 'assistant' } });
    f.event('agent_settled');
    const waiting = f.paint().rows.findLast(row => row.constructor.name === 'WorkStripHeader');
    assert.equal(waiting.state, 'waiting', 'fixture contains a waiting work section');
    waiting.open = true;
    f.shortcuts.get('ctrl+alt+w').handler();
    assert.equal(waiting.open, true, 'toggle leaves waiting work expanded while collapsing completed sections');
    assert.deepEqual(headers.map(header => header.open), [false, false]);
  } finally { f.dispose(); f.mode.dispose(); }
}

{
  const f = fixture();
  try {
    f.event('session_start'); f.event('agent_start');
    f.add({ role: 'user', content: 'Active recorded work.' }); f.tool();
    const header = f.paint().rows.find(row => row.constructor.name === 'WorkStripHeader');
    assert.equal(header.state, 'working');
    await f.work('collapse'); f.shortcuts.get('ctrl+alt+w').handler();
    assert.equal(header.open, true, 'bulk collapse controls preserve active work visibility');
  } finally { f.dispose(); f.mode.dispose(); }
}

console.log('Work hierarchy: no strip for direct/thinking-only responses, saved evidence, native child indentation, mixed final spacing, commands and shortcut preference passed');
