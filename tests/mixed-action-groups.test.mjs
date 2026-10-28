import assert from 'node:assert/strict';
import { loadSource, loadAgent, stripAnsi, tui } from './test-runtime.mjs';
const { registerModernTools } = await loadSource('./modern-tools.ts');
const { CodeContent } = await loadSource('./modern-code-content.ts');
const { ToolExecutionComponent } = await loadAgent('modes/interactive/components/tool-execution.js');
const { codemodeRenderers } = await loadAgent('extensions/codemode/renderer.js');
const { createShellRenderers } = await loadAgent('core/tools/renderers/bash.js');
const { readRenderers } = await loadAgent('core/tools/renderers/read.js');
const hooks = new Map(), bus = new Map(); let resolver, input;
const pi = {
 registerToolRenderer(fn) { resolver = fn; },
 on(name, fn) { const set = hooks.get(name) || new Set(); set.add(fn); hooks.set(name, set); return () => set.delete(fn); },
 events: { on(name, fn) { bus.set(name, fn); return () => bus.delete(name); }, emit(name, data) { bus.get(name)?.(data); } },
};
const dispose = registerModernTools(pi, { isEnabled: () => true, onChange: () => () => {} });
let history = [];
const ctx = { hasUI: true, sessionManager: { getBranch: () => history }, ui: { onTerminalInput(fn) { input = fn; return () => { input = undefined; }; } } };
const event = (name, data = {}) => { for (const fn of hooks.get(name) || []) fn(data, ctx); };
const reset = () => { history = []; event('session_start'); };
const native = new Map([['codemode', codemodeRenderers], ['bash', createShellRenderers('$')], ['read', readRenderers]]);
const make = (name, id, args = name === 'codemode' ? { code: `text("source-${id}");` } : name === 'bash' ? { command: 'git status' } : { path: `/fixture/${id}` }) => {
 const component = new ToolExecutionComponent(name, id, args, { showImages: false, outputPad: 0 }, resolver(name, () => native.get(name)), { requestRender() {} }, '/tmp');
 component.setArgsComplete(); return component;
};
const success = (id, calls = [{ name: 'read', args: `/nested/${id}`, status: 'ok' }], details = {}) => ({ content: [{ type: 'text', text: `output-${id}` }], details: { calls, ...details } });
const done = (name, id, result = name === 'codemode' ? success(id) : { content: [{ type: 'text', text: `output-${id}` }] }) => {
 const component = make(name, id); component.updateResult(result); return component;
};
const owner = component => component.callRendererComponent.owner;
const paint = (component, width = 140) => stripAnsi(component.render(width).join('\n'));
const all = components => components.map(component => paint(component)).filter(Boolean).join('\n');
const choices = () => { const found = []; pi.events.emit('compact-renderer:inspect:v1', { add: entry => found.push(entry) }); return found; };
const click = (component, y) => component.handleMouse({ type: 'click', button: 'left', x: 2, y, screenX: 2, screenY: y, width: 140, height: component.render(140).length });
try {
 const accessorDetails = { calls: [] };
 Object.defineProperty(accessorDetails, 'warning', { enumerable: true, get() { throw new Error('recorded warning accessor must not be evaluated'); } });
 const accessorContent = new CodeContent();
 accessorContent.update({ code: 'text(1);' }, { content: [], details: accessorDetails }, 1);
 assert.equal(accessorContent.supported, true); assert.equal(accessorContent.clean, false, 'recorded accessors cannot establish clean grouping eligibility');
 reset();
 const shell = done('bash', 'shell'), codeA = done('codemode', 'code-a'), codeB = done('codemode', 'code-b'), read = done('read', 'read');
 const components = [shell, codeA, codeB, read], group = owner(shell).group;
 assert.deepEqual(group.members.map(node => node.id), ['shell', 'code-a', 'code-b', 'read'], 'each outer call contributes one ordered action');
 assert.match(paint(shell), /4 actions/);
 for (const follower of components.slice(1)) assert.equal(paint(follower), '', 'follower slots contribute no duplicate rows');
 assert.equal(choices().length, 1, 'mixed group has one inspector entry');
 choices()[0].focus();
 assert.match(paint(shell), /2\. codemode · Read files · 1 nested call/);
 input('\x1b[C'); input('\r');
 let visible = paint(shell);
 for (let index = 0; index < 4; index++) { input('\x1b[B'); visible += '\n' + paint(shell); }
 for (const text of ['source-code-a', '✓ read /nested/code-a', 'output-code-a']) assert.ok(visible.includes(text), `group retains code source/calls/output: ${text}`);
 input('\x1b');
 const disclosures = []; pi.events.emit('compact-renderer:disclosures:v1', { add: (...entry) => disclosures.push(entry) });
 assert.equal(disclosures.length, 1); assert.equal(disclosures[0][0](codeA.callRendererComponent), true);
 disclosures[0][2](); assert.equal(group.pane.open, false, 'collapse-all closes mixed group');
 click(shell, 1); assert.equal(group.pane.open, true, 'mouse opens leader group');
 shell.setExpanded(false); shell.setExpanded(true); assert.equal(group.pane.open, true, 'native expansion opens shared group');
 assert.equal(all(components).match(/4 actions/g)?.length, 1);
 // Ordinary Details retain their existing keyboard behavior in mixed groups.
 group.pane.handle('home'); group.pane.handle('\t'); group.pane.handle('\r');
 assert.match(paint(shell), /Arguments/); assert.match(paint(shell), /git status/);

 reset();
 const firstCode = done('codemode', 'first-code'), nextRead = done('read', 'next-read');
 assert.match(paint(firstCode), /2 actions/); assert.equal(paint(nextRead), '');
 assert.equal(firstCode.resultRendererComponent.render(140).length, 0, 'code-first group stays in its original call slot');
 assert.equal(choices().length, 1);
 choices()[0].focus(); input('\r');
 assert.match(paint(firstCode), /source-first-code/);
 // An unsupported shape must remove membership before native fallback paints.
 firstCode.updateResult({ content: [{ type: 'unknown', text: 'future native shape' }], details: { calls: [] } });
 assert.equal(owner(firstCode).group, undefined); assert.equal(owner(nextRead).group.members.length, 1);
 assert.doesNotMatch(paint(firstCode), /2 actions/); assert.match(paint(nextRead), /next-read/);
 firstCode.updateResult(success('restored'));
 assert.match(paint(firstCode), /2 actions/); assert.equal(paint(nextRead), '', 'supported completion restores code-first ownership');

 for (const focused of [false, true]) {
  reset();
  const opened = done('codemode', `opened-${focused}`), originalPane = owner(opened).code;
  if (focused) choices()[0].focus(); else click(opened, 1);
  assert.match(paint(opened), /source-opened/);
  done('read', `append-${focused}`);
  const transferred = owner(opened).group.pane;
  assert.equal(transferred.open, true); assert.equal(transferred.expanded.has(`opened-${focused}`), true);
  assert.equal(originalPane.open, false, 'group transfer clears orphan singleton expansion');
  assert.match(paint(opened), /source-opened/, 'appending an action retains the open code content');
  assert.equal(transferred.focused, focused, 'inspection focus follows the transferred content');
  if (focused) { assert.equal(input('\x1b[B').consume, true); assert.match(paint(opened), /focused/); }
  const collapse = []; pi.events.emit('compact-renderer:disclosures:v1', { add: (...entry) => collapse.push(entry) });
  assert.equal(collapse.length, 1); collapse[0][2]();
  assert.equal(transferred.open, false); assert.equal(originalPane.open, false); assert.equal(transferred.expanded.size, 0);
  click(opened, 1);
  assert.match(paint(opened), /1\. codemode/); assert.doesNotMatch(paint(opened), /source-opened/, 'reopening the group starts with closed actions');
 }

 reset();
 const earlier = done('read', 'earlier-large', { content: [{ type: 'text', text: 'earlier-output\n'.repeat(1000) }] });
 done('read', 'earlier-second');
 const earlierGroup = owner(earlier).group.pane;
 choices()[0].focus(); input('\r'); input('\x1b[B'); paint(earlier);
 assert.match(paint(earlier), /earlier-output/);
 const joining = make('codemode', 'anchored-code');
 joining.markExecutionStarted(); joining.updateResult(success('anchored-code', [{ name: 'read', args: '/anchored', status: 'running' }]), true);
 choices().find(choice => choice.label.startsWith('codemode')).focus();
 joining.updateResult(success('anchored-code'));
 assert.equal(owner(earlier).group.pane, earlierGroup, 'completion reuses the prior ordinary group');
 assert.equal(earlierGroup.selected, 2); assert.equal(earlierGroup.offset, 0);
 assert.match(paint(earlier), /source-anchored-code/, 'focus handoff anchors at code beyond a large earlier output');
 assert.doesNotMatch(paint(earlier), /earlier-output/); assert.equal(paint(joining), '');

 for (const envelope of [true, false]) {
  reset();
  const timed = make('codemode', `timed-${envelope}`, { code: 'text(1);' });
  timed.updateResult({ durationMs: 73250, content: [...(envelope ? [{ type: 'text', text: 'Script completed\nWall time 73.25 seconds\nOutput:\n' }] : []), { type: 'text', text: 'timed output' }], details: { calls: [] } });
  done('read', `after-timed-${envelope}`);
  choices()[0].focus(); input('\r');
  const timing = paint(timed);
  assert.match(timing, envelope ? /Wall time 73\.25 seconds/ : /Took 73\.25s/, 'mixed code retains recorded or context-only duration');
  if (envelope) assert.doesNotMatch(timing, /Took 73\.25s/, 'the recorded envelope does not get duplicate timing');
 }

 reset();
 const before = done('bash', 'before'), live = make('codemode', 'live');
 live.markExecutionStarted(); live.updateResult(success('live', [{ name: 'read', args: '/live', status: 'running' }]), true);
 const after = done('read', 'after');
 assert.equal(owner(live).group, undefined); assert.match(paint(live), /Running/);
 assert.match(paint(before), /bash/); assert.match(paint(after), /after/);
 event('tool_execution_end', { toolCallId: 'live', toolName: 'codemode', result: success('live') });
 live.updateResult(success('live'));
 assert.match(paint(before), /3 actions/); assert.equal(paint(live), ''); assert.equal(paint(after), '');
 const mutable = success('live'); live.updateResult(mutable);
 mutable.details.calls[0].status = 'error'; mutable.details.calls[0].error = 'nested recorded error';
 event('tool_execution_end', { toolCallId: 'live', toolName: 'codemode', result: mutable }); live.updateResult(mutable);
 assert.equal(owner(live).group, undefined, 'in-place final revision removes stale successful membership');
 assert.match(paint(live), /1 nested error/); assert.match(paint(after), /after/); assert.doesNotMatch(paint(before), /3 actions/);
 mutable.details.calls[0].status = 'ok'; delete mutable.details.calls[0].error;
 event('tool_execution_end', { toolCallId: 'live', toolName: 'codemode', result: mutable }); live.updateResult(mutable);
 assert.match(paint(before), /3 actions/); assert.equal(paint(live), '');

 const blockers = [
  ['nested-error', success('bad', [{ name: 'read', args: '', status: 'error', error: 'failed' }])],
  ['nested-cancelled', success('bad', [{ name: 'read', args: '', status: 'cancelled' }])],
  ['nested-unresolved', success('bad', [{ name: 'read', args: '', status: 'running' }])],
  ['unknown-status', success('bad', [{ name: 'read', args: '', status: 'unavailable' }])],
  ['recorded-error', success('bad', [{ name: 'read', args: '', status: 'ok', error: 'recorded diagnostic' }])],
  ['warning', success('bad', [], { warning: 'inspect this warning' })],
  ['warnings', success('bad', [], { warnings: ['inspect this warning'] })],
  ['outer-status', success('bad', [], { status: 'cancelled' })],
  ['outer-error', { ...success('bad'), isError: true }],
  ['image', { content: [{ type: 'image', mimeType: 'image/png', data: '' }], details: { calls: [] } }],
 ];
 for (const [id, record] of blockers) {
  reset(); const left = done('read', `left-${id}`), blocked = done('codemode', id, record), right = done('read', `right-${id}`);
  assert.equal(owner(blocked).group, undefined, `${id} remains standalone`);
  assert.equal(owner(left).group.members.length, 1); assert.equal(owner(right).group.members.length, 1);
  assert.ok(paint(blocked), `${id} keeps a visible compact or native row`);
 }

 // Visible commentary, users, questions, and subagents remain boundaries; pure thinking does not.
 for (const [label, message] of [
  ['commentary', { role: 'assistant', content: [{ type: 'text', text: 'Visible commentary' }] }],
  ['user', { role: 'user', content: [{ type: 'text', text: 'Continue' }] }],
  ['question', { role: 'assistant', content: [{ type: 'toolCall', id: 'question', name: 'ask_user_question', arguments: {} }] }],
  ['subagent', { role: 'assistant', content: [{ type: 'toolCall', id: 'agent', name: 'subagent', arguments: {} }] }],
 ]) {
  reset(); const left = done('codemode', `boundary-${label}`); event('message_end', { message }); const right = done('read', `after-${label}`);
  assert.equal(owner(left).group, undefined, `${label} separates code from ordinary actions`); assert.equal(owner(right).group.members.length, 1);
 }
 reset(); const thinkingCode = done('codemode', 'thinking-code');
 event('message_end', { message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'Private reasoning' }] } });
 const thinkingRead = done('read', 'thinking-read'); assert.match(paint(thinkingCode), /2 actions/); assert.equal(paint(thinkingRead), '');

 // History derives eligibility before renderers attach, including code-first order.
 for (const names of [['bash', 'codemode', 'codemode', 'read'], ['codemode', 'read']]) {
  reset();
  const calls = names.map((name, index) => ({ type: 'toolCall', id: `replay-${index}`, name, arguments: name === 'codemode' ? { code: `text(${index});` } : name === 'bash' ? { command: 'git status' } : { path: '/fixture/replay' } }));
  history = [{ type: 'message', message: { role: 'assistant', content: calls } }, ...calls.map(call => ({ type: 'message', message: { role: 'toolResult', toolCallId: call.id, toolName: call.name, ...(call.name === 'codemode' ? success(call.id) : { content: [{ type: 'text', text: 'replay output' }] }) } }))];
  event('session_tree');
  const replayed = calls.map(call => { const component = make(call.name, call.id, call.arguments); component.updateResult(call.name === 'codemode' ? success(call.id) : { content: [{ type: 'text', text: 'replay output' }] }); return component; });
  assert.deepEqual(owner(replayed[0]).group.members.map(node => node.id), calls.map(call => call.id));
  assert.equal(all(replayed).match(new RegExp(`${names.length} actions`, 'g'))?.length, 1, 'replay has one owner and no dropped summary');
 }

 reset();
 const huge = make('codemode', 'huge', { code: 'const longSource = 1;\n'.repeat(500000) });
 const manyCalls = Array.from({ length: 20000 }, (_, index) => ({ name: 'read', args: `/nested/${index}`, status: 'ok' }));
 huge.updateResult(success('huge', manyCalls)); const tail = done('read', 'tail');
 const content = owner(huge).code.content, bounded = owner(huge).group.pane;
 assert.equal(content.aggregateEntries, 20000); assert.equal(content.sourceCharacters, 0); assert.equal(content.paintedCalls, 0);
 choices()[0].focus(); input('\r'); huge.render(100);
 assert.ok(content.sourceCharacters <= 2048, 'group expansion formats one bounded code viewport');
 assert.equal(content.paintedCalls, 0, 'group does not visit nested calls beyond the source viewport');
 const characters = content.sourceCharacters, painted = bounded.paintedRows;
 for (let index = 0; index < 5; index++) { huge.invalidate(); huge.render(100); }
 assert.equal(content.aggregateEntries, 20000, 'unchanged redraws do not rescan nested records');
 assert.equal(content.sourceCharacters, characters); assert.equal(bounded.paintedRows, painted, 'group reuses visited row cache');
 for (const width of [1, 8, 40, 100]) for (const row of huge.render(width)) assert.ok(tui.visibleWidth(row) <= width);
 assert.equal(paint(tail), '');
 console.log('mixed action groups: order, slots, inspection, transitions, exceptions, replay and bounded formatting passed');
} finally { dispose(); }
