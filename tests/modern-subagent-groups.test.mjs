import assert from 'node:assert/strict';
import { loadSource, loadAgent, core, tui, themeModule, stripAnsi } from './test-runtime.mjs';
const { SubagentProjection } = await loadSource('./modern-subagent-groups.ts');
const { registerModernTools } = await loadSource('./modern-tools.ts');
const { registerModernSubagentMessages } = await loadSource('./modern-subagent-messages.ts');
const { createDisplayMode } = await loadSource('./display-mode.ts');
const { ToolExecutionComponent } = await loadAgent('modes/interactive/components/tool-execution.js');
const { CustomEntryComponent } = await loadAgent('modes/interactive/components/custom-entry.js');
const plain = c => c.render(95).map(stripAnsi).join('\n');
const result = (id, name, details = {}, error = false) => ({ role: 'toolResult', toolCallId: id, toolName: name, content: [{ type: 'text', text: 'Exact delivery receipt' }], details, isError: error, timestamp: 2 });
const call = (id, name, args) => ({ type: 'message', id: `call-${id}`, message: { role: 'assistant', content: [{ type: 'toolCall', id, name, arguments: args }], timestamp: 1 } });
const tool = (id, agent = 'worker') => [call(id, 'subagent', { agent, action: 'status' }), { type: 'message', id: `result-${id}`, message: result(id, 'subagent', { agent }) }];
const guideTool = (id, topic, { error = false, content = [{ type: 'text', text: 'Guide result details' }] } = {}) => [call(id, 'subagent', { action: 'guide', options: { topic } }), { type: 'message', id: `result-${id}`, message: { ...result(id, 'subagent', { mode: 'management', results: [] }), content, isError: error } }];
const notice = (id, agent = 'worker', status = 'completed') => ({ type: 'custom_message', id, customType: 'subagent-notify', display: true, content: 'Exact completion text', details: { runs: [{ agent, status }] }, timestamp: id });
const decision = (id = 'request-1') => ({ type: 'custom_message', id: `ask-${id}`, customType: 'subagent_supervisor_request', display: true, content: 'Original request framing', details: { id, requestId: id, reason: 'need_decision', agent: 'worker', runId: 'run-1', requestBody: 'Which exact option?' }, timestamp: id });
const answer = (id = 'request-1') => ({ type: 'custom', id: `entry-${id}`, customType: 'subagent_supervisor_reply', data: { requestId: id, agent: 'worker', runId: 'run-1', message: 'Use option A once.' } });
const exchange = (id = 'request-1', error = false) => [decision(id), call(`reply-${id}`, 'subagent_supervisor', { action: 'reply', replyTo: id }), answer(id), { type: 'message', id: `reply-result-${id}`, message: result(`reply-${id}`, 'subagent_supervisor', { replyTo: id }, error) }];
const message = entry => ({ role: 'custom', customType: entry.customType, details: entry.details, content: entry.content, timestamp: entry.timestamp, display: true });
const projection = new SubagentProjection();
const view = entry => projection.viewSource(entry.type === 'custom_message' ? message(entry) : entry);
let entries = [...tool('a'), notice('n', 'scout'), ...tool('b', 'scout')];
projection.rebuild(entries);
assert.match(projection.viewTool('a').pane.title, /^Subagents · 3 updates · worker, scout$/);
assert.equal(view(entries[2]).hidden, true);
assert.equal(projection.viewTool('b').hidden, true);
for (const boundary of [{ type: 'message', message: { role: 'user', content: 'Visible user text' } }, { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'Visible assistant text' }] } }, call('ordinary', 'read', {})]) {
  projection.rebuild([...tool('a'), boundary, ...tool('b')]); assert.equal(projection.viewTool('a'), undefined); assert.equal(projection.viewTool('b'), undefined);
}
entries = exchange(); projection.rebuild(entries);
assert.equal(view(entries[0]).answered, true, 'call chronology allows reply entry to persist before result');
assert.equal(projection.viewTool('reply-request-1').hidden, true); assert.equal(view(entries[2]).hidden, true);
for (const broken of [exchange('bad', true), [decision('unmatched'), ...exchange('other').slice(1)], [decision('duplicate'), ...exchange('duplicate')], [decision('boundary'), { type: 'message', message: { role: 'user', content: 'Stop here' } }, ...exchange('boundary').slice(1)], [decision('pending')], [decision('bad-ack'), { ...call('ack', 'subagent_supervisor', { action: 'reply', replyTo: 'other' }) }, answer('bad-ack'), { type: 'message', message: result('ack', 'subagent_supervisor', { replyTo: 'bad-ack' }) }]]) {
  projection.rebuild(broken); assert.equal(view(broken[0]), undefined, 'unresolved, failed, repeated or interrupted exchange stays separate');
}
for (const repeated of [[...exchange('repeat-answer'), { ...answer('repeat-answer'), id: 'second-answer' }], [...exchange('repeat-ack'), call('second-ack', 'subagent_supervisor', { action: 'reply', replyTo: 'repeat-ack' }), { type: 'message', message: result('second-ack', 'subagent_supervisor', { replyTo: 'repeat-ack' }) }], [decision('failed-status'), call('failed-status-ack', 'subagent_supervisor', { action: 'reply' }), answer('failed-status'), { type: 'message', message: result('failed-status-ack', 'subagent_supervisor', { replyTo: 'failed-status', status: 'failed' }) }]]) { projection.rebuild(repeated); assert.equal(view(repeated[0]), undefined); }
const imageAck = exchange('image-ack'); imageAck.at(-1).message.content.push({ type: 'image', data: 'exact-image', mimeType: 'image/png' }); projection.rebuild(imageAck); assert.equal(view(imageAck[0]), undefined, 'acknowledgement images preserve native standalone rendering');
projection.rebuild([notice('error', 'worker', 'failed'), ...tool('a'), notice('unknown', 'worker', 'future')]); assert.equal(projection.viewTool('a'), undefined);
for (const attention of [{ results: [{ exitCode: 2 }] }, { results: [{ interrupted: true }] }, { results: [{ detached: true }] }, { results: [{ execution: { status: 'running' } }] }]) {
  projection.rebuild([...tool('a'), call('attention', 'subagent', { agent: 'worker' }), { type: 'message', message: result('attention', 'subagent', attention) }, ...tool('b')]); assert.equal(projection.viewTool('a'), undefined); assert.equal(projection.viewTool('attention'), undefined); assert.equal(projection.viewTool('b'), undefined);
}
const guideTopics = ['tool-reference/parameter-reference', 'tool-reference/execution-parameters', 'tool-reference/fork-context-details'];
const guideEntries = guideTopics.flatMap((topic, index) => guideTool(`guide-${index + 1}`, topic, { content: [{ type: 'text', text: `Exact guide response ${index + 1}` }] }));
projection.rebuild(guideEntries);
const guideView = projection.viewTool('guide-1');
assert.ok(guideView); assert.equal(guideView.pane.title, 'Subagents · 3 guide lookups');
assert.equal(projection.viewTool('guide-2').hidden, true); assert.equal(projection.viewTool('guide-3').hidden, true);
assert.deepEqual(guideView.pane.actions.map(item => item.label), guideTopics.map(topic => `Subagent · guide · ${topic}`));
guideView.pane.open = true; guideView.pane.actions.forEach(item => guideView.pane.expanded.add(item.id));
for (const [index, topic] of guideTopics.entries()) {
  const action = guideView.pane.actions[index];
  assert.ok(Array.from(action.sections()).some(item => item.text === `Exact guide response ${index + 1}`));
  const exactDetails = Array.from(action.details());
  assert.ok(exactDetails.some(item => JSON.stringify(item).includes(topic)));
  assert.ok(exactDetails.some(item => JSON.stringify(item).includes('management')));
}
const longTopic = 't'.repeat(80);
projection.rebuild(guideTool('long-guide', longTopic));
assert.equal(projection.viewTool('long-guide'), undefined, 'a singleton guide remains standalone');
const runningGuide = [call('running-guide', 'subagent', { action: 'guide', options: { topic: 'running-topic' } })];
projection.rebuild(runningGuide); assert.equal(projection.viewTool('running-guide'), undefined);
for (const invalid of [
  [...guideTool('failed-guide', 'failed-topic', { error: true }), ...guideTool('after-failure', 'after-topic')],
  [...guideTool('nontext-guide', 'image-topic', { content: [{ type: 'text', text: 'text' }, { type: 'image', data: 'exact-image', mimeType: 'image/png' }] }), ...guideTool('after-image', 'after-topic')],
  [...guideTool('guide-before-status', 'before-topic'), ...tool('runtime-status'), ...guideTool('guide-after-status', 'after-topic')],
  [...guideTool('guide-before-running', 'before-topic'), call('running-guide-boundary', 'subagent', { action: 'guide', options: { topic: 'running-topic' } }), ...guideTool('guide-after-running', 'after-topic')],
  [...guideTool('guide-before-user', 'before-topic'), { type: 'message', message: { role: 'user', content: 'Visible user text' } }, ...guideTool('guide-after-user', 'after-topic')],
  [...guideTool('guide-before-assistant', 'before-topic'), { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'Visible assistant text' }] } }, ...guideTool('guide-after-assistant', 'after-topic')],
]) {
  projection.rebuild(invalid);
  for (const id of ['failed-guide', 'after-failure', 'nontext-guide', 'after-image', 'guide-before-status', 'runtime-status', 'guide-after-status', 'guide-before-running', 'running-guide-boundary', 'guide-after-running', 'guide-before-user', 'guide-after-user', 'guide-before-assistant', 'guide-after-assistant']) assert.equal(projection.viewTool(id), undefined, 'failed, running, non-text, visible, or runtime boundaries keep guide rows standalone');
}
for (const custom of [notice('paused', 'worker', 'paused'), notice('stopped', 'worker', 'stopped'), { ...notice('future'), customType: 'future-subagent-event' }]) { projection.rebuild([...tool('a'), custom, ...tool('b')]); assert.equal(projection.viewTool('a'), undefined); assert.equal(view(custom), undefined); }
projection.rebuild([...tool('a'), call('future', 'subagent_future', { agent: 'worker' }), { type: 'message', message: result('future', 'subagent_future') }, ...tool('b')]); assert.equal(projection.viewTool('a'), undefined); assert.equal(projection.viewTool('future'), undefined);
projection.clear(); projection.start('live-a', 'subagent', { agent: 'worker' }); projection.end('live-a', 'subagent', result('live-a', 'subagent')); projection.observe({ role: 'custom', customType: 'invisible-housekeeping', display: false, content: 'invisible' }); projection.start('live-b', 'subagent', { agent: 'scout' }); projection.end('live-b', 'subagent', result('live-b', 'subagent'));
const livePane = projection.viewTool('live-a').pane; livePane.open = true; livePane.expanded.add('tool:live-a'); livePane.render(95);
projection.end('live-a', 'subagent', { ...result('live-a', 'subagent'), content: [{ type: 'text', text: 'Updated exact receipt' }] });
projection.viewTool('live-a');
assert.match(livePane.render(95).map(stripAnsi).join('\n'), /Updated exact receipt/, 'changed results invalidate existing bounded pane');

