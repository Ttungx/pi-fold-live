#!/usr/bin/env node
// Ablation probe: measure one build (repo root) of the extension.
// Usage: node scripts/ablation.mjs <repo-root> <arm>
//   arms: upstream | A | A+tools | A+thinking | A+both | v1
// Prints one JSON line so several builds can be compared side by side.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [rootArg, arm = 'A+both'] = process.argv.slice(2);
if (!rootArg) throw new Error('usage: ablation.mjs <repo-root> [arm]');
const root = path.resolve(rootArg);
const load = file => import(pathToFileURL(path.join(root, 'tests/test-runtime.mjs')).href);
const { loadSource, core, themeModule, stripAnsi, backgroundCells } = await load();
const { createDisplayMode } = await loadSource('./display-mode.ts');
const { renderFinalReply } = await loadSource('./work-strip-view.ts');
const { registerModernTools } = await loadSource('./modern-tools.ts');
const { registerModernThinking } = await loadSource('./modern-thinking.ts');
const { ToolExecutionComponent } = await import(pathToFileURL(path.join(root, 'node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/tool-execution.js')).href);
const { createShellRenderers } = await import(pathToFileURL(path.join(root, 'node_modules/@earendil-works/pi-coding-agent/dist/core/tools/renderers/bash.js')).href);

const WIDTH = 100;
const plain = component => stripAnsi(component.render(WIDTH).join('\n'));
const rows = component => component.render(WIDTH).length;
const fillCells = line => backgroundCells(line.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, ''));
const withFollow = arm !== 'upstream' && arm !== 'A';
const thinkingFollow = arm === 'A+thinking' || arm === 'A+both' || arm === 'v1';
const toolsFollow = arm === 'A+tools' || arm === 'A+both' || arm === 'v1';

// ---------- 1. Final reply surface ----------
const replyMessage = { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'FINAL **bold** paragraph.\n\nSecond paragraph with `code`.\n\n- one\n- two' }] };
const replyCard = new core.AssistantMessageComponent(replyMessage, true);
const nativeReplyRows = replyCard.render(WIDTH);
const projectedReplyRows = renderFinalReply(replyCard, WIDTH, themeModule.theme);
const cardToken = fillCells(themeModule.theme.bg('toolPendingBg', ' '))[0];
const bodyRows = lines => lines.filter(line => stripAnsi(line).trim()).length;
const reply = {
  projectedRows: projectedReplyRows.length,
  nativeRows: nativeReplyRows.length,
  addedRows: projectedReplyRows.length - nativeReplyRows.length,
  bodyRows: bodyRows(projectedReplyRows),
  byteIdentical: JSON.stringify(projectedReplyRows) === JSON.stringify(nativeReplyRows),
  filledRows: projectedReplyRows.filter(line => fillCells(line).includes(cardToken)).length,
  filledCells: projectedReplyRows.reduce((total, line) => total + fillCells(line).filter(cell => cell === cardToken).length, 0),
};

// ---------- shared session harness ----------
function session({ tools, thinking }) {
  const hooks = new Map(), resolver = { current: undefined }, terminal = new Set();
  const subscribe = (map, name, fn) => { const list = map.get(name) || []; list.push(fn); map.set(name, list); return () => map.set(name, list.filter(item => item !== fn)); };
  const pi = {
    registerToolRenderer(fn) { resolver.current = fn; },
    registerCommand() {},
    on: (name, fn) => subscribe(hooks, name, fn),
    events: { on: () => () => {}, emit() {} },
  };
  const mode = createDisplayMode();
  const follow = createDisplayMode();
  const off = [];
  if (tools) off.push(registerModernTools(pi, mode, { follow: toolsFollow && withFollow ? follow : undefined }));
  if (thinking) {
    const ctx = {
      mode: 'tui', hasUI: true, sessionManager: core.SessionManager.inMemory('/ablation'),
      ui: { theme: themeModule.theme, setHiddenThinkingLabel() { for (const card of cards) card.setHiddenThinkingLabel('Thinking...'); }, onTerminalInput: fn => { terminal.add(fn); return () => terminal.delete(fn); } },
    };
    const cards = [];
    off.push(registerModernThinking(pi, mode, thinkingFollow && withFollow ? follow : undefined));
    const emit = (name, value = {}) => { for (const fn of [...(hooks.get(name) || [])]) fn(value, ctx); };
    emit('session_start');
    return { pi, mode, follow, resolver, cards, emit, ctx, stop: () => off.forEach(fn => fn?.()) };
  }
  const ctx = { hasUI: true, sessionManager: { getBranch: () => [] }, ui: { onTerminalInput: fn => { terminal.add(fn); return () => terminal.delete(fn); } } };
  const emit = (name, value = {}) => { for (const fn of [...(hooks.get(name) || [])]) fn(value, ctx); };
  emit('session_start');
  return { pi, mode, follow, resolver, emit, ctx, stop: () => off.forEach(fn => fn?.()) };
}

