import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSource, core, tui, themeModule, stripAnsi } from './test-runtime.mjs';

const { registerModernThinking } = await loadSource('./modern-thinking.ts');
const { renderFinalReply } = await loadSource('./work-strip-view.ts');
const { createDisplayMode } = await loadSource('./display-mode.ts');
const { AssistantMessageComponent } = core;
const native = Object.fromEntries(['updateContent', 'render', 'handleMouse'].map(key => [key, AssistantMessageComponent.prototype[key]]));
const plain = lines => lines.map(stripAnsi).join('\n');
const thinking = text => ({ type: 'thinking', thinking: text });
const text = value => ({ type: 'text', text: value });
const tool = id => ({ type: 'toolCall', id, name: 'read', arguments: { path: '/synthetic' } });
const message = (content, extra = {}) => ({ role: 'assistant', content, stopReason: 'stop', ...extra });
const entry = value => ({ type: 'message', message: value });
const nativeCard = value => new AssistantMessageComponent(value, true, themeModule.getMarkdownTheme());
const subscribe = (map, key, fn) => {
  const set = map.get(key) || new Set(); map.set(key, set); set.add(fn);
  return () => set.delete(fn);
};

function fixture(messages) {
  const listeners = new Map(), bus = new Map(), terminal = new Set(), cards = [];
  const mode = createDisplayMode();
  const pi = {
    on: (event, fn) => subscribe(listeners, event, fn),
    events: {
      on: (event, fn) => subscribe(bus, event, fn),
      emit: (event, data) => { for (const fn of [...bus.get(event) || []]) fn(data); },
    },
  };
  const ctx = { mode: 'tui', sessionManager: { getBranch: () => messages.map(entry) }, ui: {
    theme: themeModule.theme,
    setHiddenThinkingLabel() { for (const card of cards) card.setHiddenThinkingLabel('Thinking...'); },
    onTerminalInput(fn) { terminal.add(fn); return () => terminal.delete(fn); },
  } };
  const emit = (event, data = {}) => { for (const fn of [...listeners.get(event) || []]) fn(data, ctx); };
  const dispose = registerModernThinking(pi, mode);
  emit('session_start');
  cards.push(...messages.map(nativeCard));
  return {
    cards, mode, emit, dispose, terminal,
    key: data => [...terminal].some(fn => fn(data)?.consume),
    choices() { const choices = []; pi.events.emit('compact-renderer:inspect:v1', { add: choice => choices.push(choice) }); return choices; },
  };
}

function mouse(card, y, extra = {}, width = 80) {
  const rows = card.render(width);
  return card.handleMouse({ type: 'click', button: 'left', x: 3, y, screenX: 3, screenY: y,
    width, height: rows.length, shift: false, alt: false, ctrl: false, ...extra });
}

function assertNativeReply(card, width = 80) {
  const children = [...card.contentContainer.children];
  const markdown = children.filter(child => child instanceof tui.Markdown);
  const expected = markdown.map(child => child.render(width));
  const rendered = card.render(width);
  assert.deepEqual(card.contentContainer.children, children, 'render preserves native children');
  markdown.forEach((child, index) => {
    assert.ok(card.contentContainer.children.includes(child), 'native Markdown object survives compact rendering');
    assert.ok(plain(rendered).includes(plain(expected[index])), 'native Markdown reply rows remain exact');
  });
  return rendered;
}

test('pure singleton has a source summary, shared card alignment, and direct disclosure', () => {
  const original = message([thinking('# Check the recorded fields\nExact second line.'), tool('pure')]);
  const saved = JSON.stringify(original), f = fixture([original]);
  try {
    const card = f.cards[0], closed = card.render(80);
    assert.equal(closed.length, 2);
    assert.match(stripAnsi(closed[1]), /^ ▸ Thinking · Check the recorded fields/);
    assert.doesNotMatch(plain(closed), /1 round|1\./);
    assert.equal(mouse(card, 1)?.handled, true);
    const opened = plain(card.render(80));
    assert.match(opened, /Exact second line\./);
    assert.doesNotMatch(opened, /1\. Check/);
    assert.equal(f.key('\r'), false, 'mouse keeps Enter with the editor');
    assert.equal(JSON.stringify(original), saved, 'recorded message stays exact');
  } finally { f.dispose(); }
});

