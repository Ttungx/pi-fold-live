import assert from 'node:assert/strict';
import path from 'node:path';
import { core, jiti, runtime, loadSource, themeModule, tui, stripAnsi, assertCardBackground } from './test-runtime.mjs';

const { registerModernSkillPrompts } = await loadSource('./modern-skill-prompts.ts');
const { registerModernPrompts } = await loadSource('./modern-prompts.ts');
const { registerWorkStrip } = await loadSource('./work-strip.ts');
const { createDisplayMode } = await loadSource('./display-mode.ts');
const { projectedChildren, workEvidenceType } = await loadSource('./work-strip-view.ts');
const { collectPrompts } = await jiti.import(path.join(runtime, 'node_modules/pi-prompt-jump/navigation.ts'));
const body = '# Skill source\n\nRead the **recorded units**.\n\n- Keep missing values.\n- Preserve their original wording.\n\nSKILL_SOURCE_END';
const envelope = (user = 'Review the samples.') => `<skill name="fixture-review" location="/synthetic/SKILL.md">\n${body}\n</skill>${user ? '\n\n' + user : ''}`;
const removeOsc = line => line.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '');

function fixture() {
  const hooks = new Map(), bus = new Map(), inputs = new Set(), transformers = [], commands = new Map();
  const subscribe = (map, event, fn) => { const set = map.get(event) || new Set(); map.set(event, set); set.add(fn); return () => set.delete(fn); };
  const manager = core.SessionManager.inMemory('/synthetic-skill-prompts');
  const pi = {
    on: (name, fn) => subscribe(hooks, name, fn),
    events: { on: (name, fn) => subscribe(bus, name, fn), emit(name, value) { for (const fn of [...bus.get(name) || []]) fn(value); } },
    getCommands: () => [], getAllTools: () => [], registerMarkdownTransformer: fn => transformers.push(fn),
    appendEntry: (kind, data) => manager.appendCustomEntry(kind, data), registerCommand: (name, definition) => commands.set(name, definition),
  };
  const mode = createDisplayMode();
  const disposers = [registerModernPrompts(pi, mode), registerModernSkillPrompts(pi, mode), registerWorkStrip(pi, mode).dispose];
  const ui = { theme: themeModule.theme, isFollowingOutput: true, requestRender() {}, setHiddenThinkingLabel() {}, onTerminalInput(fn) { inputs.add(fn); return () => inputs.delete(fn); } };
  const ctx = { mode: 'tui', hasUI: true, ui, sessionManager: manager, isIdle: () => true };
  const display = {
    chatContainer: new tui.Container(), ui, pendingTools: new Map(), outputPad: 1,
    toolOutputExpanded: false, hideThinkingBlock: true, sessionManager: manager,
    session: { extensionRunner: { getMessageRenderer() {} } },
    getUserMessageText: value => typeof value.content === 'string' ? value.content : value.content.filter(block => block.type === 'text').map(block => block.text).join('\n'),
    getMarkdownThemeWithSettings: () => themeModule.getMarkdownTheme(), getMarkdownTransformers: () => transformers,
    editor: { addToHistory() {} },
  };
  const event = (name, value = {}) => { for (const fn of [...hooks.get(name) || []]) fn(value, ctx); };
  const add = message => {
    message.timestamp ??= 1000 + manager.getBranch().length;
    manager.appendMessage(message);
    const before = display.chatContainer.children.length, entry = manager.getBranch().at(-1);
    core.InteractiveMode.prototype.addMessageToChat.call(display, message);
    return { entry, rows: display.chatContainer.children.slice(before), message };
  };
  const user = text => add({ role: 'user', content: text });
  const assistant = text => add({ role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text }] });
  const tool = () => {
    const row = new core.ToolExecutionComponent('read', 'read-skill', { path: '/synthetic/SKILL.md' }, { outputPad: 1 }, undefined, ui, '/synthetic-skill-prompts');
    row.setArgsComplete(); row.updateResult({ content: [{ type: 'text', text: 'MODEL_READ_SKILL_TEXT' }], isError: false });
    display.chatContainer.addChild(row); return row;
  };
  const paint = (width = 100) => display.chatContainer.render(width);
  const choices = () => { paint(); const result = []; pi.events.emit('compact-renderer:inspect:v1', { add: item => result.push(item) }); return result; };
  const key = data => { for (const fn of inputs) if (fn(data)?.consume) return true; return false; };
  const dispose = () => { for (const cleanup of disposers.reverse()) cleanup(); mode.dispose(); };
  return { pi, mode, manager, ui, ctx, display, event, add, user, assistant, tool, paint, choices, key, dispose, inputs, commands };
}

