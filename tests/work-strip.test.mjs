import assert from 'node:assert/strict';
import { core, loadSource, themeModule, tui, stripAnsi } from './test-runtime.mjs';
const { registerWorkStrip } = await loadSource('./work-strip.ts');
const { createDisplayMode } = await loadSource('./display-mode.ts');
const { workEvidenceType, projectedChildren, recordedWorkEvidence } = await loadSource('./work-strip-view.ts');
const hooks = new Map(), bus = new Map(), inputs = new Set();
const subscribe = (map, name, fn) => { if (!map.has(name)) map.set(name, new Set()); map.get(name).add(fn); return () => map.get(name).delete(fn); };
let manager = core.SessionManager.inMemory('/synthetic-work'), provider = false, childrenActive = 0;
let ownership;
const pi = {
  on: (name, fn) => subscribe(hooks, name, fn),
  events: { on: (name, fn) => subscribe(bus, name, fn), emit: (name, value) => { for (const fn of [...(bus.get(name) || [])]) fn(value); } },
  getAllTools: () => provider ? [{name:'subagent'}] : [],
  appendEntry: (kind, data) => manager.appendCustomEntry(kind, data),
};
pi.events.on('compact-renderer:work-strip:v1', value => { ownership = value.ownsExecutionStatus; });
pi.events.on('subagents:rpc:v1:request', request => pi.events.emit(`subagents:rpc:v1:reply:${request.requestId}`, {version:1, requestId:request.requestId, method:'status', success:true, data:{fleet:{totalActive:childrenActive}}}));
const mode = createDisplayMode();
let controls = registerWorkStrip(pi, mode);
let dispose = controls.dispose;
let ownedRow, nestedOpen = true, nestedResets = 0;
pi.events.on('compact-renderer:disclosures:v1', request => request.add(component => component === ownedRow, nestedOpen, () => { nestedOpen = false; nestedResets++; }));
const ui = { isFollowingOutput: true, requestRender() {}, theme: themeModule.theme, onTerminalInput(fn) { inputs.add(fn); return () => inputs.delete(fn); } };
const ctx = {mode:'tui', hasUI:true, ui, get sessionManager(){return manager;}, isIdle:()=>true};
const event = (name, value={}) => { for (const fn of [...(hooks.get(name) || [])]) fn(value, ctx); };
const display = {
  chatContainer:new tui.Container(), ui, pendingTools:new Map(), outputPad:1, toolOutputExpanded:false, hideThinkingBlock:true,
  get sessionManager(){return manager;},
  session:{extensionRunner:{getMessageRenderer(){}}},
  getUserMessageText:message=>message.content,
  getMarkdownThemeWithSettings:()=>themeModule.getMarkdownTheme(), getMarkdownTransformers:()=>[],
  editor:{addToHistory(){}},
};
const paint = () => stripAnsi(display.chatContainer.render(100).join('\n'));
const add = (message) => {
  message.timestamp ??= Date.now() + manager.getBranch().length;
  manager.appendMessage(message);
  core.InteractiveMode.prototype.addMessageToChat.call(display, message);
  return message;
};
const assistant = (value, stopReason='stop') => add({role:'assistant', content:[{type:'text',text:value}],stopReason});
const tool = (name, result, args={}) => {
  const row = new core.ToolExecutionComponent(name,`tool-${manager.getBranch().length}`,args,{outputPad:1},undefined,ui,'/synthetic-work');
  row.setArgsComplete(); row.updateResult({content:[{type:'text',text:result}],isError:false});
  display.chatContainer.addChild(row); return row;
};
const wait = () => new Promise(resolve=>setTimeout(resolve,130));
const choices = () => { const items=[]; pi.events.emit('compact-renderer:inspect:v1',{add:c=>items.push(c)}); return items; };
const keys = data => { for(const fn of inputs){const result=fn(data); if(result?.consume)return true;} return false; };
try {
  event('session_start');
  event('agent_start'); add({role:'user',content:'Inspect invented samples.'}); assistant('Checking the sample names.');
  const read = tool('read','EXACT_HIDDEN_RESULT');
  const question = tool('ask_user_question','CHOSEN_BETA',{question:'Choose a sample.'});
  assistant('FINAL_VISIBLE_RESULT');
  assert.match(paint(),/Working/); assert.match(paint(),/Checking the sample names/);
  ownedRow = read; controls.setExpanded(false);
  assert.equal(nestedOpen, true, 'explicit collapse preserves a manually opened working pane');
  assert.equal(nestedResets, 0);
  assert.match(paint(), /Working/);
  const original = display.chatContainer.children.slice();
  const messages = JSON.stringify(manager.getBranch().filter(e=>e.type==='message'));
  event('agent_settled'); await wait();
  assert.match(paint(),/▸ Worked for/); assert.match(paint(),/FINAL_VISIBLE_RESULT/);
  assert.doesNotMatch(paint(),/Checking the sample names|EXACT_HIDDEN_RESULT/);
  assert.match(paint(),/CHOSEN_BETA/);
  assert.deepEqual(display.chatContainer.children,original,'canonical children retained');
  assert.equal(JSON.stringify(manager.getBranch().filter(e=>e.type==='message')),messages,'messages untouched');
  assert.equal(ownership,true);
  assert.equal(recordedWorkEvidence(manager.getBranch()).size,1);
  assert.equal(nestedOpen, true, 'automatic completion folding preserves nested manual state');
  controls.setExpanded(false); assert.equal(nestedOpen, false, 'explicit collapse resets the completed owner');
  assert.equal(nestedResets, 1);
  choices().find(c=>c.kind==='Work').focus();
  assert.match(paint(),/▾ Worked for/); assert.match(paint(),/EXACT_HIDDEN_RESULT/);
  assert.equal(keys('\r'),true); assert.doesNotMatch(paint(),/EXACT_HIDDEN_RESULT/);
  assert.equal(keys('\u001b'),true); assert.equal(keys('x'),false);
  // Nested /inspect expands the owning fold before the viewport is revealed.
  pi.events.emit('compact-renderer:focus:v1',{owner:'tools',target:c=>c===read});
  assert.match(paint(),/EXACT_HIDDEN_RESULT/); assert.match(paint(),/▾ Worked for/);
  // Compact off is exact native tree, including messages and tool results.
  mode.setEnabled(false); assert.equal(ownership,false); assert.doesNotMatch(paint(),/Worked for/); assert.match(paint(),/EXACT_HIDDEN_RESULT/);
  mode.setEnabled(true); paint(); assert.equal(ownership,true);
  // A reader in scrollback is not displaced at settlement.
  event('agent_start'); add({role:'user',content:'Second sample.'}); assistant('SECOND_INTERMEDIATE'); tool('read','SECOND_TOOL'); assistant('SECOND_FINAL');
  ui.isFollowingOutput=false; paint(); event('agent_settled'); await wait();
  assert.match(paint(),/SECOND_INTERMEDIATE/);
  ui.isFollowingOutput=true; assert.doesNotMatch(paint(),/SECOND_INTERMEDIATE/); assert.match(paint(),/SECOND_FINAL/);
  // Explicit user expansion during execution wins over completion.
  event('agent_start'); add({role:'user',content:'Third sample.'}); assistant('THIRD_INTERMEDIATE'); tool('read','THIRD_TOOL'); paint();
  choices().filter(c=>c.kind==='Work').at(-1).focus(); assistant('THIRD_FINAL'); event('agent_settled'); await wait();
  assert.match(paint(),/THIRD_INTERMEDIATE/);
  // Background children keep the current turn open after parent settlement.
  provider=true; childrenActive=1;
  event('agent_start'); add({role:'user',content:'Fourth sample.'}); assistant('FOURTH_INTERMEDIATE'); ownedRow = tool('read','FOURTH_TOOL'); nestedOpen = true; assistant('FOURTH_FINAL'); paint();
  pi.events.emit('subagent:async-started',{id:'fourth-root'});
  event('agent_settled'); await wait(); assert.match(paint(),/Waiting/); assert.match(paint(),/FOURTH_INTERMEDIATE/);
  const waitingResets = nestedResets; controls.setExpanded(false);
  assert.equal(nestedOpen, true, 'explicit collapse preserves a manually opened waiting pane');
  assert.equal(nestedResets, waitingResets);
  assert.match(paint(), /Waiting/);
  childrenActive=0; pi.events.emit('subagent:async-complete',{runId:'fourth-root',state:'complete',success:true}); await wait(); await wait();
  assert.doesNotMatch(paint(),/FOURTH_INTERMEDIATE/); assert.match(paint(),/FOURTH_FINAL/);
  // An earlier turn can finish after a later prompt. Unrelated children cannot hold the later reply open.
  childrenActive=1;
  event('agent_start'); add({role:'user',content:'Fifth sample.'}); assistant('FIFTH_INTERMEDIATE'); tool('read', 'FIFTH_TOOL'); assistant('FIFTH_FINAL'); paint();
  pi.events.emit('subagent:async-started',{id:'fifth-root'}); event('agent_settled'); await wait();
  event('agent_start'); add({role:'user',content:'Sixth sample.'}); assistant('SIXTH_INTERMEDIATE'); tool('read','SIXTH_TOOL'); assistant('SIXTH_FINAL'); paint();
  event('agent_settled'); await wait();
  assert.match(paint(),/FIFTH_INTERMEDIATE/); assert.doesNotMatch(paint(),/SIXTH_INTERMEDIATE/);
  childrenActive=0; pi.events.emit('subagent:async-complete',{runId:'fifth-root',state:'complete',success:true}); await wait(); await wait();
  assert.doesNotMatch(paint(),/FIFTH_INTERMEDIATE/); assert.match(paint(),/FIFTH_FINAL/);
  // Reloaded completed work must not reopen between agent_start and the next user.
  event('session_start',{reason:'reload'}); paint(); event('agent_start'); assert.doesNotMatch(paint(),/FIFTH_INTERMEDIATE/);
  add({role:'user',content:'Seventh sample.'}); assistant('SEVENTH_INTERMEDIATE'); tool('read','SEVENTH_TOOL'); paint();
  // A steering message during the same agent run still owns its own strip.
  add({role:'user',content:'Eighth sample.'}); assistant('EIGHTH_INTERMEDIATE'); tool('read','EIGHTH_TOOL'); assistant('EIGHTH_FINAL'); paint();
  event('agent_settled'); await wait();
  assert.doesNotMatch(paint(),/EIGHTH_INTERMEDIATE/); assert.match(paint(),/EIGHTH_FINAL/);
  // An empty terminal response must not promote earlier commentary to 'final'.
  event('agent_start'); add({role:'user',content:'Ninth sample.'}); assistant('NINTH_INTERMEDIATE'); tool('read','NINTH_TOOL'); assistant(''); paint();
  const evidenceBefore=manager.getBranch().filter(e=>e.customType===workEvidenceType).length;
  event('agent_settled'); await wait(); assert.match(paint(),/NINTH_INTERMEDIATE/); assert.match(paint(),/NINTH_TOOL/);
  assert.match(paint(),/Stopped/); assert.equal(manager.getBranch().filter(e=>e.customType===workEvidenceType).length,evidenceBefore);
  // A valid continuation clears the earlier incomplete state.
  event('agent_start');
  const continuation={role:'assistant',content:[{type:'text',text:'NINTH_VALID_FINAL'}],stopReason:'stop'};
  event('message_start',{message:continuation}); add(continuation); paint(); event('agent_settled'); await wait();
  assert.match(paint(),/NINTH_VALID_FINAL/); assert.doesNotMatch(paint(),/NINTH_INTERMEDIATE|NINTH_TOOL/);
  // Unknown DDD severity stays outside; full text opens via shared inspection.
  add({role:'custom',customType:'ddd',display:true,content:'Five maintenance reminders.\nDETAILS_REMAIN_AVAILABLE'}); paint();
  assert.match(paint(),/DDD · Five maintenance reminders/); assert.doesNotMatch(paint(),/DETAILS_REMAIN_AVAILABLE/);
  choices().find(c=>c.kind==='Hook').focus(); assert.match(paint(),/DETAILS_REMAIN_AVAILABLE/);
  keys('\u001b');
  // Resume uses explicit presentation metadata, never an invented completion.
  event('session_start',{reason:'reload'}); assert.match(paint(),/▸ Worked for/);
  assert.doesNotMatch(paint(),/SECOND_INTERMEDIATE/);
  const native = (()=>{mode.setEnabled(false);return paint();})(); mode.setEnabled(true);
  dispose(); assert.equal(paint(),native); assert.equal(ownership,false);
  assert.equal(display.chatContainer[projectedChildren],undefined);
  assert.equal(inputs.size,0);
  dispose=registerWorkStrip(pi,mode).dispose; event('session_start');
  // Fresh adapter mounts on the first replay callback; not stale rows from previous session.
  core.InteractiveMode.prototype.addMessageToChat.call(display,{role:'custom',display:false});
  assert.match(paint(),/FINAL_VISIBLE_RESULT/);
  assert.equal(JSON.stringify(manager.getBranch().filter(e=>e.type==='message')).includes('DETAILS_REMAIN_AVAILABLE'),true);
  console.log('Work strip native grouping, settlement, scrollback, decisions, nested inspection, children, replay, fallback and disposal passed');
} finally {dispose();}

// A changed native container must delegate before reading its former children.
{
  const proto = core.InteractiveMode.prototype, original = proto.addMessageToChat;
  let calls = 0, reason;
  proto.addMessageToChat = function() { calls++; return 'native result'; };
  const fallback = registerWorkStrip(pi, mode, undefined, value => { reason = value; });
  try {
    assert.equal(proto.addMessageToChat.call({ chatContainer: {}, ui: {} }, { role: 'user' }), 'native result');
    assert.equal(calls, 1);
    assert.match(reason, /chat container changed/);
  } finally { fallback.dispose(); proto.addMessageToChat = original; }
}