test('mixed singleton preserves native Markdown and OSC zones and expands directly', () => {
  const original = message([thinking('Inspect the recorded path.\nExact private body.'), text('## Visible reply\n\nA **bold** reply with `code`.')]);
  const saved = JSON.stringify(original), f = fixture([original]);
  try {
    const card = f.cards[0], closed = assertNativeReply(card);
    assert.match(plain(closed), /Thinking · Inspect the recorded path\./);
    assert.doesNotMatch(plain(closed), /Thinking\.\.\.|Exact private body|1 round/);
    assert.ok(closed[0].startsWith('\x1b]133;A\x07'), 'native assistant zone starts');
    assert.ok(closed.at(-1).includes('\x1b]133;B\x07\x1b]133;C\x07'), 'native assistant zone ends');
    assert.equal(f.choices().length, 1);
    f.choices()[0].focus();
    const opened = assertNativeReply(card);
    assert.match(plain(opened), /Exact private body\./);
    assert.doesNotMatch(plain(opened), /1\. Inspect/);
    assert.equal(f.key('\r'), true);
    assert.doesNotMatch(plain(card.render(80)), /Exact private body/);
    assert.equal(JSON.stringify(original), saved);
  } finally { f.dispose(); }
});

test('adjacent thinking blocks share one run and retain both original sources', () => {
  const f = fixture([message([thinking('First source heading.\nFirst source body.'), thinking('  '), thinking('Second source body.'), text('Native answer')])]);
  try {
    assert.equal(f.choices().length, 1);
    f.choices()[0].focus();
    const rendered = plain(assertNativeReply(f.cards[0]));
    assert.match(rendered, /First source body\./);
    assert.match(rendered, /Second source body\./);
    assert.equal((rendered.match(/Thinking ·/g) || []).length, 1);
  } finally { f.dispose(); }
});

test('text before and after thinking retains native order and region-local mouse behavior', () => {
  const f = fixture([message([text('Before the thinking region.\n\nAnother native paragraph.'), thinking('Local thinking summary.\nLocal body.'), text('After the thinking region.')])]);
  try {
    const card = f.cards[0];
    let rows = assertNativeReply(card), p = plain(rows);
    assert.ok(p.indexOf('Before the thinking') < p.indexOf('Thinking ·'));
    assert.ok(p.indexOf('Thinking ·') < p.indexOf('After the thinking'));
    const header = rows.findIndex(row => stripAnsi(row).includes('Thinking ·'));
    assert.ok(header > 1, 'thinking is below native prose');
    assert.equal(mouse(card, header)?.handled, true);
    rows = assertNativeReply(card); p = plain(rows);
    assert.match(p, /Local body\./);
    const prose = rows.findIndex(row => stripAnsi(row).includes('After the thinking'));
    assert.equal(mouse(card, prose)?.handled, undefined, 'native prose click does not hit pane');
    assert.equal(f.key('\r'), false, 'mouse leaves keyboard focus with editor');
    assert.equal(card.thinkingVisibilityOverrides.size, 0, 'pane clicks do not expand native thinking');
  } finally { f.dispose(); }
});

test('multiple separated runs and unknown native child shapes keep the native fallback', () => {
  const cases = [
    message([thinking('First run'), text('Between'), thinking('Second run'), text('Reply')]),
    message([thinking('Single run'), { type: 'futureContent', value: 'unknown' }, text('Reply')]),
  ];
  for (const original of cases) {
    const f = fixture([original]);
    try {
      const card = f.cards[0];
      assert.match(plain(card.render(80)), /Thinking\.\.\./);
      assert.doesNotMatch(plain(card.render(80)), /Thinking ·/);
      assert.equal(f.choices().length, 0);
    } finally { f.dispose(); }
  }
  const original = message([thinking('Single run'), text('Reply')]), f = fixture([original]);
  try {
    f.cards[0].contentContainer.addChild(new tui.Text('Unfamiliar native child', 1, 0));
    const rendered = plain(f.cards[0].render(80));
    assert.match(rendered, /Thinking\.\.\./);
    assert.match(rendered, /Unfamiliar native child/);
    assert.equal(f.choices().length, 0);
  } finally { f.dispose(); }
});