// Actual native parsing creates the paired identities before session_start.
for (const appearance of ['dark', 'light']) for (const suffix of ['Review the samples.', '']) {
  themeModule.initTheme(appearance, false);
  const f = fixture();
  try {
    f.user('Earlier prompt.'); f.assistant('Earlier final.');
    const submission = f.user(envelope(suffix));
    const skill = submission.rows.find(row => row instanceof core.SkillInvocationMessageComponent);
    const user = submission.rows.find(row => row instanceof core.UserMessageComponent);
    const gap = user && submission.rows[submission.rows.indexOf(user) - 1];
    const canonical = [...f.display.chatContainer.children], native = f.paint();
    const transcript = JSON.stringify(f.manager.getBranch());
    assert.ok(native.some(line => stripAnsi(line).includes('[skill]')));
    f.event('session_start');
    const rendered = skill.render(80), plain = rendered.map(stripAnsi);
    assert.match(plain[1], /^ ▸ \/skill:fixture-review/);
    assert.doesNotMatch(plain.join('\n'), /\[skill\]|Ctrl\+O|to expand|SKILL_SOURCE_END/);
    assert.equal(plain.length, suffix ? 5 : 3, 'one top/bottom pad surrounds the command and optional original user text');
    if (suffix) {
      assert.equal(plain[2], ' '.repeat(80), 'one filled row separates command and user text');
      assert.match(plain[3], /^ Review the samples\./);
      assert.deepEqual(user.render(80), [], 'paired native user renders inside the combined skill anchor');
      assert.deepEqual(gap.render(80), [], 'paired internal gap adds no outside separation');
      assert.deepEqual(skill[projectedChildren], [user], 'inspection can find the native long-prompt identity');
    }
    assertCardBackground(rendered.map(removeOsc), 80, 'userMessageBg', f.ui.theme);
    const anchors = collectPrompts(f.display.chatContainer, 100).anchors;
    assert.equal(anchors.length, 2, 'prompt-jump retains one anchor per user envelope');
    assert.equal(anchors.at(-1).text, '/skill:fixture-review');
    assert.equal(anchors.at(-1).end - anchors.at(-1).row, skill.render(100).length, 'native skill anchor measures the complete combined card');
    assert.equal(skill.handleMouse({ type: 'click', button: 'left', shift: true, x: 3, y: 1, width: 80, height: rendered.length }), undefined, 'modified clicks do not change skill disclosure');
    assert.equal(skill.expanded, false);
    assert.equal(skill.handleMouse({ type: 'click', button: 'left', x: 3, y: 1, width: 80, height: rendered.length })?.handled, true);
    const expanded = skill.render(80);
    assert.match(expanded.map(stripAnsi).join('\n'), /SKILL_SOURCE_END/);
    assert.match(expanded.map(stripAnsi).join('\n'), /Read the recorded units\./);
    assertCardBackground(expanded.map(removeOsc), 80, 'userMessageBg', f.ui.theme);
    assert.equal(f.key('\r'), false, 'mouse expansion leaves editor Enter native');
    skill.setExpanded(false); assert.doesNotMatch(skill.render(80).map(stripAnsi).join('\n'), /SKILL_SOURCE_END/, 'native Ctrl+O state remains authoritative');
    const choice = f.choices().find(item => item.kind === 'Skill');
    choice.focus(); assert.match(skill.render(80).map(stripAnsi).join('\n'), /SKILL_SOURCE_END/);
    assert.equal(f.key('\r'), true); assert.doesNotMatch(skill.render(80).map(stripAnsi).join('\n'), /SKILL_SOURCE_END/);
    assert.equal(f.key('\x1b'), true); assert.equal(f.key('\r'), false);
    choice.focus(); assert.equal(f.key('x'), false); assert.equal(f.key('\r'), false, 'typing releases explicit skill inspection');
    skill.setExpanded(false);
    for (const width of [1, 2, 7, 24, 80]) {
      const rows = skill.render(width);
      assert.ok(rows.every(line => tui.visibleWidth(line) <= Math.max(width, 3)), `command wrapping retains native padding limits at width ${width}`);
    }
    skill.setExpanded(true);
    for (const width of [1, 2, 7, 24, 80]) {
      const rows = skill.render(width);
      assert.ok(rows.every(line => tui.visibleWidth(line) <= Math.max(width, 3)), `full skill wrapping retains native padding limits at width ${width}`);
    }
    skill.setExpanded(false); f.mode.setEnabled(false);
    assert.deepEqual(f.paint(), native, 'compact-off restores exact native skill, gap and user bytes');
    assert.equal(skill[projectedChildren], undefined);
    f.mode.setEnabled(true); f.paint();
    assert.deepEqual(f.display.chatContainer.children, canonical);
    assert.equal(JSON.stringify(f.manager.getBranch()), transcript, 'rendering never changes input or transcript entries');
  } finally { f.dispose(); assert.equal(f.inputs.size, 0); }
}

