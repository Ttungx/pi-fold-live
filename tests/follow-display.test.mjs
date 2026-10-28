import assert from 'node:assert/strict';
import { core, loadAgent, loadSource, stripAnsi, themeModule } from './test-runtime.mjs';

const { registerModernTools } = await loadSource('./modern-tools.ts');
const { registerModernThinking } = await loadSource('./modern-thinking.ts');
const { createDisplayMode } = await loadSource('./display-mode.ts');
const { ToolExecutionComponent } = await loadAgent('modes/interactive/components/tool-execution.js');
const { createShellRenderers } = await loadAgent('core/tools/renderers/bash.js');

// Display-only: the live action keeps its own pane open, and the action it
// replaced folds back. No message, tool result, or transcript is changed.
const hooks = new Map();
const subscribe = (map, name, fn) => { const list = map.get(name) || []; list.push(fn); map.set(name, list); return () => map.set(name, list.filter(item => item !== fn)); };
let resolver;
const pi = { registerToolRenderer(fn) { resolver = fn; }, on: (name, fn) => subscribe(hooks, name, fn), events: { on: () => () => {}, emit() {} } };
const mode = createDisplayMode(), follow = createDisplayMode();
const ctx = { hasUI: true, sessionManager: { getBranch: () => [] }, ui: { onTerminalInput: () => () => {} } };
const dispose = registerModernTools(pi, mode, { follow });
const emit = (name, value = {}) => { for (const fn of [...(hooks.get(name) || [])]) fn(value, ctx); };
emit('session_start');

const plain = component => stripAnsi(component.render(120).join(String.fromCharCode(10)));
const rows = component => component.render(120).length;
const body = component => component.render(120).map(stripAnsi).filter(line => line.trim()).length;
const start = (id, text) => {
  const args = { command: `run ${id}` };
  const renderer = resolver('bash', () => createShellRenderers('$'));
  const component = new ToolExecutionComponent('bash', id, args, { showImages: false, outputPad: 0 }, renderer, { requestRender() {} }, '/tmp');
  component.setArgsComplete();
  emit('tool_execution_start', { toolCallId: id, toolName: 'bash', args });
  component.markExecutionStarted();
  component.updateResult({ content: [{ type: 'text', text }], details: {}, isError: false }, true);
  return component;
};
const complete = (id, component, text) => {
  component.updateResult({ content: [{ type: 'text', text }], details: { exitCode: 0 }, isError: false }, false);
  emit('tool_execution_end', { toolCallId: id, toolName: 'bash', result: { content: [], details: {} }, isError: false });
};

try {
  // 1. The running action is a fixed-height window over its newest output.
  const first = start('live-one', 'FIRST_OUTPUT');
  assert.match(plain(first), /FIRST_OUTPUT/, 'the running action shows its recorded output');
  const maxWindowRows = 4;
  assert.ok(body(first) >= 2 && body(first) <= maxWindowRows, 'the window is one heading plus at most three rows');

  first.updateResult({ content: [{ type: 'text', text: ['line one', 'line two', 'line three', 'LAST_LINE'].join("\n") }], details: {}, isError: false }, true);
  assert.match(plain(first), /LAST_LINE/, 'the window follows the newest output');
  assert.doesNotMatch(plain(first), /line one/, 'older lines leave the window instead of growing it');
  assert.ok(body(first) <= maxWindowRows, 'the window fills to its fixed height and stops');

  // 2. A long output cannot inflate the block.
  const longOutput = Array.from({ length: 40 }, (_, n) => `output-${n}`).join(String.fromCharCode(10)) + String.fromCharCode(10) + 'FORTIETH_LINE';
  first.updateResult({ content: [{ type: 'text', text: longOutput }], details: {}, isError: false }, true);
  assert.ok(body(first) <= maxWindowRows, 'a 40-line output keeps the same height');
  assert.match(plain(first), /FORTIETH_LINE/, 'the newest line stays visible');
  assert.doesNotMatch(plain(first), /output-0/, 'the first line is not the one shown');

  // 3. Completion does not collapse the window; the next action takes it over.
  const rowsBeforeCompletion = rows(first);
  complete('live-one', first, longOutput);
  assert.equal(rows(first), rowsBeforeCompletion, 'a finished action keeps its window until the next action starts');
  assert.match(plain(first), /FORTIETH_LINE|FIRST_OUTPUT/, 'the finished output stays readable');

  const second = start('live-two', 'SECOND_OUTPUT');
  assert.doesNotMatch(plain(first), /FORTIETH_LINE|FIRST_OUTPUT/, 'the previous action folds when the next one starts');
  assert.equal(body(first), 1, 'the folded action keeps one summary row');
  assert.match(plain(second), /SECOND_OUTPUT/, 'the newest action has its own window');

  complete('live-two', second, 'SECOND_OUTPUT');
  assert.match(plain(second), /SECOND_OUTPUT/, 'the finished window stays readable');
  const third = start('live-three', 'THIRD_OUTPUT');
  assert.match(plain(first), /2 actions/, 'finished actions fold into one group row');
  assert.doesNotMatch(plain(second), /SECOND_OUTPUT/);
  assert.match(plain(third), /THIRD_OUTPUT/);
  complete('live-three', third, 'THIRD_OUTPUT');

  // 4. Follow off returns to the native one-row activity display.
  follow.setEnabled(false);
  const off = start('follow-off', 'FOLLOW_OFF_OUTPUT');
  assert.doesNotMatch(plain(off), /FOLLOW_OFF_OUTPUT/, 'follow off keeps the running action folded');
  follow.setEnabled(true);
  assert.match(plain(off), /FOLLOW_OFF_OUTPUT/, 'follow on restores the window');

  // 5. A manual open replaces the window with the full pane and survives the
  //    next action, because inspection outranks follow.
  const manual = start('manual-row', 'MANUAL_OUTPUT');
  const manualRows = manual.render(120);
  manual.handleMouse({ type: 'click', button: 'left', x: 2, y: 2, screenX: 2, screenY: 2, width: 120, height: manualRows.length, shift: false, alt: false, ctrl: false });
  assert.match(plain(manual), /▸ Details/, 'a click on the window opens the full pane');
  const next = start('manual-next', 'NEXT_OUTPUT');
  assert.match(plain(manual), /MANUAL_OUTPUT/, 'the opened pane outranks follow');
  assert.match(plain(next), /NEXT_OUTPUT/, 'the newest action still gets its window');
} finally {
  dispose(); mode.dispose(); follow.dispose();
}