test('mixed error, aborted, and length layouts retain native status rows', () => {
  for (const stopReason of ['error', 'aborted', 'length']) {
    const original = message([thinking('Recorded thinking'), text('Partial answer')], { stopReason, errorMessage: 'Synthetic failure' });
    const expected = nativeCard(original).render(80), f = fixture([original]);
    try {
      assert.deepEqual(f.cards[0].render(80), expected);
      assert.equal(f.choices().length, 0);
    } finally { f.dispose(); }
  }
});

test('pure failed tool calls and user questions retain native thinking fallback', () => {
  const cases = [
    message([thinking('Failed tool source'), tool('error')], { stopReason: 'error', errorMessage: 'Synthetic tool failure' }),
    message([thinking('Aborted tool source'), tool('aborted')], { stopReason: 'aborted' }),
    ...['ask_user_question', 'question'].map(name => message([
      thinking('Recorded question source'), { ...tool(name), name },
    ], { stopReason: 'toolUse' })),
  ];
  for (const original of cases) {
    const expected = nativeCard(original).render(80), f = fixture([original]);
    try {
      assert.deepEqual(f.cards[0].render(80), expected, `${original.stopReason}/${original.content[1].name} stays native`);
      assert.match(plain(f.cards[0].render(80)), /Thinking\.\.\./);
      assert.equal(f.choices().length, 0, 'native boundary has no compact inspection choice');
    } finally { f.dispose(); }
  }
});

test('leading final thinking joins preceding rounds and ends the group at visible text', () => {
  const f = fixture([
    message([thinking('Previous source'), tool('a')]),
    message([thinking('Final source'), text('Visible reply')]),
    message([thinking('Following source'), tool('b')]),
  ]);
  try {
    assert.equal(f.choices().length, 2);
    assert.equal(f.cards[0].render(80).length, 0);
    assert.match(plain(f.cards[1].render(80)), /Thinking · 2 rounds/);
    assert.match(plain(f.cards[2].render(80)), /Thinking · Following source/);
    f.choices()[0].focus();
    assert.match(plain(assertNativeReply(f.cards[1])), /Previous source/);
    assert.match(plain(assertNativeReply(f.cards[1])), /Final source/);
  } finally { f.dispose(); }
});

test('streaming final answer preserves its preceding thinking group', () => {
  const prior = message([thinking('Previous tool round'), tool('prior')]);
  const f = fixture([prior]);
  try {
    const start = message([thinking('Streaming source.\nOriginal streaming body.')]);
    f.emit('message_start', { message: start });
    const card = nativeCard(start); f.cards.push(card);
    assert.equal(f.cards[0].render(80).length, 0);
    assert.match(plain(card.render(80)), /Thinking · 2 rounds/);
    const update = { ...start, content: [...start.content, text('Visible streaming answer')] };
    f.emit('message_update', { message: update }); card.updateContent(update, true);
    f.emit('message_end', { message: update });
    assert.equal(f.cards[0].render(80).length, 0);
    assert.match(plain(assertNativeReply(card)), /Thinking · 2 rounds/);
    assert.equal(f.choices().length, 1);
  } finally { f.dispose(); }
});

test('final reply rendering preserves compact thinking and native child identity', () => {
  const original = message([thinking('Final thinking summary.\nRecorded final body.'), text('Final visible answer')]);
  const f = fixture([original]);
  try {
    const card = f.cards[0], children = [...card.contentContainer.children];
    const rows = renderFinalReply(card, 80, themeModule.theme);
    assert.match(plain(rows), /Thinking · Final thinking summary/);
    assert.doesNotMatch(plain(rows), /Thinking\.\.\./);
    assert.deepEqual(card.contentContainer.children, children);
    const replyIndex = rows.findIndex(row => stripAnsi(row).includes('Final visible answer'));
    assert.equal(stripAnsi(rows[replyIndex]), stripAnsi(card.render(80).find(line => stripAnsi(line).includes('Final visible answer'))), 'the reply row stays native');
    assert.equal(mouse(card, rows.findIndex(row => stripAnsi(row).includes('Thinking ·')))?.handled, true);
    assert.match(plain(renderFinalReply(card, 80, themeModule.theme)), /Recorded final body/);
  } finally { f.dispose(); }
});