const hooks = new Map(), bus = new Map(), inputs = new Set(), mounted = []; let resolver;
const on = (map, key, fn) => { const set = map.get(key) || new Set(); map.set(key, set); set.add(fn); return () => set.delete(fn); };
const pi = { on: (key, fn) => on(hooks, key, fn), registerToolRenderer(fn) { resolver = fn; }, events: { on: (key, fn) => on(bus, key, fn), emit(key, value) { for (const fn of [...bus.get(key) || []]) fn(value); } } };
const mode = createDisplayMode();
const disposeTools = registerModernTools(pi, mode), disposeMessages = registerModernSubagentMessages(pi, mode);
const nativeMessage = () => new tui.Text('Exact native custom rows', 0, 0), nativeEntry = () => new tui.Text('Exact native entry rows', 0, 0);
const runner = new core.ExtensionRunner([{ messageRenderers: new Map(['subagent-notify', 'subagent_supervisor_request'].map(t => [t, nativeMessage])), entryRenderers: new Map([['subagent_supervisor_reply', nativeEntry]]) }], {}, '/synthetic', {}, {});
const session = core.SessionManager.inMemory('/synthetic');
for (const entry of [...tool('mounted-a'), notice('mounted-notice', 'scout'), ...tool('mounted-b', 'scout'), ...exchange(), notice('failure', 'worker', 'failed'), decision('pending')]) {
  if (entry.type === 'message') session.appendMessage(entry.message);
  else if (entry.type === 'custom_message') session.appendCustomMessageEntry(entry.customType, entry.content, true, entry.details);
  else session.appendCustomEntry(entry.customType, entry.data);
}
const saved = JSON.stringify(session.getEntries()); let reads = 0;
const ctx = { mode: 'tui', hasUI: true, sessionManager: { getLeafId: () => session.getLeafId(), buildContextEntries() { reads++; return session.buildContextEntries(); } }, ui: { theme: themeModule.theme, setHiddenThinkingLabel() { for (const c of mounted) c.invalidate(); }, onTerminalInput(fn) { inputs.add(fn); return () => inputs.delete(fn); } } };
const emit = (key, value = {}) => { for (const fn of [...hooks.get(key) || []]) fn(value, ctx); };
const choices = () => { const out = []; pi.events.emit('compact-renderer:inspect:v1', { add: c => out.push(c) }); return out; };
const key = text => [...inputs].some(fn => fn(text)?.consume);
function mount() {
  mounted.length = 0; let projected;
  core.InteractiveMode.prototype.renderSessionEntries.call({ renderer: undefined, renderSessionItems(items) { projected = items; } }, session.buildContextEntries());
  const tools = new Map();
  for (const item of projected) {
    if (item.role === 'assistant') for (const call of item.content || []) if (call.type === 'toolCall') {
      const native = { renderCall: () => new tui.Text('Exact native call', 0, 0), renderResult: () => new tui.Text('Exact native result', 0, 0) };
      const c = new ToolExecutionComponent(call.name, call.id, call.arguments, { showImages: false, outputPad: 0 }, resolver(call.name, () => native), { requestRender() {} }, '/synthetic'); c.setArgsComplete(); tools.set(call.id, c); mounted.push(c);
    }
    if (item.role === 'toolResult') tools.get(item.toolCallId).updateResult(item);
    if (item.role === 'custom') mounted.push(new core.CustomMessageComponent(item, runner.getMessageRenderer(item.customType), themeModule.getMarkdownTheme()));
    if (item.type === 'custom') mounted.push(new CustomEntryComponent(item, runner.getEntryRenderer(item.customType)));
  }
}
try {
  emit('session_start'); mount();
  assert.match(plain(mounted[0]), /Subagents · 3 updates · worker, scout/);
  assert.deepEqual(mounted[1].render(95), [], 'native custom follower has zero spacer rows'); assert.deepEqual(mounted[2].render(95), []);
  assert.match(plain(mounted[3]), /worker · Decision answered/); assert.deepEqual(mounted[4].render(95), []); assert.deepEqual(mounted[5].render(95), [], 'native entry follower has zero spacer rows');
  assert.match(plain(mounted[6]), /failed/); assert.match(plain(mounted[7]), /needs a decision/);
  assert.equal(key('\x1b[B'), false, 'editor owns arrows before focus');
  const decisionChoice = choices().find(c => c.label.includes('Decision answered')); assert.ok(decisionChoice); decisionChoice.focus();
  assert.match(plain(mounted[3]), /Which exact option\?/); assert.equal((plain(mounted[3]).match(/Use option A once\./g) || []).length, 1); assert.match(plain(mounted[3]), /Supervisor reply/); assert.doesNotMatch(plain(mounted[3]), /User reply|request-1|Exact delivery receipt/);
  assert.ok(mounted[3].render(95).join('').includes(themeModule.theme.getFgAnsi('customMessageLabel')));
  assert.equal(key('\t'), true); assert.equal(key('\r'), true); let details = plain(mounted[3]);
  for (let i = 0; i < 80 && !details.includes('Reply delivery'); i++) { key('\x1b[B'); details = plain(mounted[3]); }
  assert.match(details, /Reply delivery/); assert.equal(key('x'), false); assert.equal(key('\r'), false);
  const beforeReads = reads; for (let i = 0; i < 100; i++) mounted.forEach(c => c.render(95)); assert.equal(reads, beforeReads, 'unchanged leaf paints do not rebuild whole history');
  mode.setEnabled(false);
  assert.match(plain(mounted[0]), /Exact native call/); assert.match(plain(mounted[1]), /Exact native custom rows/); assert.match(plain(mounted[5]), /Exact native entry rows/); assert.equal(choices().length, 0);
  mode.setEnabled(true); assert.deepEqual(mounted[1].render(95), []); assert.deepEqual(mounted[5].render(95), []);
  for (const event of ['session_tree', 'session_compact']) { emit(event); mount(); assert.match(plain(mounted[0]), /3 updates/); assert.match(plain(mounted[3]), /Decision answered/); }
  assert.equal(JSON.stringify(session.getEntries()), saved, 'all exact transcript entries remain unchanged');
  console.log('subagent groups: mixed native hosts, live/replay chronology, decision IDs, boundaries, exact off, focus and bounded paints passed');
} finally { disposeMessages(); disposeTools(); mode.dispose(); }