// ---------- 2. Thinking: three segments in one phase, then the next action ----------
const thinkingMetrics = (() => {
  if (arm === 'A+tools') return { skipped: 'thinking follow disabled' };
  const s = session({ thinking: true });
  const round = (id, thinking) => ({ role: 'assistant', stopReason: 'toolUse', content: [{ type: 'thinking', thinking }, { type: 'toolCall', id, name: 'read', arguments: {} }] });
  const frames = [];
  const paint = card => {
    const text = plain(card), count = rows(card);
    const segment = (text.match(/TAIL_(\d)/) || [, '?'])[1];
    frames.push({ rows: count, body: text.includes('BODY_MARK'), tail: /TAIL_\d/.test(text), title: (text.match(/Thinking ·[^\n]*/) || [''])[0].trim() });
    return { text, count, segment };
  };
  try {
    for (const n of [1, 2, 3]) {
      const message = round(`call-${n}`, `BODY_MARK_${n}\nthinking line ${n}\nTAIL_${n}`);
      const card = new core.AssistantMessageComponent(message, true);
      s.cards.push(card);
      s.emit('message_start', { message });
      s.ctx.ui.setHiddenThinkingLabel();
      paint(card);
      s.emit('message_end', { message });
      paint(card);
    }
    s.emit('tool_execution_start', { toolCallId: 'call-3', toolName: 'read' });
    paint(s.cards.at(-1));
  } finally { s.stop(); s.mode.dispose(); s.follow.dispose(); }
  const titles = [...new Set(frames.map(frame => frame.title).filter(Boolean))];
  return {
    frames: frames.length,
    maxRows: Math.max(...frames.map(frame => frame.rows)),
    bodyVisibleFrames: frames.filter(frame => frame.body).length,
    tailVisibleFrames: frames.filter(frame => frame.tail).length,
    distinctTitles: titles.length,
    tailTitles: titles.filter(title => /TAIL_\d/.test(title)).length,
    // The user-visible artifact: the row opening and closing between segments.
    heightChanges: frames.slice(1).filter((frame, index) => frame.rows !== frames[index].rows).length,
    rowsPerSegment: frames.map(frame => frame.rows).join(''),
  };
})();

// ---------- 3. Tools: three actions, one at a time ----------
const toolMetrics = (() => {
  if (arm === 'A+thinking') return { skipped: 'tool follow disabled' };
  const s = session({ tools: true });
  const make = (id, output) => {
    const args = { command: `run ${id}` };
    const renderer = s.resolver.current('bash', () => createShellRenderers('$'));
    const component = new ToolExecutionComponent('bash', id, args, { showImages: false, outputPad: 0 }, renderer, { requestRender() {} }, '/tmp');
    component.setArgsComplete();
    s.emit('tool_execution_start', { toolCallId: id, toolName: 'bash', args });
    component.markExecutionStarted();
    component.updateResult({ content: [{ type: 'text', text: output }], details: {}, isError: false }, true);
    return component;
  };
  const frames = [];
  // An open pane starts its header with the disclosure glyph; a closed one does not.
  const record = (label, component) => { const text = plain(component); frames.push({ label, rows: rows(component), open: /▾/.test(text), output: /OUT_\d/.test(text) }); };
  const pick = (prefix) => frames.filter(frame => frame.label.startsWith(prefix));
  try {
    const one = make('one', 'OUT_1'); record('live-1', one);
    const two = make('two', 'OUT_2'); record('live-2', two); record('prev-2', one);
    const three = make('three', 'OUT_3'); record('live-3', three); record('prev-3', two); record('prev-3a', one);
    for (const [index, component] of [one, two, three].entries()) {
      component.updateResult({ content: [{ type: 'text', text: `OUT_${index + 1}` }], details: { exitCode: 0 }, isError: false }, false);
      s.emit('tool_execution_end', { toolCallId: ['one', 'two', 'three'][index], toolName: 'bash', result: { content: [], details: {} }, isError: false });
    }
    record('finished-1', one); record('finished-2', two); record('finished-3', three);
  } finally { s.stop(); s.mode.dispose(); s.follow.dispose(); }
  return {
    frames: frames.length,
    liveRows: pick('live-').map(frame => frame.rows).join(''),
    liveOpen: pick('live-').filter(frame => frame.open).length,
    liveOutput: pick('live-').filter(frame => frame.output).length,
    previousRows: pick('prev-').map(frame => frame.rows).join(''),
    previousOpen: pick('prev-').filter(frame => frame.open).length,
    previousOutput: pick('prev-').filter(frame => frame.output).length,
    finishedRows: pick('finished-').map(frame => frame.rows).join(''),
    finishedOpen: pick('finished-').filter(frame => frame.open).length,
  };
})();

// ---------- 4. Render cost of each change ----------
const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
const cost = (() => {
  // Vary the width so the native Markdown cache cannot answer for the measurement.
  const time = fn => {
    const samples = [];
    for (let n = 0; n < 140; n++) {
      const width = WIDTH + (n % 9);
      const start = process.hrtime.bigint();
      fn(width);
      samples.push(Number(process.hrtime.bigint() - start) / 1e6);
    }
    return Number(median(samples.slice(20)).toFixed(3));
  };
  const reply = time(width => renderFinalReply(replyCard, width, themeModule.theme));
  const native = time(width => replyCard.render(width));
  return { finalReplyMs: reply, nativeReplyMs: native, overheadMs: Number((reply - native).toFixed(3)) };
})();

console.log(JSON.stringify({ arm, root, reply, thinking: thinkingMetrics, tools: toolMetrics, cost }));