test('text-first streaming detects thinking added through the native shared content array', () => {
  const f = fixture([]);
  try {
    const content = [text('Visible streaming preamble')], start = message(content);
    f.emit('message_start', { message: start });
    const card = nativeCard(start); f.cards.push(card);
    assert.match(plain(card.render(80)), /Visible streaming preamble/);
    assert.equal(f.choices().length, 0, 'initial text has no thinking group');

    // Native agent-loop emits shallow message copies while providers mutate
    // the shared content array and its blocks between streaming events.
    content.push(thinking(''));
    const thinkingStart = { ...start };
    f.emit('message_update', { message: thinkingStart }); card.updateContent(thinkingStart, true);
    card.render(80);
    assert.equal(f.choices().length, 0, 'empty thinking does not create a group');
    content[1].thinking = 'Late recorded source.\nLate recorded body.';
    const update = { ...thinkingStart };
    assert.equal(start.content, update.content);
    f.emit('message_update', { message: update }); card.updateContent(update, true);
    const rendered = plain(assertNativeReply(card));
    assert.match(rendered, /Thinking · Late recorded source\./, 'first nonempty thinking update appears immediately');
    assert.doesNotMatch(rendered, /Thinking\.\.\./);
    assert.equal(f.choices().length, 1, 'streaming grouping does not need a session rebuild');
    f.choices()[0].focus();
    assert.match(plain(assertNativeReply(card)), /Late recorded body\./);
  } finally { f.dispose(); }
});

test('mouse wheel stays inside the mixed thinking region and leaves prose unchanged', () => {
  const f = fixture([message([text('Native prefix'), thinking('Bounded source.\n' + Array.from({ length: 80 }, (_, n) => `Recorded line ${n}`).join('\n')), text('Native suffix')])]);
  try {
    const card = f.cards[0], header = card.render(80).findIndex(row => stripAnsi(row).includes('Thinking ·'));
    mouse(card, header);
    const before = plain(assertNativeReply(card));
    assert.equal(mouse(card, header + 2, { type: 'wheel', button: 'none', wheelDelta: 4 })?.handled, true);
    const after = plain(assertNativeReply(card));
    assert.notEqual(after, before, 'wheel moves the bounded thinking viewport');
    assert.match(after, /Native prefix/); assert.match(after, /Native suffix/);
    assert.equal(f.key('\r'), false);
  } finally { f.dispose(); }
});

test('mode, native Ctrl+T expansion, per-run override, and disposal restore native behavior', () => {
  const original = message([thinking('A source sentence.\nExact native body.'), text('Native reply')]);
  const expected = nativeCard(original).render(80), f = fixture([original]);
  try {
    const card = f.cards[0];
    f.mode.setEnabled(false); assert.deepEqual(card.render(80), expected);
    f.mode.setEnabled(true); assert.match(plain(card.render(80)), /Thinking · A source sentence\./);
    card.setHideThinkingBlock(false); assert.match(plain(card.render(80)), /Exact native body\./);
    assert.equal(f.choices().length, 0);
    card.setHideThinkingBlock(true); assert.match(plain(card.render(80)), /Thinking ·/);
    card.thinkingVisibilityOverrides.set(0, false); card.updateContent(original);
    assert.match(plain(card.render(80)), /Exact native body\./);
    assert.equal(f.choices().length, 0);
    card.setHideThinkingBlock(true);
    f.choices()[0].focus(); assert.equal(f.key('\x14'), false, 'Ctrl+T reaches native handler');
    f.dispose(); assert.deepEqual(card.render(80), expected);
    assert.equal(f.terminal.size, 0);
    for (const key of Object.keys(native)) assert.equal(AssistantMessageComponent.prototype[key], native[key]);
    assert.equal(mouse(card, 1)?.handled, true, 'native thinking click works after disposal');
    assert.match(plain(card.render(80)), /Exact native body\./);
  } finally { f.dispose(); }
});