// The existing long-user disclosure renders inside the blue combined card;
// its mouse and inspection targets retain the original native user component.
{
  const f = fixture();
  try {
    const long = 'OPENING_USER\n\n' + Array.from({ length: 12 }, (_, i) => `- ORIGINAL_MIDDLE_${i}`).join('\n') + '\n\nENDING_USER';
    const submission = f.user(envelope(long));
    const skill = submission.rows.find(row => row instanceof core.SkillInvocationMessageComponent);
    const user = submission.rows.find(row => row instanceof core.UserMessageComponent);
    f.event('session_start');
    let rows = skill.render(80), plain = rows.map(stripAnsi);
    assert.match(plain.join('\n'), /OPENING_USER[\s\S]*Show more[\s\S]*ENDING_USER/);
    assert.doesNotMatch(plain.join('\n'), /ORIGINAL_MIDDLE_5/);
    const y = plain.findIndex(line => line.includes('Show more'));
    assert.equal(skill.handleMouse({ type: 'click', button: 'left', x: 3, y, width: 80, height: rows.length })?.handled, true, 'combined card translates the native user disclosure mouse coordinate');
    assert.match(skill.render(80).map(stripAnsi).join('\n'), /ORIGINAL_MIDDLE_5/);
    const promptChoice = f.choices().find(item => item.kind === 'Prompt');
    promptChoice.focus(); assert.equal(f.key('\r'), true); assert.equal(f.key('\x1b'), true);
    assert.equal(user.text, long);
    assert.deepEqual(skill[projectedChildren], [user]);
    // A custom attachment or unknown native shape must retain the whole native
    // pair rather than disappear inside the supported combined presentation.
    user.addChild(new tui.Text('UNKNOWN_ATTACHMENT', 0, 0));
    rows = f.paint();
    assert.match(rows.map(stripAnsi).join('\n'), /\[skill\][\s\S]*UNKNOWN_ATTACHMENT/);
    assert.equal(skill[projectedChildren], undefined);
    assert.ok(user.render(80).length > 0);
  } finally { f.dispose(); }
}

// Skill-only commands start their own work turn; model-initiated SKILL.md reads
// remain ordinary work and receive no submitted-command heading.
{
  const f = fixture();
  try {
    const initial = f.user('Initial work.'); f.tool(); const first = f.assistant('FIRST_FINAL');
    f.manager.appendCustomEntry(workEvidenceType, { version: 1, userId: initial.entry.id, finalId: first.entry.id, endId: first.entry.id, startedAt: 1000, endedAt: 2000, outcome: 'completed' });
    const submission = f.user(envelope(''));
    f.tool(); const final = f.assistant('SKILL_ONLY_FINAL');
    f.manager.appendCustomEntry(workEvidenceType, { version: 1, userId: submission.entry.id, finalId: final.entry.id, endId: final.entry.id, startedAt: 2000, endedAt: 3000, outcome: 'completed' });
    f.event('session_start'); f.paint();
    const projected = f.display.chatContainer[projectedChildren];
    assert.equal(projected.filter(row => row.constructor.name === 'WorkStripHeader').length, 2, 'skill-only envelope owns its own work fold');
    assert.equal(f.choices().filter(item => item.kind === 'Skill').length, 1, 'model read tools do not create skill invocation controls');
    const plain = f.paint().map(stripAnsi).join('\n');
    assert.match(plain, /FIRST_FINAL[\s\S]*\/skill:fixture-review[\s\S]*SKILL_ONLY_FINAL/);
    assert.doesNotMatch(plain, /MODEL_READ_SKILL_TEXT/);
    const skill = submission.rows.find(row => row instanceof core.SkillInvocationMessageComponent);
    assert.ok(projected.includes(skill), 'submitted command remains outside both work folds');
  } finally { f.dispose(); }
}

console.log('Command-first skill prompts: native envelopes, one blue card, exact source, skill-only work boundaries, prompt-jump identity, long prompts, mouse/keyboard inspection, themes, narrow widths, fallback and compact-off passed');