// 4. Thinking holds one row for the whole phase: the label flows with the newest
//    recorded text, and the next action folds it instead of every segment.
{
  const local = new Map(), cards = [];
  const thinkingMode = createDisplayMode(), thinkingFollow = createDisplayMode();
  const thinkingPi = { on: (name, fn) => subscribe(local, name, fn), events: { on: () => () => {}, emit() {} } };
  const manager = core.SessionManager.inMemory('/synthetic-follow');
  const thinkingCtx = { mode: 'tui', sessionManager: manager, ui: {
    theme: themeModule.theme,
    setHiddenThinkingLabel() { for (const card of cards) card.setHiddenThinkingLabel('Thinking...'); },
    onTerminalInput: () => () => {},
  } };
  const stop = registerModernThinking(thinkingPi, thinkingMode, thinkingFollow);
  const emitThinking = (name, value = {}) => { for (const fn of [...(local.get(name) || [])]) fn(value, thinkingCtx); };
  const round = (id, thinking, stopReason = 'toolUse') => ({ role: 'assistant', stopReason, content: [
    { type: 'thinking', thinking },
    { type: 'toolCall', id, name: 'read', arguments: {} },
  ] });
  const paint = card => stripAnsi(card.render(120).join(String.fromCharCode(10)));
  try {
    emitThinking('session_start');
    // Streaming segment 1: one row, label flows with the newest line.
    const first = round('call-1', 'Segment one');
    const firstCard = new core.AssistantMessageComponent(first, true);
    cards.push(firstCard);
    emitThinking('message_start', { message: first });
    thinkingCtx.ui.setHiddenThinkingLabel();
    assert.match(paint(firstCard), /Thinking · Segment one/);
    assert.equal(firstCard.render(120).length, 2, 'the running phase keeps a single row');

    const grown = round('call-1', 'Segment one' + String.fromCharCode(10) + 'Considering the failure path');
    emitThinking('message_update', { message: grown });
    firstCard.updateContent(grown, true);
    thinkingCtx.ui.setHiddenThinkingLabel();
    assert.match(paint(firstCard), /Thinking · Considering the failure path/, 'the row follows the newest recorded line');
    assert.equal(firstCard.render(120).length, 2, 'growth does not open the pane');

    // A long or wide line keeps its newest columns and stays on one row.
    const wide = round('call-1', '思考'.repeat(80) + 'TAIL_CONCLUSION');
    emitThinking('message_update', { message: wide });
    firstCard.updateContent(wide, true);
    thinkingCtx.ui.setHiddenThinkingLabel();
    assert.match(paint(firstCard), /TAIL_CONCLUSION/, 'the row keeps the newest recorded columns');
    assert.equal(firstCard.render(120).length, 2, 'a long line does not open the pane');

    // Segment 2 of the same phase: no fold, no reopen.
    emitThinking('message_end', { message: wide });
    const second = round('call-2', 'Second segment reasoning');
    const secondCard = new core.AssistantMessageComponent(second, true);
    cards.push(secondCard);
    emitThinking('message_start', { message: second });
    thinkingCtx.ui.setHiddenThinkingLabel();
    assert.match(paint(secondCard), /Thinking · Second segment reasoning/, 'the next segment continues in the same row');
    assert.equal(secondCard.render(120).length, 2, 'a new segment never reopens the pane');
    assert.equal(firstCard.render(120).length, 0, 'earlier segments stay folded');

    // The next action ends the phase: the row folds to its recorded summary.
    emitThinking('tool_execution_start', { toolCallId: 'call-2', toolName: 'read' });
    const folded = paint(secondCard);
    assert.match(folded, /Thinking · 2 rounds/, 'the whole phase folds when the next action starts');
    assert.doesNotMatch(folded, /Second segment reasoning/);
    assert.equal(secondCard.render(120).length, 2, 'a finished phase keeps one row');

    // Follow off keeps the recorded label even while thinking streams.
    thinkingFollow.setEnabled(false);
    const third = round('call-3', 'Third segment reasoning');
    const thirdCard = new core.AssistantMessageComponent(third, true);
    cards.push(thirdCard);
    emitThinking('message_start', { message: third });
    thinkingCtx.ui.setHiddenThinkingLabel();
    assert.doesNotMatch(paint(thirdCard), /Third segment reasoning/, 'follow off does not stream the label');
  } finally {
    stop(); thinkingMode.dispose(); thinkingFollow.dispose();
  }
}

console.log("Follow display: fixed-height live window, deferred fold, follow off, manual pin and a flowing thinking row passed");
