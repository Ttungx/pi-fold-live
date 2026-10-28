import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync, writeFileSync } from 'node:fs';
import { loadSource, loadAgent, tui, themeModule, stripAnsi, core, runtime, assertCardBackground, backgroundCells } from './test-runtime.mjs';
const { cardRow, activityHeading } = await loadSource('./display-card.ts');
const headingTheme = { fg: (tone, text) => `<${tone}>${text}</${tone}>`, bold: text => `<bold>${text}</bold>` };
assert.equal(activityHeading('▸ 4 actions · Read files · 2s', headingTheme), '<mdLink>▸ 4 actions</mdLink><muted> · Read files · 2s</muted>');
assert.equal(activityHeading('▸ read', headingTheme), '<mdLink>▸ read</mdLink>');
for (const tone of ['accent', 'customMessageLabel', 'error', 'warning']) assert.equal(activityHeading('▸ Decision · recorded', headingTheme, tone), `<${tone}><bold>▸ Decision · recorded</bold></${tone}>`);
for (const width of [1, 2, 8, 30]) assertCardBackground([cardRow('a\x1b[0mb\x1b[49mc\x1b[38;2;0;49;0md', width, themeModule.theme, 'toolSuccessBg')], width, 'toolSuccessBg');
const nested = cardRow('a\x1b[48;5;0mb\x1b[49mc', 12, themeModule.theme, 'toolSuccessBg');
assert.equal(backgroundCells(nested)[2], '48;5;0', 'an explicit nested surface stays intact');
assert.equal(backgroundCells(nested)[3], backgroundCells(nested)[0], 'base surface resumes after a nested background reset');
const { registerModernTools, toolStatus, toolLabel, isNativeSubagent } = await loadSource('./modern-tools.ts');
const { ToolPane, textRows } = await loadSource('./modern-tool-pane.ts');
const { recordedValues } = await loadSource('./modern-tool-content.ts');
const { ToolExecutionComponent } = await loadAgent('modes/interactive/components/tool-execution.js');
const { createShellRenderers } = await loadAgent('core/tools/renderers/bash.js');
const { readRenderers } = await loadAgent('core/tools/renderers/read.js');
const { codemodeRenderers } = await loadAgent('extensions/codemode/renderer.js');
const hooks = new Map();
const bus = new Map();
let resolver, input, enabled = true, modeChange, redraws = 0;
const pi = {
  registerToolRenderer(fn) { resolver = fn; },
  on(name, fn) { const list = hooks.get(name) || []; list.push(fn); hooks.set(name, list); return () => hooks.set(name, (hooks.get(name) || []).filter(item => item !== fn)); },
  events: { on(name, fn) { bus.set(name, fn); return () => bus.delete(name); }, emit(name, value) { bus.get(name)?.(value); } },
};
const mode = { isEnabled: () => enabled, onChange(fn) { modeChange = fn; return () => { modeChange = undefined; }; } };
const dispose = registerModernTools(pi, mode);
const ctx = { hasUI: true, sessionManager: { getBranch: () => [] }, ui: { onTerminalInput(fn) { input = fn; return () => { input = undefined; }; } } };
const event = (name, value = {}) => { for (const fn of [...(hooks.get(name) || [])]) fn(value, ctx); };
const toggle = (value) => { enabled = value; modeChange(); };
event('session_start');
const native = new Map([['bash', createShellRenderers('$')], ['read', readRenderers], ['codemode', codemodeRenderers]]);
const stockCalls = [];
const make = (name, id, args) => {
  const original = native.get(name) || { renderCall: () => new tui.Text('native call', 0, 0), renderResult: () => new tui.Text('native result', 0, 0) };
  const renderer = resolver(name, () => original);
  const wrapped = { ...renderer,
    renderCall(...args) { const result = renderer.renderCall(...args); stockCalls.push(result); return result; },
    renderResult(...args) { return renderer.renderResult(...args); },
  };
  const component = new ToolExecutionComponent(name, id, args, { showImages: false, outputPad: 0 }, wrapped, { requestRender() { redraws++; assert.ok(redraws < 1000, 'bounded native redraw'); } }, '/tmp');
  component.setArgsComplete();
  return component;
};
const paint = (component, width = 120) => stripAnsi(component.render(width).join('\n'));
const result = (text, details = {}) => ({ content: [{ type: 'text', text }], details });
const evidence = [];
const capture = (label, component) => { const lines = component.render(120); evidence.push({ label, width: 120, lines, plain: lines.map(stripAnsi) }); };
const read = make('read', 'a', { path: '/tmp/first.txt' });
read.markExecutionStarted(); read.updateResult(result('first output'));
capture('Single successful action collapsed', read);
assert.match(read.render(120).map(stripAnsi)[1], /^ ▸ read · /, 'tool name starts after the common disclosure column');
const clickSingle = (component, y) => {
  const lines = component.render(120);
  return component.handleMouse({ type: 'click', button: 'left', x: 2, y, screenX: 2, screenY: y, width: 120, height: lines.length, shift: false, alt: false, ctrl: false });
};
clickSingle(read, 1);
assert.match(paint(read), /first output/, 'one header click reveals singleton details');
assert.doesNotMatch(paint(read), /1\. read|Arguments|\{\}/, 'singleton shows content before exact arguments');
assert.match(paint(read), /▸ Details/);
clickSingle(read, 3); assert.match(paint(read), /Arguments/);
clickSingle(read, 3);
capture('Single successful action opened by header click', read);
clickSingle(read, 1);
assert.doesNotMatch(paint(read), /first output/);
read.setExpanded(true);
assert.match(paint(read), /first output/, 'native expansion opens singleton details directly');
read.setExpanded(false);
const inspectRead = [];
pi.events.emit('compact-renderer:inspect:v1', { add: entry => inspectRead.push(entry) });
inspectRead[0].focus();
assert.match(paint(read), /first output/, 'inspection focus opens singleton details directly');
assertCardBackground([read.render(100)[1]], 100, 'selectedBg');
assert.match(paint(read), /Enter collapse/);
capture('Single successful action focused through inspection', read);
input('\r'); assert.doesNotMatch(paint(read), /first output/, 'Enter collapses a focused singleton');
input('\r'); assert.match(paint(read), /first output/, 'Enter opens a focused singleton in one step');
input('\x1b'); clickSingle(read, 1);
const shell = make('bash', 'b', { command: 'printf hello' }); shell.markExecutionStarted(); shell.updateResult(result('streaming'), true);
assert.match(paint(read), /read · \/tmp\/first\.txt/);
assert.match(paint(shell), /Running/);
assert.equal(read.render(100).length, 2, 'collapsed activity uses one summary plus native spacer');
const assertNeutral = rows => { for (const row of rows) assert.ok(backgroundCells(row).every(value => value === ''), 'compact activity keeps terminal surface'); };
assertNeutral(read.render(100));
assertNeutral(shell.render(100));
assert.ok(shell.render(100)[1].includes(themeModule.theme.getFgAnsi('mdLink')), 'ordinary running action heading uses native blue');
assert.ok(shell.render(100)[1].includes(themeModule.theme.getFgAnsi('muted')), 'running intent and metadata use muted text');
assert.doesNotMatch(paint(read), /Alt\+G/, 'unfocused collapsed cards omit repeated key hints');
shell.updateResult(result('hello', { exitCode: 0 }));
assert.match(paint(read), /2 actions/);
assert.ok(read.render(100)[1].includes(themeModule.theme.getFgAnsi('mdLink')), 'completed action group heading uses native blue');
assert.ok(read.render(100)[1].includes(themeModule.theme.getFgAnsi('muted')), 'group intent uses muted text');
assert.equal(paint(shell), '');
assert.equal(input('\x1b[A'), undefined, 'editor arrows remain untouched until pane focus');
assert.equal(input('\x1bg').consume, true);
assert.match(paint(read), /first.txt/);
const focusedAction = read.render(100).find(row => stripAnsi(row).includes('1. read'));
assertCardBackground([focusedAction], 100, 'selectedBg');
assert.ok(focusedAction.includes(themeModule.theme.getFgAnsi('accent')), 'selection has a clear native foreground');
input('\r');
assert.doesNotMatch(paint(read), /Arguments/);
input('\t'); input('\r'); input('\t');
assert.match(paint(read), /Arguments/);
assert.match(paint(read), /first output/);
assert.doesNotMatch(paint(read), /arguments \(object\)|arguments\.path|\(string\)/, 'recorded values use local field labels');
const detailLayout = read.render(100).map(stripAnsi);
assert.match(detailLayout[1], /^ ▾ /, 'header uses the native one-cell gutter');
assert.match(detailLayout.find(row => row.includes('1. read')), /^   › ▾ /, 'actions sit inside the group heading');
assert.equal(detailLayout.find(row => row.includes('first output')).indexOf('first output'), detailLayout.find(row => row.includes('1. read')).indexOf('read'), 'recorded output aligns with the expanded action label');
assert.match(detailLayout.at(-1), /^ ←\/→ action/, 'focused hint shares the header gutter');
assertCardBackground([read.render(100)[1]], 100, 'selectedBg');
assert.ok(detailLayout.findIndex(row => row.includes('first output')) < detailLayout.findIndex(row => row.trim() === 'Arguments'), 'output appears before arguments');
assert.doesNotMatch(detailLayout.join('\n'), /c collapse/);
input('\x1b[C'); input('\r');
input('\t'); input('\r'); input('\t');
assert.match(paint(read), /printf hello/);
assert.match(paint(read), /hello/);
input('\x1b[D');
assert.match(paint(read), /first output/, 'first action remains expanded');
input('\x1b'); assert.equal(input('\x1b[B'), undefined);
assertNeutral(read.render(100));
assert.doesNotMatch(paint(read), /Enter details|Alt\+G|to inspect/, 'unfocused open cards omit keyboard hints');
// Mode changes synchronously rerender the actual native component and preserve slot ownership.
for (let iteration = 0; iteration < 8; iteration++) {
  toggle(false);
  assert.match(paint(shell), /\$ printf hello/);
  assert.match(paint(shell), /hello/);
  read.setExpanded(true);
  assert.match(paint(read), /first output/);
  assert.equal(read.callRendererComponent.constructor.name, 'Box');
  assert.deepEqual(read.callRendererComponent.children.map(child => child.constructor.name), ['Text', 'Text']);
  assert.deepEqual(shell.callRendererComponent.children.map(child => child.constructor.name), ['Text', 'Container']);
  assert.equal(shell.resultRendererComponent.render(120).length, 0, 'one Box owns both stock render slots');
  toggle(true);
  assert.match(paint(read), /2 actions/);
}
// Mode off reproduces the full default native shell, including ANSI backgrounds and padding.
toggle(false);
const actualNow = Date.now; Date.now = () => 100000;
try {
  for (const outputPad of [0, 1, 3]) for (const name of ['bash', 'read', 'native-generic', 'subagent', 'subagent_supervisor', 'contact_supervisor']) {
    const args = name === 'bash' ? { command: 'printf safe' } : { path: '/tmp/shell-fixture' };
    const originalDefinition = native.get(name) || {};
    const wrappedDefinition = resolver(name, () => originalDefinition);
    const create = (definition, id) => new ToolExecutionComponent(name, id, args, { showImages: false, outputPad }, definition, { requestRender() {} }, '/tmp');
    const original = create(originalDefinition, `appearance-original-${name}-${outputPad}`);
    const wrapped = create(wrappedDefinition, `appearance-wrapped-${name}-${outputPad}`);
    try {
      original.markExecutionStarted(); wrapped.markExecutionStarted();
      for (const phase of ['running', 'completed', 'error']) {
        const final = { ...result(`native ${phase} output`), isError: phase === 'error', durationMs: phase === 'running' ? undefined : 500 };
        original.updateResult(final, phase === 'running'); wrapped.updateResult(final, phase === 'running');
        for (const expanded of [false, true]) {
          original.setExpanded(expanded); wrapped.setExpanded(expanded);
          for (const width of [20, 90]) assert.deepEqual(wrapped.render(width), original.render(width), `${name}/${phase}/pad=${outputPad}/expanded=${expanded}/width=${width}`);
          const background = phase === 'running' ? 'toolPendingBg' : phase === 'error' ? 'toolErrorBg' : 'toolSuccessBg';
          assert.ok(wrapped.render(90).some(line => line.includes(themeModule.theme.getBgAnsi(background))), 'effective native background ANSI is retained');
        }
      }
    } finally { original.updateResult(result('final cleanup')); wrapped.updateResult(result('final cleanup')); }
  }
  // Tools that frame themselves keep their existing renderShell semantics.
  const selfStock = { renderShell: 'self', renderCall: () => new tui.Text('own call', 0, 0), renderResult: () => new tui.Text('own result', 0, 0) };
  const selfOriginal = new ToolExecutionComponent('self-tool', 'self-original', {}, { outputPad: 3, showImages: false }, selfStock, { requestRender() {} }, '/tmp');
  const selfWrapped = new ToolExecutionComponent('self-tool', 'self-wrapped', {}, { outputPad: 3, showImages: false }, resolver('self-tool', () => selfStock), { requestRender() {} }, '/tmp');
  selfOriginal.updateResult(result('own')); selfWrapped.updateResult(result('own'));
  assert.deepEqual(selfWrapped.render(80), selfOriginal.render(80));
} finally { Date.now = actualNow; toggle(true); }
// A failed row remains conspicuous and breaks adjacent success groups.
const fail = make('bash', 'c', { command: 'false' });
fail.updateResult({ ...result('failure', { exitCode: 1 }), isError: true });
const after = make('read', 'd', { path: '/tmp/after.txt' }); after.updateResult(result('after'));
assert.match(paint(fail), /bash · false · ✗ Failed/); assert.match(paint(after), /read · \/tmp\/after\.txt/);
assert.equal(paint(fail).split('\n').filter(line => line.includes('bash · false')).length, 1, 'failure uses one exceptional header');
assert.match(paint(fail), /Failed · Command failed \(exit 1\)/, 'header includes a bounded recorded failure excerpt');
assert.match(fail.render(120).map(stripAnsi)[1], /^ ▸ bash · /, 'failure status does not shift the tool name');
capture('Single failed action collapsed with status after command', fail);
const failedHeader = fail.render(120).find(line => stripAnsi(line).includes('Failed'));
assert.ok(failedHeader.includes(themeModule.theme.getFgAnsi('error')), 'failed header uses native error color');
assertNeutral([failedHeader]);
const partialFailureOutput = 'partial failure output\nexact second failure line';
fail.updateResult({ ...result(partialFailureOutput, { error: 'Recorded denial: ' + 'x'.repeat(5000) }), isError: true }, true);
assert.match(paint(fail), /Failed · Command failed/, 'partial errors remain visible as exceptional cards');
assert.equal(paint(fail).split('\n').filter(line => line.includes('bash · false')).length, 1);
assert.ok(paint(fail, 500).split('\n').map(row => row.trim()).join('').length < 400, 'collapsed failure reason has a bounded length before the full-width card gutter');
const failureMouse = (y) => fail.handleMouse({ type: 'click', button: 'left', x: 2, y, screenX: 2, screenY: y, width: 120, height: fail.render(120).length, shift: false, alt: false, ctrl: false });
failureMouse(1); failureMouse(2);
assert.match(paint(fail), /partial failure output/);
assert.match(paint(fail), /exact second failure line/, 'full recorded failure output remains inline');
assert.doesNotMatch(paint(fail), /1\. bash/, 'failed action opens without a numbered duplicate');
capture('Single failed action opened directly', fail);
input('\x1b');
assert.equal(toolStatus('read', result('Error is a word in successful recorded output')).status, 'success', 'prose never determines failure status');
// Visible transcript boundaries and native Fleet control presentation.
event('message_end', { message: { role: 'user', content: 'next task' } });
const next = make('read', 'e', { path: '/tmp/next.txt' }); next.updateResult(result('next'));
assert.match(paint(next), /read · \/tmp\/next\.txt/);
for (const name of ['fleet_status', 'mcp__fleet_status']) {
  assert.equal(isNativeSubagent(name), true);
  const stock = {}; assert.equal(resolver(name, () => stock), stock);
}
for (const name of ['subagent', 'subagent_message', 'subagents', 'subagent_supervisor']) {
  assert.equal(isNativeSubagent(name), true);
  const stock = {}; assert.notEqual(resolver(name, () => stock), stock, 'subagent TOOL transcripts use compact rows');
}
assert.equal(toolStatus('bash', result('error'), true, true).status, 'failed', 'partial errors remain failed');
for (const status of ['started', 'running', 'unavailable', 'cancelled']) assert.notEqual(toolStatus('custom', result('notice', { status })).status, 'success');
for (const status of ['cancelled', 'unavailable']) assert.equal(toolStatus('ask_user_question', result('', { status })).status, status);
assert.equal(toolStatus('ask_user_question', result('', { status: 'answered', answers: [] })).status, 'unanswered');
const ask = make('ask_user_question', 'q', { question: 'Which host?' });
assert.match(paint(ask), /Question · Pending · Which host/);
assert.match(ask.render(120).map(stripAnsi)[1], /^ ▸ Question · /, 'question heading aligns with ordinary action headings');
const assertDecision = (component, width = 100, focused = false) => {
  const rows = component.render(width).slice(1);
  if (focused) assertCardBackground([rows[0]], width, 'selectedBg');
  else assertNeutral([rows[0]]);
  assert.ok(rows[0].includes(themeModule.theme.getFgAnsi('accent')), 'question heading uses the native purple accent');
  for (const row of rows) assert.doesNotMatch(stripAnsi(row), /^│/, 'question has no decorative rail');
  assertNeutral(rows.slice(1));
};
assertDecision(ask);
assert.ok(ask.render(100)[1].includes(themeModule.theme.getFgAnsi('accent')), 'question heading uses purple accent');
assert.notEqual(themeModule.theme.getFgAnsi('accent'), themeModule.theme.getFgAnsi('mdLink'), 'questions and actions have distinct native tones');
capture('Question pending with aligned purple heading', ask);
ask.updateResult(result('User answered: Laptop', { question: 'Which host?', status: 'answered', answers: [{ label: 'Laptop', value: 'local' }] }));
assert.match(paint(ask), /Question · Answered · Which host\? · Laptop/);
assertDecision(ask);
assert.equal((paint(ask).match(/Question ·/g) || []).length, 1);
ask.setExpanded(true);
assert.match(paint(ask), /✓ Laptop/);
assert.equal((paint(ask).match(/Which host\?/g) || []).length, 1, 'expanded question shows its prompt once');
assert.equal((paint(ask).match(/Laptop/g) || []).length, 1, 'expanded question shows its answer once');
assert.doesNotMatch(paint(ask), /^ +(?:Question|Options|Answer)\s*$/m);
assert.doesNotMatch(paint(ask), /1\. ask_user_question/);
capture('Answered question opened directly with readable answer', ask);
ask.setExpanded(false);
for (const [status, expected, isError] of [['unavailable', 'Unavailable', false], ['cancelled', 'Cancelled', false], ['answered', 'Unanswered', false], ['failed', 'Failed', true]]) {
  ask.updateResult({ ...result('No recorded answer', { question: 'Which host?', status, answers: [] }), isError });
  assert.match(paint(ask), new RegExp(`Question · ${expected}`));
  assert.doesNotMatch(paint(ask), /Laptop/, 'prior answers cannot leak into a later unresolved interaction');
  ask.setExpanded(true);
  assert.equal((paint(ask).match(new RegExp(expected, 'g')) || []).length, 1, 'unresolved state appears in the header once');
  assert.doesNotMatch(paint(ask), /✓|^ +Answer\s*$/m, 'unresolved states cannot imply a recorded answer');
  assert.doesNotMatch(paint(ask), /Laptop|Arguments|Details|Output/);
  assert.match(paint(ask), /No recorded answer/, 'unresolved question retains its readable recorded message');
  ask.setExpanded(false);
}
ask.updateResult(result('unnecessary raw output', { status: 'unavailable', question: 'Which host?', message: 'Question UI is unavailable in this session.' }));
ask.setExpanded(true);
assert.match(paint(ask), /Question UI is unavailable in this session/);
assert.doesNotMatch(paint(ask), /unnecessary raw output|Arguments|Details|Output/);
ask.setExpanded(false);
const detailedArgs = { question: 'Choose a host?', details: 'Use the machine that owns the checkout.', options: [
  { label: 'Laptop (Recommended)', value: 'local', description: 'Use the local checkout.' },
  { label: 'Server', value: 'remote' },
] };
const detailedResult = result('User selected: 1. Laptop (Recommended)', { status: 'answered', question: detailedArgs.question, context: detailedArgs.details, mode: 'single-select', answers: [{ type: 'option', index: 1, label: 'Laptop (Recommended)', value: 'local' }] });
const detailedSource = JSON.stringify({ args: detailedArgs, result: detailedResult });
const detailedAsk = make('ask_user_question', 'q-details', detailedArgs);
detailedAsk.updateResult(detailedResult); detailedAsk.setExpanded(true);
assert.match(paint(detailedAsk), /\n +Choose a host\?/);
assert.match(paint(detailedAsk), /✓ 1\. Laptop \(Recommended\) — Use the local checkout\./);
assert.match(paint(detailedAsk), /\n +2\. Server/);
assert.doesNotMatch(paint(detailedAsk), /^ +(?:Question|Options|Answer)\s*$/m);
assert.ok(detailedAsk.render(120).map(stripAnsi).slice(2).every(row => row.trim()), 'compact question body adds no blank section gaps');
assert.doesNotMatch(paint(detailedAsk), /1\. ask_user_question/);
capture('Detailed question with recorded options and descriptions', detailedAsk);
assert.equal((paint(detailedAsk).match(/✓ 1\. Laptop/g) || []).length, 1, 'selected option is the answer, without a duplicate answer section');
assertDecision(detailedAsk);
const questionChoices = []; pi.events.emit('compact-renderer:inspect:v1', { add: entry => questionChoices.push(entry) });
questionChoices.find(entry => entry.label.includes('Choose a host?')).focus();
assertDecision(detailedAsk, 100, true);
assert.match(paint(detailedAsk), /focused/);
input('\x1b');
assertDecision(detailedAsk);
const selectedQuestionRow = detailedAsk.render(120).find(row => stripAnsi(row).includes('✓ 1.'));
assert.ok(selectedQuestionRow.includes(themeModule.theme.getFgAnsi('success')), 'recorded selection uses native success color');
assertNeutral([selectedQuestionRow]);
// Native theme.bold can omit ANSI in a non-TTY test process. Verify the style seam explicitly.
const answerStylePane = new ToolPane([{ id: 'answer-style', label: '', sections: function* () { yield { text: '✓ 2. Beta', kind: 'answer' }; } }], 'Question');
answerStylePane.open = true;
answerStylePane.theme = Object.assign(Object.create(themeModule.theme), { bold: text => `\x1b[1m${text}\x1b[22m` });
assert.ok(answerStylePane.render(80).find(row => stripAnsi(row).includes('✓ 2. Beta')).includes('\x1b[1m'), 'answer rows request bold styling independently of keyboard focus');
capture('Detailed question with selected option inline', detailedAsk);
assert.doesNotMatch(paint(detailedAsk), /Arguments|Details|Output|mode:|value:/, 'question history omits raw duplicate records');
assert.equal(JSON.stringify({ args: detailedArgs, result: detailedResult }), detailedSource, 'question presentation preserves all stored source');
const choiceArgs = { question: 'Which option?', details: '   ', options: [
  { label: 'Alpha', value: 'a', description: 'First choice' },
  { label: 'Beta', value: 'b', description: 'Second choice' },
  { label: 'Other', value: 'other' },
] };
const choiceAsk = make('ask_user_question', 'q-choice', choiceArgs);
const updateChoice = (answers, status = 'answered', message) => {
  choiceAsk.updateResult(result(message ?? 'User selected a recorded answer', { status, question: choiceArgs.question, answers, ...(message === undefined ? {} : { message }) }));
  choiceAsk.setExpanded(true);
  return paint(choiceAsk);
};
assert.match(updateChoice([{ type: 'option', index: 2, label: 'Beta', value: 'b' }]), /✓ 2\. Beta — Second choice/);
assert.doesNotMatch(paint(choiceAsk), /✓ 1\.|✓ 3\.|User selected/);
assert.match(updateChoice([{ type: 'other', label: 'Gamma', value: 'Gamma' }]), /✓ Other: Gamma/);
assert.doesNotMatch(paint(choiceAsk), /✓ \d\./);
assert.match(updateChoice([{ type: 'other', label: 'Other', value: 'other' }]), /✓ Other: Other/);
assert.doesNotMatch(paint(choiceAsk), /✓ 3\./, 'custom Other never selects a regular option with that label or value');
assert.match(updateChoice([{ type: 'option', index: 7, label: 'Historical choice', value: 'a' }]), /✓ 7\. Historical choice/);
assert.doesNotMatch(paint(choiceAsk), /✓ 1\./, 'unmatched recorded indices remain standalone instead of selecting a conflicting value');
for (const status of ['cancelled', 'unavailable']) {
  const output = updateChoice([{ type: 'option', index: 2, label: 'Beta', value: 'b' }], status, status === 'cancelled' ? 'User cancelled the question' : 'Question UI unavailable: no terminal');
  assert.doesNotMatch(output, /✓/, 'only answered status can highlight recorded options');
  assert.equal((output.match(new RegExp(status === 'cancelled' ? 'Cancelled' : 'Unavailable', 'g')) || []).length, 1);
  if (status === 'cancelled') assert.doesNotMatch(output, /User cancelled the question/);
  else assert.match(output, /Question UI unavailable: no terminal/);
}
assert.match(updateChoice([], 'cancelled', 'User cancelled the question\nConnection closed during selection'), /Connection closed during selection/, 'nonstandard cancellation diagnostics remain intact');
choiceAsk.updateResult(result('Connection closed during selection', { status: 'cancelled', message: 'User cancelled the question', answers: [] }));
assert.match(paint(choiceAsk), /Connection closed during selection/, 'suppressing exact boilerplate still retains a separate recorded diagnostic');
const duplicateAsk = make('ask_user_question', 'q-duplicates', { question: 'Choose repeated labels', options: [
  { label: 'Same', value: 'first' }, { label: 'Same', value: 'second' }, { label: 'Final', value: 'last' },
] });
duplicateAsk.updateResult(result('', { status: 'answered', answers: [{ type: 'option', index: 2, label: 'Same', value: 'second' }, { type: 'option', label: 'Final', value: 'last' }] }));
duplicateAsk.setExpanded(true);
assert.match(paint(duplicateAsk), /✓ 2\. Same/);
assert.match(paint(duplicateAsk), /✓ 3\. Final/);
assert.doesNotMatch(paint(duplicateAsk), /✓ 1\./, 'multi-select matches recorded indices and values, not all duplicate labels');
duplicateAsk.updateResult(result('', { status: 'answered', answers: [{ type: 'option', label: 'Same', value: 'second' }] }));
assert.match(paint(duplicateAsk), /✓ 2\. Same/);
assert.doesNotMatch(paint(duplicateAsk), /✓ 1\./, 'value disambiguates duplicate labels without an index');
const normalizedArgs = { question: 'Choose a normalized option', options: [
  { label: '   ' }, { label: ' Same ', value: ' first ' }, { label: '' }, { label: ' Same ', value: ' second ', description: ' Recorded description ' },
] };
const normalizedSource = JSON.stringify(normalizedArgs);
const normalizedAsk = make('ask_user_question', 'q-normalized', normalizedArgs);
normalizedAsk.updateResult(result('User selected: 2. Same', { status: 'answered', answers: [{ type: 'option', index: 2, label: 'Same', value: 'second' }] }));
normalizedAsk.setExpanded(true);
assert.match(paint(normalizedAsk), /✓ 2\. Same — Recorded description/);
assert.doesNotMatch(paint(normalizedAsk), /✓ 1\.|3\.|4\./, 'blank options do not occupy native answer indices');
normalizedAsk.updateResult(result('', { status: 'answered', answers: [{ type: 'option', label: 'Same', value: 'second' }] }));
assert.match(paint(normalizedAsk), /✓ 2\. Same — Recorded description/);
assert.doesNotMatch(paint(normalizedAsk), /✓ 1\./, 'normalized values still disambiguate duplicate labels without an index');
assert.equal(JSON.stringify(normalizedArgs), normalizedSource, 'native option normalization leaves recorded arguments intact');
const escapedAsk = make('ask_user_question', 'q-controls', { question: 'Recorded\x1b[31m question', options: [{ label: 'Safe\x07', description: 'Literal\u202e detail' }] });
escapedAsk.updateResult(result('', { status: 'answered', answers: [{ type: 'option', index: 1, label: 'Safe\x07' }] }));
escapedAsk.setExpanded(true);
assert.match(paint(escapedAsk), /Recorded\\u001b\[31m question/);
assert.match(paint(escapedAsk), /✓ 1\. Safe\\u0007 — Literal\\u202e detail/);
assert.ok(!escapedAsk.render(120).join('\n').includes('\x1b[31m'), 'recorded ANSI cannot inject terminal formatting');
for (const width of [1, 2, 3, 4, 8, 16, 30]) {
  assert.ok(escapedAsk.render(width).every(row => tui.visibleWidth(row) <= width), `question wraps within ${width} columns`);
}
const { activityRow, cardContentWidth } = await loadSource('./display-card.ts');
for (const appearance of ['dark', 'light']) {
  themeModule.initTheme(appearance, false);
  for (const width of [1, 2, 3, 4, 8, 30]) {
    const line = themeModule.theme.fg('accent', 'Question') + '\x1b[0m' + ' 中文🙂';
    const header = activityRow(line, width, themeModule.theme, false);
    const focusedHeader = activityRow(line, width, themeModule.theme, true);
    assertNeutral([header]);
    if (width >= 2) {
      assert.doesNotMatch(stripAnsi(header), /^│/);
    }
    assertCardBackground([focusedHeader], width, 'selectedBg');
    assert.ok(tui.visibleWidth(header) <= width);
    assert.ok(tui.visibleWidth(activityRow(line, width, themeModule.theme)) <= width);
    assert.ok(cardContentWidth(width) >= 1, 'narrow decisions retain a text cell');
  }
}
themeModule.initTheme('dark', false);
const longFields = { question: 'QUESTION_START ' + 'question '.repeat(180) + 'QUESTION_END', details: 'CONTEXT_START ' + 'context '.repeat(100) + 'CONTEXT_END', options: [{ label: 'LABEL_START ' + 'label '.repeat(100) + 'LABEL_END', description: 'DESCRIPTION_START ' + 'description '.repeat(150) + 'DESCRIPTION_END' }] };
const longQuestionSource = JSON.stringify(longFields);
const longAsk = make('ask_user_question', 'q-long', longFields);
const longOther = 'OTHER_START ' + 'other '.repeat(120) + 'OTHER_END';
longAsk.updateResult(result('', { status: 'answered', answers: [{ type: 'other', label: longOther, value: longOther }] }));
longAsk.setExpanded(true);
let longQuestionPaint = '';
for (let iteration = 0; iteration < 20; iteration++) {
  const rows = longAsk.render(60);
  longQuestionPaint += rows.map(stripAnsi).join('\n');
  longAsk.handleMouse({ type: 'wheel', button: 'none', wheelDelta: 8, x: 2, y: 3, screenX: 2, screenY: 3, width: 60, height: rows.length, shift: false, alt: false, ctrl: false });
}
for (const field of ['QUESTION', 'CONTEXT', 'LABEL', 'DESCRIPTION', 'OTHER']) {
  assert.ok(longQuestionPaint.includes(`${field}_START`) && longQuestionPaint.includes(`${field}_END`), `full ${field.toLowerCase()} remains scroll-accessible`);
}
assert.equal(JSON.stringify(longFields), longQuestionSource, 'long question source remains unchanged');
let laterOptionReads = 0;
const lazyOptions = [{ label: 'Large recorded option '.repeat(100000) }];
Object.defineProperty(lazyOptions, 1, { enumerable: true, get() { laterOptionReads++; return { label: 'Later choice' }; } });
const lazyAsk = make('ask_user_question', 'q-lazy', { question: 'Which recorded option?', options: lazyOptions });
lazyAsk.updateResult(result('', { status: 'answered', answers: [{ type: 'option', index: 2, label: 'Later choice' }] }));
lazyAsk.setExpanded(true); lazyAsk.render(40);
assert.equal(laterOptionReads, 0, 'a long first option does not read later choices while painting one viewport');
lazyAsk.setExpanded(false);
const recorded = { role: 'user', content: [{ type: 'text', text: 'unchanged source' }] };
const sourceBefore = JSON.stringify(recorded); event('message_end', { message: recorded });
assert.equal(JSON.stringify(recorded), sourceBefore, 'event observation does not mutate model/history messages');
// Prompt focus and mutual focus return arrows to the editor.
input('\x1bg'); event('ui_prompt_start'); assert.equal(input('\x1b[A'), undefined);
input('\x1bg'); pi.events.emit('compact-renderer:focus:v1', { owner: 'thinking' }); assert.equal(input('\x1b[A'), undefined);
// Mouse coordinates pass through real native self-render shells and MouseRegion routing.
event('message_end', { message: { role: 'user', content: 'mouse fixture' } });
const mouseFirst = make('read', 'mouse-first', { path: '/tmp/mouse-first' }); mouseFirst.updateResult(result('mouse first output'));
const mouseSecond = make('read', 'mouse-second', { path: '/tmp/mouse-second' }); mouseSecond.updateResult(result('mouse second output'));
const mouseAt = (component, type, y, extra = {}) => {
  const lines = component.render(120);
  return component.handleMouse({ type, button: type === 'wheel' ? 'none' : 'left', x: 2, y, screenX: 2, screenY: y, width: 120, height: lines.length, shift: false, alt: false, ctrl: false, ...extra });
};
const rowAt = (component, fragment) => component.render(120).findIndex(line => stripAnsi(line).includes(fragment));
assert.equal(mouseAt(mouseFirst, 'click', 0), undefined, 'native spacer cannot focus a pane');
assert.equal(input('\x1b[A'), undefined);
assert.equal(mouseAt(mouseFirst, 'wheel', 1, { wheelDelta: 3 }), undefined, 'closed pane preserves transcript wheel scrolling');
assert.equal(mouseAt(mouseFirst, 'click', 1, { x: -1 }).handled, true);
assert.equal(input('\x1b[A'), undefined, 'outside x suppresses native toggle without focus');
assert.equal(mouseAt(mouseFirst, 'click', 1).handled, true, 'single summary header opens details');
assert.doesNotMatch(paint(mouseFirst), /focused/);
assert.equal(input('\r'), undefined, 'mouse expansion leaves Enter with the editor');
assert.match(paint(mouseFirst), /1\. read/);
mouseAt(mouseFirst, 'click', rowAt(mouseFirst, '1. read'));
assert.match(paint(mouseFirst), /mouse first output/);
mouseAt(mouseFirst, 'wheel', 3, { wheelDelta: 2 });
const secondActionRow = rowAt(mouseFirst, '2. read'); assert.ok(secondActionRow > 0);
mouseAt(mouseFirst, 'click', secondActionRow);
assert.match(paint(mouseFirst), /mouse first output/, 'clicking second action preserves the earlier inline output');
mouseAt(mouseFirst, 'wheel', 3, { wheelDelta: 9 });
assert.match(paint(mouseFirst), /▾ 2\. read/, 'second action expands independently');
assert.match(paint(mouseFirst), /mouse second output/);
input('\x1b');
const outputRow = rowAt(mouseFirst, 'mouse second output');
mouseAt(mouseFirst, 'click', outputRow);
assert.equal(input('\x1b[A'), undefined, 'output text click does not take keyboard focus');
assert.match(paint(mouseFirst), /mouse second output/, 'output click cannot trigger native whole-row collapse');
mouseAt(mouseFirst, 'wheel', 3, { wheelDelta: -20 });
assert.match(paint(mouseFirst), /mouse first output/);
mouseAt(mouseFirst, 'click', 1);
assert.doesNotMatch(paint(mouseFirst), /1\. read/, 'group header closes the inline pane');
input('\x1b');
assert.equal(input('\x1b[A'), undefined);
assert.equal(mouseAt(mouseFirst, 'click', 10000), undefined);
redraws = 0; // Bound each additional replay batch independently.
// Content-first replay: exact native write contract, tight siblings, separate errors.
event('message_end', { message: { role: 'user', content: 'density fixture' } });
const densityWriteA = make('write', 'density-write-a', { path: '/fixture/sample-a.txt', content: 'alpha' });
densityWriteA.updateResult(result('Successfully wrote to /fixture/sample-a.txt'));
const densityWriteB = make('write', 'density-write-b', { path: '/fixture/sample-b.txt', content: 'beta' });
densityWriteB.updateResult(result('Successfully wrote to /fixture/sample-b.txt'));
const densityReadA = make('read', 'density-read-a', { path: '/fixture/sample-a.txt', offset: null, limit: null }); densityReadA.updateResult(result('alpha'));
const densityReadB = make('read', 'density-read-b', { path: '/fixture/sample-b.txt', offset: null, limit: null }); densityReadB.updateResult(result('beta'));
densityWriteA.setExpanded(true);
let tightRows = densityWriteA.render(120).map(stripAnsi);
assert.equal(tightRows.length, 6, 'native spacer plus group header and four adjacent action headings');
assert.ok(tightRows.slice(1).every(row => row.trim()), 'no blank rows between sibling actions');
clickSingle(densityWriteA, 2);
assert.match(paint(densityWriteA), /Content alpha/);
assert.doesNotMatch(paint(densityWriteA), /Successfully wrote|Arguments|Output|content:/);
const densityChoices = []; pi.events.emit('compact-renderer:inspect:v1', { add: choice => densityChoices.push(choice) });
densityChoices.find(choice => choice.label.includes('Edit files and read files')).focus();
input('\t');
let detailsRows = densityWriteA.render(120);
assert.match(stripAnsi(detailsRows.at(-1)), /Enter expand Details · Tab action/);
assertCardBackground([detailsRows.find(row => stripAnsi(row).includes('▸ Details'))], 120, 'selectedBg');
assertNeutral([detailsRows.find(row => stripAnsi(row).includes('4 actions'))]);
assert.doesNotMatch(paint(densityWriteA), /Arguments/, 'focusing Details does not expand it');
input('\r');
assert.match(paint(densityWriteA), /Successfully wrote to \/fixture\/sample-a.txt/);
assert.match(paint(densityWriteA), /path: "\/fixture\/sample-a.txt"/);
assert.match(paint(densityWriteA), /content:/);
assert.match(paint(densityWriteA), /Enter collapse Details/);
input('\x1b[Z'); assert.match(paint(densityWriteA), /Content alpha/, 'Shift+Tab returns to content target');
input('\x1b[C'); input('\r'); input('\t'); input('\r');
const densityPane = densityWriteA.resultRendererComponent.owner.group.pane;
assert.ok(densityPane.detailsExpanded.has('density-write-a') && densityPane.detailsExpanded.has('density-write-b'), 'Details expansion is independent for each action');
assert.ok(densityPane.expanded.has('density-write-a') && densityPane.expanded.has('density-write-b'), 'content expansion is independent');
input('\x1b[C'); input('\r');
assert.match(paint(densityWriteA), /alpha/); assert.doesNotMatch(paint(densityWriteA), /offset:|limit:/, 'read content omits repeated arguments');
input('\t'); input('\r');
assert.match(paint(densityWriteA), /offset: null/); assert.match(paint(densityWriteA), /limit: null/);
input('\x1b'); assert.equal(input('\t'), undefined, 'editor Tab is not captured');
const nonstandardWrite = make('write', 'density-extra-output', { path: '/fixture/source.js', content: 'const count = 2;' });
nonstandardWrite.updateResult(result('Successfully wrote to /fixture/source.js\nRecorded extra diagnostic', { warning: 'Keep this warning', truncated: true }));
nonstandardWrite.setExpanded(true);
assert.match(paint(densityWriteA), /warning recorded|output truncated/);
// The new write belongs to the same successful group; use its selected action anchor.
const extraPane = densityWriteA.resultRendererComponent.owner.group.pane;
extraPane.selected = extraPane.actions.length - 1; extraPane.handle('\x1b[C'); extraPane.handle('\x1b[D'); extraPane.handle('\r');
const extraPaint = densityWriteA.render(120).join('\n');
assert.match(stripAnsi(extraPaint), /Recorded extra diagnostic/, 'only full exact native write acknowledgement is suppressed');
assert.ok(extraPaint.includes(themeModule.theme.getFgAnsi('syntaxKeyword')), 'submitted source keeps path-based syntax colors');
event('message_end', { message: { role: 'user', content: 'unknown tool boundary' } });
const customContent = make('custom-tool', 'density-custom', { path: '/fixture/custom', option: null });
customContent.updateResult(result('# literal custom output **keep**\nunknown diagnostic', null)); customContent.setExpanded(true);
assert.match(paint(customContent), /# literal custom output \*\*keep\*\*/);
assert.match(paint(customContent), /unknown diagnostic/);
assert.doesNotMatch(paint(customContent), /Arguments/);
clickSingle(customContent, 4);
assert.match(paint(customContent), /Metadata[\s\S]*null/, 'explicit null diagnostics remain accessible');
const missing = make('read', 'density-missing', { path: '/fixture/missing.txt', offset: null, limit: null });
const missingText = "ENOENT: no such file or directory, access '/fixture/missing.txt'";
missing.updateResult({ ...result(missingText), isError: true }); missing.setExpanded(true);
assert.match(paint(missing), /ENOENT · File not found/);
assert.doesNotMatch(paint(missing), /access '/);
clickSingle(missing, 3); assert.match(paint(missing), /no such file or directory, access/);
const customFailure = make('custom-tool', 'density-custom-failure', {});
customFailure.updateResult({ ...result('Unknown failure with full useful context'), isError: true }); customFailure.setExpanded(true);
assert.match(paint(customFailure), /Unknown failure with full useful context/, 'unknown failure output remains visible');
const customKnownCode = make('custom-tool', 'density-custom-os-error', {});
customKnownCode.updateResult({ ...result("ENOENT: custom tool's exact diagnostic and context"), isError: true }); customKnownCode.setExpanded(true);
assert.match(paint(customKnownCode), /custom tool's exact diagnostic and context/, 'custom failure output is never replaced by an OS category');
redraws = 0;
// Details focus on a later mouse-selected action must bypass earlier huge output.
event('message_end', { message: { role: 'user', content: 'large inline focus fixture' } });
const earlierLarge = make('read', 'density-earlier-large', { path: '/fixture/large.txt' }); earlierLarge.updateResult(result('primary first line\n' + 'x'.repeat(1000000)));
const laterSmall = make('read', 'density-later-small', { path: '/fixture/later.txt', offset: null }); laterSmall.updateResult(result('later small output'));
earlierLarge.setExpanded(true);
const inlinePane = earlierLarge.resultRendererComponent.owner.group.pane;
const laterHeadingRow = earlierLarge.render(120).findIndex(row => stripAnsi(row).includes('2. read'));
clickSingle(earlierLarge, laterHeadingRow);
inlinePane.expanded.add('density-earlier-large'); inlinePane.reset(); // Simulate another independently open sibling before the clicked action.
const laterChoices = []; pi.events.emit('compact-renderer:inspect:v1', { add: choice => laterChoices.push(choice) });
laterChoices.find(choice => choice.label === '2 actions · Read files' && choice.id === laterChoices.at(-1).id).focus();
input('\t');
assert.match(paint(earlierLarge), /later small output[\s\S]*▸ Details/);
assert.doesNotMatch(paint(earlierLarge), /primary first line/, 'Tab anchors at the mouse-selected sibling');
input('\x1b[D'); input('\r'); // Select first action, whose primary content is already open; toggle closed then open for inspection.
input('\r'); input('\t');
assert.match(paint(earlierLarge), /content above ↑/);
input('\x1b[A'); assert.match(paint(earlierLarge), /primary first line/, 'Up returns from long-content Details anchor');
input('\t'); assert.match(paint(earlierLarge), /content above ↑/);
input('\x1b'); assert.match(paint(earlierLarge), /primary first line/, 'Escape restores primary content after Details inspection');
laterChoices.at(-1).focus(); input('\t');
assert.equal(input('typed editor text'), undefined);
assert.match(paint(earlierLarge), /primary first line/, 'typing also restores primary content before returning to editor');
redraws = 0;
// Replay script-shaped shell fallbacks without running any command.
const nodeScripts = [
  `node -e 'const paths = ["/fixture/a", "/fixture/b"]; console.log(paths.map(path => ({ path })));'`,
  `node - <<'NODE'\nconst paths = ["/fixture/a", "/fixture/b"];\nconsole.log(paths.map(path => ({ path })));\nNODE`,
];
for (const command of nodeScripts) {
  assert.equal(toolLabel('bash', { command }), 'bash · Run Node.js script');
  assert.doesNotMatch(toolLabel('bash', { command }), /paths|fixture|console|codemode/);
}
assert.equal(toolLabel('bash', { command: 'node --version' }), 'bash · node --version', 'non-script interpreter operations stay truthful');
assert.equal(toolLabel('bash', { command: 'python3 -c "print(1)"' }), 'bash · Run Python script');
assert.equal(toolLabel('bash', { command: 'node /fixture/check.mjs' }), 'bash · Run Node.js script · /fixture/check.mjs');
assert.ok(toolLabel('bash', { command: 'custom-command ' + 'x'.repeat(10000) }).length < 80);
event('message_end', { message: { role: 'user', content: 'synthetic script replay' } });
const scripted = make('bash', 'script-label', { command: nodeScripts[1] });
scripted.updateResult(result('# literal stdout **unchanged** _log_\nSynthetic script output', { exitCode: 0 }));
assert.equal(paint(scripted).trim(), '▸ bash · Run Node.js script');
assert.doesNotMatch(paint(scripted), /successful|Completed|✓|const paths/);
scripted.setExpanded(true);
let scriptPaint = scripted.render(120).join('\n');
assert.match(stripAnsi(scriptPaint), /# literal stdout \*\*unchanged\*\* _log_/, 'Bash stdout remains literal');
assert.doesNotMatch(stripAnsi(scriptPaint), /const paths/);
clickSingle(scripted, 4);
scriptPaint = scripted.render(120).join('\n');
assert.match(stripAnsi(scriptPaint), /const paths/);
assert.ok(scriptPaint.includes(themeModule.theme.getFgAnsi('syntaxKeyword')), 'heredoc source uses native JavaScript keyword colors');
scripted.setExpanded(false);
const exactError = `Error: ENAMETOOLONG: name too long, lstat '${'\"/fixture/very-long-path\",'.repeat(10000)}'`;
const scriptFailure = make('bash', 'script-failure', { command: nodeScripts[0] });
const failureRecording = { ...result(exactError, { error: exactError, exitCode: 1 }), isError: true };
scriptFailure.updateResult(failureRecording);
assert.equal(paint(scriptFailure).trim(), '▸ bash · Run Node.js script · ✗ Failed · Path too long');
assert.ok(paint(scriptFailure, 500).trim().length < 100);
scriptFailure.setExpanded(true);
assert.doesNotMatch(paint(scriptFailure), /name too long, lstat/);
clickSingle(scriptFailure, 3);
assert.match(paint(scriptFailure), /ENAMETOOLONG: name too long, lstat/);
event('message_end', { message: { role: 'user', content: 'focused overflow fixture' } });
const focusedOverflow = make('read', 'focused-overflow', { path: '/fixture/focused-overflow' });
focusedOverflow.updateResult(result(Array.from({ length: 60 }, (_, n) => `Focused output ${n}`).join('\n')));
paint(focusedOverflow);
const overflowChoices = []; pi.events.emit('compact-renderer:inspect:v1', { add: choice => overflowChoices.push(choice) });
overflowChoices.find(choice => choice.label.includes('/fixture/focused-overflow')).focus();
const focusedOverflowRows = focusedOverflow.render(120).map(stripAnsi);
assert.match(focusedOverflowRows.join('\n'), /Focused output 0\b/);
clickSingle(focusedOverflow, focusedOverflowRows.findIndex(row => row.includes('more ↓')));
assert.doesNotMatch(paint(focusedOverflow), /Focused output 0\b/, 'overflow paging survives mouse release of inspection');
assert.doesNotMatch(paint(focusedOverflow), / · focused/);
assert.equal(input('\r'), undefined, 'tool overflow returns Enter to the editor');
const styled = new ToolPane([{ id: 'styles', label: 'read', sections: function* () {
  yield { text: '# Recorded heading\n**Emphasis** and `inline` code.\n```javascript\nconst paths = ["/fixture/a"];\n```', format: 'markdown' };
  yield { text: '-const before = 1;\n+const after = 2;', format: 'code', language: 'diff' };
} }], 'Styles', () => 20);
styled.open = true; styled.theme = themeModule.theme;
const styledRows = styled.render(120).join('\n');
assert.match(stripAnsi(styledRows), /Recorded heading/);
assert.doesNotMatch(stripAnsi(styledRows), /# Recorded heading|\*\*Emphasis\*\*/);
assert.ok(styledRows.includes(themeModule.theme.getFgAnsi('syntaxKeyword')), 'fenced code uses native syntax colors');
assert.ok(styledRows.includes(themeModule.theme.getFgAnsi('syntaxString')), 'code strings use their native token color');
assert.ok(styledRows.includes(themeModule.theme.getFgAnsi('toolDiffAdded')), 'diff additions use native highlighting');
assert.equal(failureRecording.content[0].text, exactError, 'expanded formatting leaves exact recorded output unchanged');
assert.equal(failureRecording.details.error, exactError, 'expanded formatting leaves exact recorded details unchanged');
// Track actual native shell intervals, without leaking a real clock if an assertion fails.
const actualSetInterval = globalThis.setInterval, actualClearInterval = globalThis.clearInterval;
const intervals = new Set();
globalThis.setInterval = (...args) => { const handle = actualSetInterval(...args); intervals.add(handle); return handle; };
globalThis.clearInterval = (handle) => { intervals.delete(handle); return actualClearInterval(handle); };
try {
  for (const finish of ['success', 'error', 'cancel']) {
    toggle(false);
    const running = make('bash', `clock-${finish}`, { command: 'printf safe' });
    running.markExecutionStarted(); running.updateResult(result('partial'), true);
    assert.equal(intervals.size, 1);
    toggle(true); assert.equal(intervals.size, 0, 'collapse releases native timer');
    running.updateResult({ ...result('done', finish === 'cancel' ? { status: 'cancelled' } : {}), isError: finish === 'error' });
    assert.equal(intervals.size, 0);
  }
  toggle(false);
  const running = make('bash', 'clock-switch', { command: 'printf safe' });
  running.markExecutionStarted(); running.updateResult(result('partial'), true);
  assert.equal(intervals.size, 1);
  event('session_before_switch'); assert.equal(intervals.size, 0); assert.equal(input, undefined);
  event('session_start', { reason: 'resume' }); assert.equal(typeof input, 'function');
  running.invalidate(); assert.equal(intervals.size, 0, 'late old-session invalidation does not restart a timer');
  const resumed = make('read', 'resumed', { path: '/tmp/resumed' }); resumed.updateResult(result('resumed output'));
  toggle(true); assert.match(paint(resumed), /read · \/tmp\/resumed/);
  event('session_compact'); event('session_tree');
  toggle(false);
  const shutdownRunning = make('bash', 'clock-shutdown', { command: 'printf safe' });
  shutdownRunning.markExecutionStarted(); shutdownRunning.updateResult(result('partial', { calls: [] }), true);
  assert.equal(intervals.size, 1, 'wrapped tools retain the native timer contract');
  dispose(); dispose(); assert.equal(intervals.size, 0); assert.equal(input, undefined); assert.equal(modeChange, undefined);
} finally { for (const handle of intervals) actualClearInterval(handle); globalThis.setInterval = actualSetInterval; globalThis.clearInterval = actualClearInterval; }
// A 10 MB output is not eagerly split or painted. Stored source remains unchanged.
const huge = '漢字🙂 exact\x1b[31m\n'.repeat(400000);
const simplePane = new ToolPane([{ id: 'simple', label: 'read · exact.txt', sections: function* () { yield { text: 'Output', kind: 'section' }; yield 'exact output'; } }], '1 successful action', () => 20);
simplePane.theme = themeModule.theme; simplePane.open = true; simplePane.expanded.add('simple');
const simpleRows = simplePane.render(80);
assert.equal(simpleRows.length, 3, 'an unfocused complete pane has no footer row');
assert.doesNotMatch(stripAnsi(simpleRows.join('\n')), /to inspect|Alt\+G|more ↓/);
assert.doesNotMatch(stripAnsi(simpleRows.join('\n')), /1\. read/, 'a singleton has no duplicate action heading');
assert.equal(stripAnsi(simpleRows.find(row => stripAnsi(row).includes('exact output'))).indexOf('exact output'), 3, 'singleton details align after the disclosure column');
assert.ok(simpleRows.find(row => stripAnsi(row).trim() === 'Output').includes(themeModule.theme.getFgAnsi('muted')), 'section headings use the native muted color');
const singleRound = new ToolPane([{ id: 'round', label: 'Recorded first line', sections: function* () { yield 'Full recorded round'; } }], 'Thinking · 1 round');
singleRound.itemName = 'round'; singleRound.open = true;
assert.match(stripAnsi(singleRound.render(80).join('\n')), /1\. Recorded first line/);
assert.doesNotMatch(stripAnsi(singleRound.render(80).join('\n')), /Full recorded round/);
singleRound.handle('\r');
assert.match(stripAnsi(singleRound.render(80).join('\n')), /Full recorded round/, 'single thinking rounds keep independent expansion');
// Thinking uses the same compact expansion and disclosure coordinates as tools.
const narrative = new ToolPane([
  { id: 'first', label: 'First round', sections: () => ['First body'] },
  { id: 'second', label: 'Second round', sections: () => ['Second body'] },
], 'Thinking', () => 12);
narrative.itemName = 'round'; narrative.open = true; narrative.expanded.add('first');
const narrativeRows = narrative.render(80).map(stripAnsi);
assert.match(narrativeRows[2], /First body/, 'expanded round body immediately follows its heading');
const clickNarrative = y => narrative.handleMouse({ type: 'click', button: 'left', x: 3, y });
clickNarrative(2);
assert.deepEqual([...narrative.expanded], ['first'], 'clicking the body does not toggle an action');
clickNarrative(narrativeRows.findIndex(line => line.includes('Second round')));
assert.ok(narrative.expanded.has('second'), 'later round disclosure uses its compact rendered row');
assert.match(narrative.render(80).map(stripAnsi).join('\n'), /Second body/);
narrative.detailsExpanded.add('first'); narrative.offset = 4; narrative.focused = true;
narrative.collapse();
assert.equal(narrative.open, false); assert.equal(narrative.focused, false); assert.equal(narrative.offset, 0);
assert.equal(narrative.expanded.size, 0); assert.equal(narrative.detailsExpanded.size, 0);
narrative.open = true;
assert.doesNotMatch(narrative.render(80).map(stripAnsi).join('\n'), /First body|Second body/, 'explicit reset reopens with all actions closed');
// Content that already fits must not lose a row just because the user wheels down.
const fittingPane = new ToolPane([{ id: 'fits', label: 'Read', sections: () => Array.from({ length: 7 }, (_, n) => `Fitting row ${n}`) }], 'Read', () => 8);
fittingPane.open = true;
const fittingRows = fittingPane.render(80);
fittingPane.handleMouse({ type: 'wheel', button: 'none', x: 3, y: 2, wheelDelta: 1 });
assert.deepEqual(fittingPane.render(80), fittingRows, 'a fully visible result does not create artificial overflow');
assert.equal(fittingPane.offset, 0);
// The rendered overflow footer pages the existing inline viewport and preserves Details state.
const overflowPane = new ToolPane([{ id: 'overflow', label: 'Read', sections: function* () {
  for (let n = 0; n < 60; n++) yield `Recorded output ${n}`;
}, details: () => ['Exact arguments'] }], 'Read', () => 8);
overflowPane.open = true; overflowPane.detailsExpanded.add('overflow');
let overflowRows = overflowPane.render(80).map(stripAnsi);
const clickOverflow = extra => overflowPane.handleMouse({ type: 'click', button: 'left', x: 3, y: overflowRows.findIndex(row => row.includes('more ↓')), ...extra });
assert.equal(clickOverflow({ shift: true })?.render, false); assert.equal(overflowPane.offset, 0, 'modified overflow clicks preserve text selection');
assert.equal(clickOverflow()?.handled, true);
overflowRows = overflowPane.render(80).map(stripAnsi);
assert.ok(overflowPane.offset > 0 && overflowPane.offset <= 8, 'overflow click advances one bounded tool viewport');
assert.doesNotMatch(overflowRows.join('\n'), /Recorded output 0\b/);
assert.ok(overflowPane.detailsExpanded.has('overflow'), 'paging preserves Details expansion');
for (let n = 0; n < 20 && overflowRows.some(row => row.includes('more ↓')); n++) {
  clickOverflow(); overflowRows = overflowPane.render(80).map(stripAnsi);
}
assert.match(overflowRows.join('\n'), /Recorded output 59/);
assert.doesNotMatch(overflowRows.join('\n'), /more ↓/, 'downward paging stops at the end');
const overflowEndOffset = overflowPane.offset, overflowEndHeight = overflowRows.length;
assert.match(overflowRows.at(-1), /more ↑/);
overflowPane.handleMouse({ type: 'click', button: 'left', x: 3, y: overflowRows.length - 1 });
overflowRows = overflowPane.render(80).map(stripAnsi);
assert.ok(overflowPane.offset < overflowEndOffset, 'the final footer pages back');
assert.equal(overflowRows.length, overflowEndHeight, 'tool and thinking panes retain their height at the end');
assert.ok(overflowPane.paintedRows < 80, 'paging only formats the bounded visited output');
const { suppressRepeatedSummary } = await loadSource('./recorded-summary.ts');
const originalSummary = '# **Check inputs**\n\nFirst paragraph.\n\nSecond paragraph.';
assert.equal(suppressRepeatedSummary(originalSummary, 'Check inputs'), 'First paragraph.\n\nSecond paragraph.');
assert.equal(originalSummary, '# **Check inputs**\n\nFirst paragraph.\n\nSecond paragraph.', 'presentation helper preserves recorded source');
for (const [source, summary] of [
  ['Different title\nBody', 'Check inputs'],
  ['Check inputs. More content in this paragraph.\nBody', 'Check inputs.'],
  ['# Check inputs\n\n', 'Check inputs'],
  ['A long complete title\nBody', 'A long…'],
  ['Exact title\n' + '\n'.repeat(100000) + 'Distant body', 'Exact title'],
]) assert.equal(suppressRepeatedSummary(source, summary), source, 'nonmatch, paragraph prefix, sole content and clipped summary stay exact');
const summaryPane = new ToolPane([{ id: 'summary', label: 'Exact title', repeatedSummary: 'Exact title', sections: () => [{text: '# Exact title\n\nVisible body\n\nNext paragraph', format: 'markdown'}] }], 'Thinking · Exact title');
summaryPane.directContent = true; summaryPane.open = true;
assert.doesNotMatch(summaryPane.render(80).map(stripAnsi).slice(1).join('\n'), /Exact title/, 'full repeated heading is omitted from compact body');
assert.match(summaryPane.render(12).map(stripAnsi).slice(1).join('\n'), /Exact/, 'clipped display summary keeps the recorded heading in the body');
summaryPane.focused = false;
assert.doesNotMatch(summaryPane.render(30).map(stripAnsi).slice(1).join('\n'), /Exact title/);
summaryPane.focused = true;
assert.match(summaryPane.render(30).map(stripAnsi).slice(1).join('\n'), /Exact title/, 'focus suffix clipping restores the repeated heading after a cached render');
summaryPane.focused = false;
assert.doesNotMatch(summaryPane.render(30).map(stripAnsi).slice(1).join('\n'), /Exact title/, 'removing focus updates suppression without a width change');
const clippedOverflow = new ToolPane([{ id: 'clipped-overflow', label: 'Exact title', repeatedSummary: 'Exact title', sections: () => [{ text: '# Exact title\n\n' + Array.from({ length: 50 }, (_, n) => `Body ${n}`).join('\n'), format: 'markdown' }] }], 'Thinking · Exact title', () => 8);
clippedOverflow.open = true; clippedOverflow.focused = true;
let clippedRows = clippedOverflow.render(30).map(stripAnsi);
assert.match(clippedRows.slice(1).join('\n'), /Exact title/);
clippedOverflow.handleMouse({ type: 'click', button: 'left', x: 3, y: clippedRows.findIndex(row => row.includes('more ↓')) });
clippedOverflow.focused = false; clippedRows = clippedOverflow.render(30).map(stripAnsi);
assert.ok(clippedOverflow.offset > 0, 'a focus-clipped heading also preserves the paged position');
clippedOverflow.handle('\x1b[H');
assert.doesNotMatch(clippedOverflow.render(30).map(stripAnsi).slice(1).join('\n'), /Exact title/, 'Home resets the cache using the current complete heading');
const exactValues = { command: 'printf "hello"\nnext exact line', options: { paths: ['a', 'b'], empty: '', nullable: null } };
const valueRows = [...recordedValues(exactValues)];
assert.ok(valueRows.some(row => row.text === exactValues.command), 'multiline string values remain exact');
assert.ok(valueRows.some(row => row.text === '[1]: \"b\"'), 'array positions and values remain accessible');
assert.ok(valueRows.some(row => row.text === 'empty: \"\"') && valueRows.some(row => row.text === 'nullable: null'), 'empty strings and null remain distinct');
let laterFieldReads = 0;
const largeArguments = { command: huge };
Object.defineProperty(largeArguments, 'later', { enumerable: true, get() { laterFieldReads++; return 'later recorded value'; } });
const argumentPane = new ToolPane([{ id: 'args', label: 'bash', sections: () => recordedValues(largeArguments) }], 'Arguments', () => 8);
argumentPane.open = true; argumentPane.expanded.add('args'); argumentPane.render(30);
assert.equal(laterFieldReads, 0, 'painting a large argument does not visit later fields');
// Details has its own bounded viewport anchor and does not read late metadata early.
let primaryVisits = 0, metadataReads = 0, lateMetadataReads = 0;
const lazyMetadata = { source: huge };
Object.defineProperty(lazyMetadata, 'late', { enumerable: true, get() { lateMetadataReads++; return 'late exact diagnostic'; } });
const lazyDetails = new ToolPane([{ id: 'lazy', label: 'large', sections: function* () { primaryVisits++; yield huge; }, details: function* () { metadataReads++; yield* recordedValues(lazyMetadata); } }], 'Lazy', () => 8);
lazyDetails.open = true; lazyDetails.focused = true; lazyDetails.theme = themeModule.theme;
lazyDetails.render(30);
assert.equal(metadataReads, 0, 'opening useful content does not invoke Details factory');
const beforeFocusVisits = primaryVisits;
lazyDetails.handle('\t');
assert.match(stripAnsi(lazyDetails.render(30).join('\n')), /▸ Details/);
assert.ok(primaryVisits <= beforeFocusVisits + 1, 'Tab probes at most a bounded viewport of primary output');
assert.match(stripAnsi(lazyDetails.render(30).join('\n')), /content above ↑/);
assert.equal(metadataReads, 0, 'focusing Details does not traverse metadata');
lazyDetails.handle('\r'); lazyDetails.render(30);
assert.equal(metadataReads, 1); assert.equal(lateMetadataReads, 0, 'expanding huge metadata only visits a bounded prefix');
assert.ok(lazyDetails.paintedRows < 35, 'content, Details focus and expansion paint bounded rows');
for (const width of [1, 2, 8, 20, 80]) for (const row of lazyDetails.render(width)) assert.ok(tui.visibleWidth(row) <= width);
assert.equal(largeArguments.command, huge, 'argument formatting does not change stored source');
assert.equal([...textRows('\x1b[31m\u202eexact\u{e0001}', 80)].join(''), '\\u001b[31m\\u202eexact\\u{e0001}', 'terminal and bidi controls are visible text');
// Compact summaries retain the native gutter without colored Box padding.
const referencePane = new ToolPane([], 'Ref'); referencePane.theme = themeModule.theme;
for (const width of [8, 30, 80]) {
  const rows = referencePane.render(width);
  assert.equal(rows.length, 1); assert.match(stripAnsi(rows[0]), /^ ▸ Ref/); assertNeutral(rows);
}
const multiDigit = new ToolPane(Array.from({ length: 10 }, (_, index) => ({ id: String(index), label: 'read', sections: function* () { yield 'tenth output'; } })), 'Ten actions');
multiDigit.open = true;
for (let index = 0; index < 9; index++) multiDigit.handle('\x1b[C');
multiDigit.expanded.add('9');
const tenthRows = multiDigit.render(80).map(stripAnsi);
assert.equal(tenthRows.find(row => row.includes('tenth output')).indexOf('tenth output'), tenthRows.find(row => row.includes('10. read')).indexOf('read'), 'detail alignment includes the full multi-digit action prefix');
const pane = new ToolPane([{ id: 'large', label: 'large', sections: function* () { yield huge; } }], 'Large', () => 10);
pane.open = true; pane.expanded.add('large');
for (const width of [1, 8, 20, 80]) {
  const rows = pane.render(width); assert.ok(rows.length <= 10);
  for (const row of rows) assert.ok(tui.visibleWidth(row) <= width);
}
assert.ok(pane.paintedRows < 100, 'painting cost follows viewports rather than output size');
pane.handle('\x1b[6~'); pane.render(80); assert.ok(pane.paintedRows < 120);
assert.ok(huge.includes('\x1b[31m'), 'source escapes remain untouched');
const longLinePane = new ToolPane([{ id: 'line', label: 'long line', sections: function* () { yield 'x'.repeat(10000000); } }], 'Long line', () => 8);
longLinePane.open = true; longLinePane.expanded.add('line'); longLinePane.render(20);
assert.ok(longLinePane.paintedRows <= 8, 'one long line paints a bounded prefix');
// History reconstruction groups once, and repeated ordinary paints do not rescan old records.
let historyReads = 0;
const history = [];
for (let index = 0; index < 1500; index++) {
  const args = { path: `/tmp/history-${index}` };
  history.push({ type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', id: `history-${index}`, name: 'read', arguments: args }] } });
  const entry = { role: 'toolResult', toolCallId: `history-${index}`, toolName: 'read', content: [{ type: 'text', text: 'recorded' }] };
  Object.defineProperty(entry, 'details', { get() { historyReads++; return undefined; } });
  history.push({ type: 'message', message: entry });
}
ctx.sessionManager.getBranch = () => history;
enabled = true;
const disposeHistory = registerModernTools(pi, mode);
event('session_start', { reason: 'reload' });
assert.ok(historyReads < 1500 * 12, `history rebuild reads grow linearly: ${historyReads}`);
const historyRow = make('read', 'history-0', history[0].message.content[0].arguments);
historyRow.updateResult({ content: history[1].message.content, details: undefined });
const readsAfterAttach = historyReads;
for (let iteration = 0; iteration < 20; iteration++) { historyRow.invalidate(); paint(historyRow); }
assert.equal(historyReads, readsAfterAttach, 'unchanged paints never walk history');
const noResultRenderer = resolver('no-result-renderer', () => ({ renderCall: () => new tui.Text('native call', 0, 0) }));
const noResultContext = { toolCallId: 'no-result-context', args: {}, state: {}, cwd: '/tmp', expanded: true, executionStarted: false, isPartial: false, isError: false, outputPad: 1, invalidate() {} };
noResultRenderer.renderCall({}, themeModule.theme, noResultContext);
event('session_start', { reason: 'reload' });
assert.match(stripAnsi(noResultRenderer.renderResult(result('stale recorded output'), { expanded: true, isPartial: false }, themeModule.theme, noResultContext).render(80).join('\n')), /stale recorded output/);
const unsupportedContext = { ...noResultContext, state: undefined };
assert.match(stripAnsi(noResultRenderer.renderResult(result('unsupported recorded output'), { expanded: false, isPartial: false }, themeModule.theme, unsupportedContext).render(80).join('\n')), /unsupported recorded output/);
disposeHistory();
// Use Pi's actual compaction-aware initial display projection. Hidden earlier tools cannot own a visible group.
const recordedSession = core.SessionManager.inMemory('/synthetic-tools');
const recordedArgs = [];
for (let index = 0; index < 3; index++) {
  const args = { path: `/tmp/retained-${index}` }; recordedArgs.push(args);
  recordedSession.appendMessage({ role: 'assistant', content: [{ type: 'toolCall', id: `retained-${index}`, name: 'read', arguments: args }] });
  recordedSession.appendMessage({ role: 'toolResult', toolCallId: `retained-${index}`, toolName: 'read', ...result(`retained output ${index}`) });
}
const retainedEntry = recordedSession.getBranch().find(entry => entry.type === 'message' && entry.message.content?.[0]?.id === 'retained-1');
recordedSession.appendCompaction('Fixture summary before retained tools', retainedEntry.id, 100);
ctx.sessionManager = recordedSession;
const disposeProjection = registerModernTools(pi, mode);
event('session_start', { reason: 'resume' });
let nativeMessages;
core.InteractiveMode.prototype.renderSessionEntries.call({ renderer: undefined, renderSessionItems(items) { nativeMessages = items; } }, recordedSession.buildContextEntries());
const retainedRows = [];
for (const message of nativeMessages) {
  if (message.role === 'assistant') for (const call of message.content ?? []) if (call.type === 'toolCall') retainedRows.push(make(call.name, call.id, call.arguments));
  if (message.role === 'toolResult') retainedRows.at(-1).updateResult(message);
}
assert.equal(retainedRows.length, 2);
assert.match(paint(retainedRows[0]), /2 actions/);
assert.equal(paint(retainedRows[1]), '');
event('session_compact'); assert.match(paint(retainedRows[0]), /2 actions/);
// Old native rows are stale after rebuild; newly replayed rows use the retained projection again.
const replayed = make('read', 'retained-1', recordedArgs[1]); replayed.updateResult(result('retained output 1'));
assert.match(paint(replayed), /2 actions/);
// Isolate redraw accounting for the separate subagent lifecycle fixture session.
redraws = 0;
// Native pi-subagents contracts: receipts describe the operation, not an inferred child outcome.
event('message_end', { message: { role: 'user', content: 'subagent fixtures' } });
const beforeLaunch = make('read', 'before-launch', { path: '/tmp/before-launch' }); beforeLaunch.updateResult(result('before'));
const launchArgs = { agent: 'worker', task: 'Keep this exact task\nincluding its second line.', async: true };
const launchDetails = { mode: 'single', runId: 'run-raw-uuid', results: [], asyncId: 'run-raw-uuid', asyncDir: '/tmp/native-run' };
const launchRecorded = JSON.stringify({ args: launchArgs, details: launchDetails });
const launchOutput = 'Async: worker [run-raw-uuid]\nExact recorded launch receipt.';
const launch = make('subagent', 'sub-launch', launchArgs);
assert.match(paint(launch), /Subagent · launch · worker · Preparing/);
launch.markExecutionStarted(); assert.match(paint(launch), /worker · Running/);
launch.updateResult(result(launchOutput, launchDetails));
assert.match(paint(launch), /Subagent · launch · worker · Started asynchronously/);
assert.doesNotMatch(paint(launch), /Completed|run-raw-uuid|Exact recorded/);
assert.equal(launch.render(100).length, 2); assertNeutral(launch.render(100));
capture('Subagent asynchronous launch compact receipt', launch);
const afterLaunch = make('read', 'after-launch', { path: '/tmp/after-launch' }); afterLaunch.updateResult(result('after'));
assert.doesNotMatch(paint(beforeLaunch), /2 actions/); assert.doesNotMatch(paint(afterLaunch), /2 actions/, 'subagent lifecycle rows separate action groups');
launch.setExpanded(true);
assert.match(paint(launch), /Async: worker \[run-raw-uuid\]/);
assert.match(paint(launch), /Exact recorded launch receipt/);
assert.doesNotMatch(paint(launch), /Arguments|asyncDir|1\. subagent/, 'subagent expansion starts with recorded content');
const subInspection = []; pi.events.emit('compact-renderer:inspect:v1', { add: item => subInspection.push(item) });
subInspection.find(item => item.label.includes('Started asynchronously')).focus();
input('\t'); input('\r');
assert.match(paint(launch), /Arguments/); assert.match(paint(launch), /Keep this exact task/);
assert.match(paint(launch), /including its second line/);
// Details can exceed the body viewport; navigation reaches the exact native detail fields.
for (let i = 0; i < 30; i++) input('\x1b[B');
assert.match(paint(launch), /asyncDir|native-run/);
input('\x1b'); launch.setExpanded(false);
assert.equal(JSON.stringify({ args: launchArgs, details: launchDetails }), launchRecorded, 'subagent rendering leaves native arguments and details intact');
const steer = make('subagent', 'sub-steer', { action: 'steer', id: 'run-raw-uuid', message: 'Exact steering instruction.' });
const queuedDetails = { mode: 'management', results: [], steering: { requestId: 'request-raw-uuid', state: 'pending', deliveryStatus: 'queued', sourceRunId: 'run-raw-uuid', targets: [{ index: 0, state: 'queued' }] } };
steer.updateResult(result('Steering queued for async run run-raw-uuid.\nExact steering instruction.', queuedDetails));
assert.match(paint(steer), /Subagent · steer · Queued/);
assert.doesNotMatch(paint(steer), /Delivered|Completed|steered|raw-uuid/);
steer.setExpanded(true); assert.match(paint(steer), /Exact steering instruction/); steer.setExpanded(false);
steer.updateResult(result('Steering delivered.', { ...queuedDetails, steering: { ...queuedDetails.steering, state: 'delivered', deliveryStatus: 'delivered', targets: [{ index: 0, state: 'delivered' }] } }));
assert.match(paint(steer), /steer · Delivered/); assert.doesNotMatch(paint(steer), /Completed|Consumed/);
for (const [state, tone, expected] of [['failed', 'error', '✗ Failed · Steering failed'], ['partial', 'warning', 'Partial steering result']]) {
  steer.updateResult(result('Exact structured steering outcome.', { ...queuedDetails, steering: { ...queuedDetails.steering, state } }));
  assert.ok(paint(steer).includes(expected));
  assert.ok(steer.render(100)[1].includes(themeModule.theme.getFgAnsi(tone)), 'structured failure and partial receipts remain conspicuous without isError');
}
steer.updateResult({ ...result('Steering not delivered or queued: answer supervisor request request-raw-uuid first.', { mode: 'management', results: [] }), isError: true });
assert.match(paint(steer), /✗ Failed · Steering rejected/); assert.doesNotMatch(paint(steer), /raw-uuid|answer supervisor|Delivered/);
assert.ok(steer.render(100)[1].includes(themeModule.theme.getFgAnsi('error')));
steer.setExpanded(true); assert.match(paint(steer), /Steering not delivered or queued: answer supervisor request request-raw-uuid first/); steer.setExpanded(false);
capture('Subagent rejected steering compact failure', steer);
const rejected = make('subagent', 'sub-rejected', { agent: 'worker', async: true });
rejected.updateResult({ ...result('Capacity policy denied launch; raw-uuid. Exact policy explanation.', { mode: 'single', results: [], activeAsyncCapacity: { limit: 3, active: 3 } }), isError: true });
assert.match(paint(rejected), /✗ Failed · Capacity reached/); assert.doesNotMatch(paint(rejected), /Started|Completed|raw-uuid/);
rejected.setExpanded(true); assert.match(paint(rejected), /Exact policy explanation/); rejected.setExpanded(false);
const foreground = make('subagent', 'sub-foreground', { agent: 'worker' });
foreground.updateResult(result('Exact unresolved child result.', { mode: 'single', results: [{ agent: 'worker' }] }));
assert.match(paint(foreground), /worker · Result recorded/); assert.doesNotMatch(paint(foreground), /Completed/);
foreground.updateResult(result('Exact child result.', { mode: 'single', results: [{ agent: 'worker', exitCode: 0 }] }));
assert.match(paint(foreground), /worker · Completed/);
foreground.updateResult(result('Detached for supervisor coordination.', { mode: 'single', results: [{ agent: 'worker', exitCode: 0, detached: true }] }));
assert.match(paint(foreground), /worker · Detached/); assert.doesNotMatch(paint(foreground), /Completed/);
for (const [field, state] of [['stopped', 'Stopped'], ['timedOut', 'Timed out']]) {
  foreground.updateResult(result('Exact halted child output.', { mode: 'single', results: [{ exitCode: 0, [field]: true }] }));
  assert.match(paint(foreground), new RegExp(`worker · ${state}`)); assert.doesNotMatch(paint(foreground), /Completed/);
}
const statusCard = make('subagent', 'sub-status', { action: 'status', id: 'raw-run-id' });
statusCard.updateResult(result('Run: raw-run-id\nState: running', { mode: 'management', results: [] }));
assert.match(paint(statusCard), /Subagent · status · Status recorded/); assert.doesNotMatch(paint(statusCard), /Completed|raw-run-id/);
const standaloneGuideTopic = 't'.repeat(80);
const standaloneGuide = make('subagent', 'sub-standalone-guide', { action: 'guide', options: { topic: standaloneGuideTopic } });
standaloneGuide.updateResult(result('Exact standalone guide response.', { mode: 'management', results: [] }));
assert.equal(paint(standaloneGuide).split('\n').find(line => line.includes('Subagent · guide')), ` ▸ Subagent · guide · ${standaloneGuideTopic.slice(0, 72)}`, 'standalone guide titles include the sanitized, bounded topic');
assert.doesNotMatch(paint(standaloneGuide), /Result recorded/);
standaloneGuide.setExpanded(true); assert.match(paint(standaloneGuide), /Exact standalone guide response/);
const enableCard = make('subagents_enable', 'sub-enable', {});
enableCard.updateResult(result('Enabled the native subagent tools.', { enabled: true }));
assert.match(paint(enableCard), /Subagent · enable · Result recorded/); assert.doesNotMatch(paint(enableCard), /launch|Started|Completed/);
enableCard.setExpanded(true); assert.match(paint(enableCard), /Enabled the native subagent tools/); enableCard.setExpanded(false);
const supervisor = make('subagent_supervisor', 'sub-reply', { action: 'reply', replyTo: 'request-raw-uuid', message: 'Exact supervisor answer.' });
supervisor.updateResult(result('Replied to supervisor request request-raw-uuid.', { replyTo: 'request-raw-uuid', runId: 'run-raw-uuid', agent: 'worker' }));
assert.match(paint(supervisor), /Supervisor · reply · worker · Reply recorded/); assert.doesNotMatch(paint(supervisor), /raw-uuid|Consumed|Completed/);
supervisor.setExpanded(true); assert.match(paint(supervisor), /Replied to supervisor request request-raw-uuid/); supervisor.setExpanded(false);
const decisionCard = make('contact_supervisor', 'sub-decision', { reason: 'need_decision', message: 'Which route should I use?' });
assert.match(paint(decisionCard), /Supervisor decision · Pending/);
assert.ok(decisionCard.render(100)[1].includes(themeModule.theme.getFgAnsi('accent')));
decisionCard.updateResult(result('**Reply from supervisor:**\nUse route B.', { requestId: 'request-raw-uuid', reason: 'need_decision' }));
assert.match(paint(decisionCard), /Supervisor decision · Reply recorded/);
decisionCard.setExpanded(true); assert.match(paint(decisionCard), /Use route B/); decisionCard.setExpanded(false);
const unknownSubagent = make('subagent', 'sub-unknown', { workflow: true });
unknownSubagent.updateResult(result('Unknown future recorded payload.\nSecond exact line.', { mode: 'future-shape', results: { unexpected: true }, asyncId: 'raw-uuid', status: 'future-state' }));
assert.match(paint(unknownSubagent), /Result recorded/); assert.doesNotMatch(paint(unknownSubagent), /Started|Completed/);
unknownSubagent.setExpanded(true); assert.match(paint(unknownSubagent), /Unknown future recorded payload/); assert.match(paint(unknownSubagent), /Second exact line/);
unknownSubagent.updateResult({ ...result('Exact unknown error with raw-uuid.', { unrecognized: { native: 'keep me' } }), isError: true });
assert.match(paint(unknownSubagent), /✗ Failed · Launch failed/); assert.match(paint(unknownSubagent), /Exact unknown error with raw-uuid/);
const unknownInspection = []; pi.events.emit('compact-renderer:inspect:v1', { add: item => unknownInspection.push(item) });
unknownInspection.find(item => item.label === 'Subagent · launch · ✗ Failed · Launch failed').focus();
input('\t'); input('\r');
assert.match(paint(unknownSubagent), /Metadata/); assert.match(paint(unknownSubagent), /keep me/, 'unknown native fields remain accessible in Details');
input('\x1b');
unknownSubagent.setExpanded(false);
// Import only installed presentation functions; never initialize extension execution/watchers or launch an agent.
const subagentRenderFile = path.join(runtime, 'node_modules/pi-subagents/src/tui/render.js');
if (existsSync(subagentRenderFile)) {
  const { renderSubagentResult, renderSubagentSummary } = await import(pathToFileURL(subagentRenderFile));
  const fixture = result('stock subagent fixture output', { mode: 'single', results: [] });
  for (const renderResult of [renderSubagentResult, renderSubagentSummary]) {
    const installedRenderer = { renderResult };
    toggle(false);
    const original = new ToolExecutionComponent('subagent', 'native-original', { agent: 'fixture' }, { showImages: false }, installedRenderer, { requestRender() {} }, '/synthetic-tools');
    const exempted = new ToolExecutionComponent('subagent', `native-wrapped-${renderResult.name}`, { agent: 'fixture' }, { showImages: false }, resolver('subagent', () => installedRenderer), { requestRender() {} }, '/synthetic-tools');
    for (const expanded of [false, true]) {
      original.updateResult(fixture); original.setExpanded(expanded);
      exempted.updateResult(fixture); exempted.setExpanded(expanded);
      assert.deepEqual(exempted.render(120), original.render(120));
      assert.doesNotMatch(paint(exempted), /successful action/);
      toggle(true);
      assert.match(paint(exempted), /Subagent · launch · fixture · Result recorded/);
      assertNeutral(exempted.render(120));
      toggle(false);
    }
  }
  toggle(true);
} else console.log('installed pi-subagents presentation check skipped: package unavailable');
disposeProjection();
if (process.env.PI_CARD_EVIDENCE_PATH) writeFileSync(process.env.PI_CARD_EVIDENCE_PATH, JSON.stringify({ runtime, evidence }, null, 2) + '\n');
console.log('modern tools: native lifecycle, grouping, questions, focus and bounded output passed');
