import assert from 'node:assert/strict';
import { core, loadSource, themeModule, tui, stripAnsi } from './test-runtime.mjs';

const { registerWorkStrip } = await loadSource('./work-strip.ts');
const { createDisplayMode } = await loadSource('./display-mode.ts');
const { projectedChildren, workEvidenceType } = await loadSource('./work-strip-view.ts');

// Exercise the native child tree. A colored card's blank padding is not an
// outside transcript gap, so spacing assertions use component identity.
function fixture() {
  const hooks = new Map(), bus = new Map();
  const subscribe = (map, name, fn) => {
    if (!map.has(name)) map.set(name, new Set());
    map.get(name).add(fn);
    return () => map.get(name).delete(fn);
  };
  const manager = core.SessionManager.inMemory('/synthetic-spacing');
  const pi = {
    on: (name, fn) => subscribe(hooks, name, fn),
    events: {
      on: (name, fn) => subscribe(bus, name, fn),
      emit: (name, value) => { for (const fn of [...(bus.get(name) || [])]) fn(value); },
    },
    getAllTools: () => [],
    appendEntry: (kind, data) => manager.appendCustomEntry(kind, data),
  };
  const mode = createDisplayMode();
  const dispose = registerWorkStrip(pi, mode).dispose;
  const ui = { isFollowingOutput: true, requestRender() {}, theme: themeModule.theme };
  const ctx = { mode: 'tui', hasUI: true, ui, sessionManager: manager, isIdle: () => true };
  const display = {
    chatContainer: new tui.Container(), ui, pendingTools: new Map(), outputPad: 1,
    toolOutputExpanded: false, hideThinkingBlock: true, sessionManager: manager,
    session: { extensionRunner: {
      getMessageRenderer() {},
      getEntryRenderer: () => () => new tui.Text('CUSTOM_ENTRY', 0, 0),
    } },
    getUserMessageText: message => message.content,
    getMarkdownThemeWithSettings: () => themeModule.getMarkdownTheme(),
    getMarkdownTransformers: () => [], editor: { addToHistory() {} },
  };
  const add = message => {
    message.timestamp ??= 1000 + manager.getBranch().length;
    const before = display.chatContainer.children.length;
    manager.appendMessage(message);
    core.InteractiveMode.prototype.addMessageToChat.call(display, message);
    return display.chatContainer.children.slice(before);
  };
  const assistant = text => add({ role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop' }).at(-1);
  const user = add({ role: 'user', content: 'Initial prompt.' }).at(-1);
  const userId = manager.getBranch().at(-1).id;
  const activity = new core.ToolExecutionComponent('read', 'spacing-activity', {}, { outputPad: 1 }, undefined, ui, '/synthetic-spacing');
  activity.setArgsComplete(); activity.updateResult({ content: [{type:'text',text:'HIDDEN_ACTIVITY'}], isError:false });
  display.chatContainer.addChild(activity);
  const commentary = assistant('HIDDEN_COMMENTARY');
  const final = assistant('VISIBLE_FINAL');
  const finalId = manager.getBranch().at(-1).id;
  manager.appendCustomEntry(workEvidenceType, {
    version: 1, userId, finalId, endId: finalId,
    startedAt: 1000, endedAt: 2000, outcome: 'completed',
  });
  const paint = () => {
    const rendered = display.chatContainer.render(100);
    return { rows: display.chatContainer[projectedChildren], text: stripAnsi(rendered.join('\n')) };
  };
  const start = () => { for (const fn of [...(hooks.get('session_start') || [])]) fn({}, ctx); return paint(); };
  return { add, assistant, display, manager, mode, dispose, paint, start, user, commentary, final, ui };
}

const skill = suffix => `<skill name="spacing" location="/synthetic-spacing/SKILL.md">\nSynthetic instructions.\n</skill>${suffix}`;
for (const suffix of ['\n\nFollow-up prompt.', '']) {
  const f = fixture();
  try {
    const nativeRows = f.add({ role: 'user', content: skill(suffix) });
    const [gap, card, userGap, user] = nativeRows;
    assert.ok(gap instanceof tui.Spacer);
    assert.ok(card instanceof core.SkillInvocationMessageComponent);
    const { rows, text } = f.start();
    assert.equal(rows[rows.indexOf(card) - 1], gap, 'skill retains its native outside spacer');
    const finalView = rows.find(row => row.children?.[0] === f.final);
    const finalLines = finalView.render(100).map(stripAnsi);
    assert.deepEqual(finalLines, f.final.render(100).map(stripAnsi), 'final keeps its native rows');
    assert.equal(finalLines[0], '', 'final keeps its separate native outer gap');
    assert.deepEqual(gap.render(100), [''], 'following skill keeps an unfilled outside gap');
    assert.equal(rows[rows.indexOf(finalView) + 1], gap, 'no extra component separates final card and following native gap');
    if (suffix) {
      assert.ok(userGap instanceof tui.Spacer);
      assert.ok(user instanceof core.UserMessageComponent);
      assert.equal(rows[rows.indexOf(user) - 1], userGap, 'skill and user keep their separate native gap');
    } else assert.equal(nativeRows.length, 2, 'skill-only invocation has no synthetic user row');
    assert.match(text, /VISIBLE_FINAL/);
    assert.doesNotMatch(text, /HIDDEN_COMMENTARY/);
  } finally { f.dispose(); }
}

for (const role of ['branchSummary', 'compactionSummary']) {
  const f = fixture();
  try {
    const [gap, summary] = f.add({ role, summary: 'SUMMARY_CONTENT', tokensBefore: 100 });
    assert.ok(gap instanceof tui.Spacer);
    const { rows } = f.start();
    assert.equal(rows[rows.indexOf(summary) - 1], gap, `${role} retains its native outside spacer`);
  } finally { f.dispose(); }
}

for (const kind of ['custom', 'custom-entry', 'user-bash', 'question']) {
  const f = fixture();
  try {
    let card;
    if (kind === 'custom') card = f.add({ role: 'custom', customType: 'spacing-notice', display: true, content: 'CUSTOM_MESSAGE' }).at(-1);
    if (kind === 'custom-entry') {
      f.manager.appendCustomEntry('spacing-entry', {});
      core.InteractiveMode.prototype.addCustomEntryToChat.call(f.display, f.manager.getBranch().at(-1));
      card = f.display.chatContainer.children.at(-1);
    }
    if (kind === 'user-bash') card = f.add({ role: 'bashExecution', command: 'printf synthetic', output: 'USER_BASH', exitCode: 0, cancelled: false }).at(-1);
    if (kind === 'question') {
      card = new core.ToolExecutionComponent('ask_user_question', 'spacing-question', {}, { outputPad: 1 }, undefined, f.ui, '/synthetic-spacing');
      card.setArgsComplete();
      card.updateResult({ content: [{ type: 'text', text: 'QUESTION_ANSWER' }], isError: false });
      f.display.chatContainer.addChild(card);
    }
    const internalGap = card.children[0];
    assert.ok(internalGap instanceof tui.Spacer, `${kind} owns a native internal gap`);
    const { rows } = f.start();
    const index = rows.findIndex(row => row === card || row.constructor.name === 'WorkChild' && row.children[0] === card);
    assert.ok(index >= 0, `${kind} remains visible`);
    assert.ok(!(rows[index - 1] instanceof tui.Spacer), `${kind} receives no extra outside spacer`);
    assert.equal(card.children[0], internalGap, `${kind} retains its own spacer`);
    assert.equal(rows.filter(row => row instanceof tui.Spacer).length, 0, `${kind} adds no top-level gap`);
  } finally { f.dispose(); }
}

{
  const f = fixture();
  try {
    const hiddenGap = new tui.Spacer(2), trailingGap = new tui.Spacer(3);
    const hidden = new core.ToolExecutionComponent('read', 'hidden-read', {}, { outputPad: 1 }, undefined, f.ui, '/synthetic-spacing');
    hidden.setArgsComplete();
    hidden.updateResult({ content: [{ type: 'text', text: 'HIDDEN_TOOL' }], isError: false });
    f.display.chatContainer.addChild(hiddenGap);
    f.display.chatContainer.addChild(hidden);
    const notice = f.add({ role: 'custom', customType: 'spacing-notice', display: true, content: 'KEPT_NOTICE' }).at(-1);
    f.display.chatContainer.addChild(trailingGap);
    const canonical = [...f.display.chatContainer.children];
    const { rows, text } = f.start();
    assert.ok(!rows.includes(hiddenGap), 'gap owned by hidden row is discarded');
    assert.ok(!rows.includes(hidden), 'completed read is folded');
    assert.ok(!(rows[rows.indexOf(notice) - 1] instanceof tui.Spacer), 'hidden gap is not transferred to the next visible row');
    assert.ok(!rows.includes(trailingGap), 'folded trailing gap is discarded');
    assert.doesNotMatch(text, /HIDDEN_TOOL|HIDDEN_COMMENTARY/);
    assert.deepEqual(f.display.chatContainer.children, canonical, 'folding preserves the canonical tree');
    const header = rows.find(row => row.constructor.name === 'WorkStripHeader');
    header.expand();
    const open = f.paint();
    assert.deepEqual(open.rows.filter(row => row !== header).map(row => row.children?.length === 1 && canonical.includes(row.children[0]) ? row.children[0] : row), canonical, 'expanded projection keeps canonical row identity and order');
    assert.match(open.text, /HIDDEN_TOOL|HIDDEN_COMMENTARY/);
    f.mode.setEnabled(false);
    const native = f.paint();
    assert.equal(native.rows, undefined, 'compact-off uses the native render path');
    assert.deepEqual(f.display.chatContainer.children, canonical, 'compact-off keeps canonical identity and order');
    assert.equal(native.text, stripAnsi(canonical.flatMap(row => row.render(100)).join('\n')), 'compact-off matches the complete native rendering');
  } finally { f.dispose(); }
}

{
  const f = fixture();
  try {
    f.add({ role: 'custom', customType: 'ddd', display: true, content: 'DDD_NOTICE' });
    const { rows } = f.start();
    const replacement = rows.find(row => row.render(100).some(line => stripAnsi(line).includes('DDD · DDD_NOTICE')));
    assert.equal(replacement.constructor.name, 'WorkChild', 'DDD remains indented within its work section');
    assert.ok(replacement.children[0] instanceof tui.Container, 'DDD replacement retains a host wrapper');
    assert.ok(replacement.children[0].children[0] instanceof tui.Spacer, 'DDD wrapper restores its native internal leading gap');
    assert.ok(!(rows[rows.indexOf(replacement) - 1] instanceof tui.Spacer), 'DDD receives no extra outside gap');
    const pane = replacement.children[0].children.at(-1);
    pane.open = true;
    const expanded = replacement.render(100).map(stripAnsi);
    assert.match(expanded[2], /^     DDD_NOTICE/, 'DDD body follows its header and keeps the work and content insets');
    assert.equal(expanded.length, 3, 'DDD retains only its native outer gap; sole content stays visible');
    pane.open = false;
    assert.equal(replacement.render(100).length, 2, 'collapsed DDD keeps only the native gap and summary');

  } finally { f.dispose(); }
}

{
  const f = fixture();
  try {
    const source = 'DDD reminder.\n\nFirst paragraph.\n\nSecond paragraph.';
    const recorded = f.add({ role: 'custom', customType: 'ddd', display: true, content: source }).at(-1);
    const { rows } = f.start();
    const replacement = rows.find(row => row.render(100).some(line => stripAnsi(line).includes('DDD · DDD reminder.')));
    const pane = replacement.children[0].children.at(-1); pane.open = true;
    const compact = replacement.render(100).map(stripAnsi);
    assert.equal(compact.filter(line => line.includes('DDD reminder.')).length, 1, 'exact DDD opening summary appears only in its header');
    assert.match(compact[2], /First paragraph/);
    assert.equal(compact[3].trim(), '', 'recorded paragraph spacing stays intact');
    assert.match(compact[4], /Second paragraph/);
    assert.equal(recorded.message.content, source, 'DDD source is not rewritten');
    f.mode.setEnabled(false);
    assert.match(f.paint().text, /DDD reminder\./, 'native mode retains the original DDD text');
  } finally { f.dispose(); }
}

console.log('Work-strip native spacer ownership, internal gaps, hidden rows, trailing gaps and fallback passed');