test('mixed tool-call messages retain native OSC policy', () => {
  const f = fixture([message([thinking('Inspect tool inputs'), text('Visible preamble'), tool('mixed')], { stopReason: 'toolUse' })]);
  try {
    const rows = assertNativeReply(f.cards[0]);
    assert.match(plain(rows), /Thinking · Inspect tool inputs/);
    assert.ok(!rows.join('').includes('\x1b]133;'), 'tool-call component has no assistant OSC zones');
  } finally { f.dispose(); }
});

test('large mixed thinking uses a bounded viewport across narrow widths', () => {
  const original = message([thinking('Large recorded heading.\n' + 'Exact bounded line 行🙂\n'.repeat(100000)), text('Native reply')]);
  const saved = JSON.stringify(original), f = fixture([original]);
  const render = tui.Markdown.prototype.render;
  let nativeThinkingPaints = 0;
  tui.Markdown.prototype.render = function (...args) {
    if (this !== f.cards[0].contentContainer.children.find(child => child instanceof tui.Markdown)) nativeThinkingPaints++;
    return render.apply(this, args);
  };
  try {
    assert.match(plain(f.cards[0].render(80)), /Thinking · Large recorded heading\./);
    f.choices()[0].focus();
    assert.ok(f.cards[0].render(80).length <= 20, 'thinking and native reply remain bounded');
    assert.match(plain(f.cards[0].render(80)), /Exact bounded line/);
    for (const width of [1, 2, 3, 8, 24, 70]) {
      assertNativeReply(f.cards[0], width);
      // Pi's unchanged Markdown outputPad can exceed a one/two-column width.
      // The adapter owns only this hidden-thinking region's width contract.
      const region = f.cards[0].contentContainer.children.find(child => child instanceof tui.MouseRegion);
      for (const row of region.render(width)) assert.ok(tui.visibleWidth(row) <= width, `thinking row fits ${width} columns`);
    }
    assert.equal(nativeThinkingPaints, 0, 'large thinking does not use native full Markdown rendering');
    assert.equal(JSON.stringify(original), saved);
  } finally { tui.Markdown.prototype.render = render; f.dispose(); }
});

test('visible preambles and unsupported multiple runs do not absorb preceding thinking', () => {
  for (const content of [
    [text('Visible preamble'), thinking('Later source'), text('Answer')],
    [thinking('First run'), text('Visible boundary'), thinking('Second run'), text('Answer')],
  ]) {
    const f = fixture([message([thinking('Earlier round'), tool('earlier')]), message(content)]);
    try {
      assert.match(plain(f.cards[0].render(80)), /Thinking · Earlier round/);
      assert.match(plain(f.cards[1].render(80)), /Answer/);
    } finally { f.dispose(); }
  }
});

test('streaming boundary changes split earlier rounds even when the broad message kind is unchanged', () => {
  for (const extra of [thinking('Second separated run'), { type: 'toolCall', id: 'question', name: 'ask_user_question', arguments: {} }]) {
    const earlier = message([thinking('Earlier source'), tool('earlier')]);
    const f = fixture([earlier]);
    try {
      const current = message([thinking('Initial leading run'), text('Visible reply')]);
      f.emit('message_start', {message: current});
      const card = nativeCard(current); f.cards.push(card);
      assert.equal(f.cards[0].render(80).length, 0);
      assert.match(plain(card.render(80)), /Thinking · 2 rounds/);
      current.content.push(extra);
      const update = {...current};
      f.emit('message_update', {message:update}); card.updateContent(update, true);
      assert.match(plain(f.cards[0].render(80)), /Thinking · Earlier source/);
      assert.doesNotMatch(plain(card.render(80)), /Thinking · 2 rounds/);
    } finally { f.dispose(); }
  }
});
