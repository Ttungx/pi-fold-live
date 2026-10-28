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
  // 1. The running action opens with its recorded output; the previous one folds.
  const first = start('live-one', 'FIRST_LIVE_OUTPUT');
  assert.ok(body(first) > 1, 'the running action is open');
  assert.match(plain(first), /FIRST_LIVE_OUTPUT/, 'the running action shows its recorded output');

  const second = start('live-two', 'SECOND_LIVE_OUTPUT');
  assert.doesNotMatch(plain(first), /FIRST_LIVE_OUTPUT/, 'the previous action folds when the next one starts');
  assert.doesNotMatch(plain(first), /Enter collapse|more ↓/, 'the folded action shows no pane controls');
  assert.match(plain(second), /SECOND_LIVE_OUTPUT/, 'the newest action follows');

  complete('live-one', first, 'FIRST_LIVE_OUTPUT');
  assert.equal(body(first), 1, 'a finished action stays folded');
  complete('live-two', second, 'SECOND_LIVE_OUTPUT');
  assert.equal(body(second), 0, 'a later group member adds no rows of its own');
  assert.match(plain(first), /2 actions/, 'finished actions fold into one group row');
  assert.doesNotMatch(plain(first), /FIRST_LIVE_OUTPUT|SECOND_LIVE_OUTPUT/);

  // 2. Follow off restores the native single-row activity display.
  follow.setEnabled(false);
  const off = start('follow-off', 'FOLLOW_OFF_OUTPUT');
  assert.doesNotMatch(plain(off), /FOLLOW_OFF_OUTPUT/, 'follow off keeps the running action folded');
  follow.setEnabled(true);
  assert.match(plain(off), /FOLLOW_OFF_OUTPUT/, 'follow on reopens the action that is still running');

  // 3. A manual open outranks follow and survives the next action.
  const manual = start('manual-row', 'MANUAL_OUTPUT');
  manual.setExpanded(true);
  assert.match(plain(manual), /MANUAL_OUTPUT/);
  const next = start('manual-next', 'NEXT_OUTPUT');
  assert.match(plain(manual), /MANUAL_OUTPUT/, 'Pi Ctrl+O expansion outranks follow');
  const lines = manual.render(120);
  manual.handleMouse({ type: 'click', button: 'left', x: 2, y: 2, screenX: 2, screenY: 2, width: 120, height: lines.length, shift: false, alt: false, ctrl: false });
  assert.doesNotMatch(plain(manual), /MANUAL_OUTPUT/, 'a header click still closes it');
  assert.match(plain(next), /NEXT_OUTPUT/, 'the newest action still follows');
} finally {
  dispose(); mode.dispose(); follow.dispose();
}

// 4. Thinking follows the same rule inside its own adapter.
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
  emitThinking('session_start');
  const round = n => ({ role: 'assistant', stopReason: 'toolUse', content: [
    { type: 'thinking', thinking: `LIVE_THINKING_BODY_${n}` },
    { type: 'toolCall', id: `call-${n}`, name: 'read', arguments: {} },
  ] });
  try {
    const firstMessage = round(1), firstCard = new core.AssistantMessageComponent(firstMessage, true);
    cards.push(firstCard);
    emitThinking('message_start', { message: firstMessage });
    thinkingCtx.ui.setHiddenThinkingLabel();
    assert.match(stripAnsi(firstCard.render(120).join('\n')), /LIVE_THINKING_BODY_1/, 'the streaming thinking round opens');

    const secondMessage = round(2), secondCard = new core.AssistantMessageComponent(secondMessage, true);
    cards.push(secondCard);
    emitThinking('message_start', { message: secondMessage });
    thinkingCtx.ui.setHiddenThinkingLabel();
    secondCard.render(120);
    assert.doesNotMatch(stripAnsi(firstCard.render(120).join('\n')), /LIVE_THINKING_BODY_1/, 'the previous thinking round folds');
    assert.match(stripAnsi(secondCard.render(120).join('\n')), /LIVE_THINKING_BODY_2/, 'the newest thinking round follows');

    thinkingFollow.setEnabled(false);
    assert.doesNotMatch(stripAnsi(secondCard.render(120).join('\n')), /LIVE_THINKING_BODY_2/, 'follow off folds the live thinking round');
  } finally {
    stop(); thinkingMode.dispose(); thinkingFollow.dispose();
  }
}

console.log('Follow display: live action open, previous folded, finished folded, follow off, manual override, thinking lifecycle passed');
