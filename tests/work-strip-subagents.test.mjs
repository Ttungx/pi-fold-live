import assert from 'node:assert/strict';
import { loadSource } from './test-runtime.mjs';
const { monitorWorkStripSubagents } = await loadSource('./work-strip-subagents.ts');

const nativeSetTimeout = globalThis.setTimeout, nativeClearTimeout = globalThis.clearTimeout;
let now = 0;
const timers = new Map();
globalThis.setTimeout = (fn, delay = 0) => {
  const timer = { unref() {} };
  timers.set(timer, { fn, at: now + delay }); return timer;
};
globalThis.clearTimeout = timer => timers.delete(timer);
const tick = milliseconds => {
  const end = now + milliseconds;
  for (;;) {
    const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
    if (!next) break;
    now = next[1].at; timers.delete(next[0]); next[1].fn();
  }
  now = end;
};
const fixture = (names = []) => {
  const bus = new Map(), requests = [], changes = [];
  const tools = names.map(name => ({ name }));
  const events = {
    on(event, fn) { const handlers = bus.get(event) || new Set(); bus.set(event, handlers); handlers.add(fn); return () => handlers.delete(fn); },
    emit(event, data) { for (const fn of [...bus.get(event) || []]) fn(data); },
  };
  events.on('subagents:rpc:v1:request', request => requests.push(request));
  const pi = { events, getAllTools: () => tools };
  let monitor;
  monitor = monitorWorkStripSubagents(pi, () => changes.push(monitor?.current()));
  const reply = (request = requests.at(-1), data = { fleet: { totalActive: 0 } }, overrides = {}) => events.emit(`subagents:rpc:v1:reply:${request.requestId}`, { version: 1, requestId: request.requestId, method: 'status', success: true, data, ...overrides });
  return { monitor, pi, bus, tools, requests, changes, reply };
};
const fixtures = [];
const make = (...args) => { const value = fixture(...args); fixtures.push(value); return value; };
try {
  const absent = make(['read', 'subagent_supervisor']);
  assert.equal(absent.monitor.hasProvider(), false);
  assert.equal(absent.monitor.current(), 'idle');
  assert.equal(absent.requests.length, 0, 'no provider causes no status traffic');
  absent.tools.push({ name: 'subagent' }); absent.monitor.refresh();
  assert.equal(absent.monitor.hasProvider(), true);
  assert.equal(absent.monitor.current(), 'unknown', 'late tool registration is detected');
  absent.reply(); assert.equal(absent.monitor.current(), 'idle');

  const known = make(['subagents']);
  assert.equal(known.monitor.current(), 'unknown');
  assert.equal(known.requests.length, 1, 'initial reset asks once');
  assert.deepEqual(known.requests[0].params, {});
  assert.equal(known.requests[0].method, 'status', 'only read-only status RPC is sent');
  tick(1000);
  assert.equal(known.monitor.current(), 'unknown');
  const requestsAfterTimeout = known.requests.length;
  tick(10_000); assert.equal(known.requests.length, requestsAfterTimeout, 'timeout does not start polling');
  known.monitor.refresh(); known.reply(undefined, { fleet: { totalActive: 2 } });
  assert.equal(known.monitor.current(), 'active');
  known.monitor.refresh(); known.reply(); assert.equal(known.monitor.current(), 'idle');

  for (const data of [{}, { fleet: { totalActive: -1 } }, { fleet: { totalActive: 1.5 } }, { fleet: { totalActive: '0' } }, { fleet: { totalActive: 0 }, asyncSnapshot: {} }]) {
    known.monitor.refresh(); known.reply(undefined, data);
    assert.equal(known.monitor.current(), 'unknown', 'malformed evidence does not permit folding');
  }
  for (const state of ['queued', 'running', 'pending', 'paused', 'blocked', 'future-state']) {
    known.monitor.refresh(); known.reply(undefined, { fleet: { totalActive: 0 }, asyncSnapshot: { runs: [{ state }] } });
    assert.equal(known.monitor.current(), 'active', `${state} remains visible`);
  }
  known.monitor.refresh(); known.reply(undefined, { fleet: { totalActive: 0 }, asyncSnapshot: { runs: [{ state: 'complete', children: [{ state: 'paused' }] }] } });
  assert.equal(known.monitor.current(), 'active', 'nested paused work remains visible');
  known.monitor.refresh(); known.reply(undefined, { fleet: { totalActive: 0 }, asyncSnapshot: { runs: ['complete', 'failed', 'partial', 'stopped', 'rejected'].map(state => ({ state })) } });
  assert.equal(known.monitor.current(), 'idle');
  for (const omitted of [{ runs: 1 }, { children: 1 }, { byteLimitExceeded: true }]) {
    known.monitor.refresh(); known.reply(undefined, { fleet: { totalActive: 0 }, asyncSnapshot: { runs: [], omitted } });
    assert.equal(known.monitor.current(), 'unknown', 'omitted snapshot state does not prove all work finished');
  }
  known.monitor.refresh(); known.reply(undefined, undefined, { success: false, error: { code: 'no_active_session' } });
  assert.equal(known.monitor.current(), 'unknown', 'provider failure keeps the strip open');
  known.monitor.refresh(); known.reply(undefined, undefined, { version: 2 });
  assert.equal(known.monitor.current(), 'unknown', 'unknown protocol versions fail closed');

  known.monitor.refresh(); const stale = known.requests.at(-1);
  known.monitor.reset(); const current = known.requests.at(-1);
  assert.notEqual(stale.requestId, current.requestId);
  known.reply(stale, { fleet: { totalActive: 8 } });
  assert.equal(known.monitor.current(), 'unknown', 'reset invalidates old replies');
  known.reply(current); assert.equal(known.monitor.current(), 'idle');
  known.monitor.refresh(); const pending = known.requests.at(-1);
  known.pi.events.emit('subagent:async-started', {});
  assert.equal(known.monitor.current(), 'active', 'launch makes state active immediately');
  known.reply(pending); assert.equal(known.monitor.current(), 'active', 'reply before launch cannot erase new activity');
  const beforeEvents = known.requests.length;
  for (const event of ['subagent:async-complete', 'subagent:child-status', 'subagent:process-terminal']) known.pi.events.emit(event, {});
  assert.equal(known.requests.length, beforeEvents, 'completion refresh waits for event delivery');
  tick(0); assert.equal(known.requests.length, beforeEvents + 1, 'burst events share one deferred status request');
  known.reply(); assert.equal(known.monitor.current(), 'idle');

  const late = make();
  late.pi.events.emit('subagents:rpc:v1:ready', {});
  assert.equal(late.monitor.hasProvider(), true);
  assert.equal(late.monitor.current(), 'unknown');
  tick(0); assert.equal(late.requests.length, 1, 'provider readiness handles extension load order');
  late.reply(); assert.equal(late.monitor.current(), 'idle');
  const eventOnly = make();
  eventOnly.pi.events.emit('subagent:async-started', {});
  assert.equal(eventOnly.monitor.hasProvider(), true);
  assert.equal(eventOnly.monitor.current(), 'active', 'async events detect a provider without its tools');
  eventOnly.monitor.reset(); assert.equal(eventOnly.monitor.current(), 'unknown');
  eventOnly.reply(); assert.equal(eventOnly.monitor.current(), 'idle');

  const scoped = make(['subagent']);
  assert.equal(scoped.monitor.statusFor([]), 'idle');
  assert.equal(scoped.monitor.statusFor(['missing']), 'unknown', 'global idle never proves a missing run finished');
  scoped.reply(undefined, { fleet: { totalActive: 1 }, asyncSnapshot: { runs: [
    { id: 'turn-a', state: 'complete' },
    { id: 'turn-b', state: 'running' },
    { id: 'parent', state: 'complete', children: [{ id: 'child-only', state: 'complete' }] },
  ] } });
  assert.equal(scoped.monitor.current(), 'active');
  assert.equal(scoped.monitor.statusFor(['turn-a']), 'idle', 'unrelated active work does not block a completed turn');
  assert.equal(scoped.monitor.statusFor(['turn-b']), 'active');
  assert.equal(scoped.monitor.statusFor(['turn-a', 'turn-b']), 'active');
  assert.equal(scoped.monitor.statusFor(['turn-a', 'missing']), 'unknown');
  assert.equal(scoped.monitor.statusFor(['child-only']), 'unknown', 'snapshot step IDs never settle root launches');
  scoped.monitor.refresh(); scoped.reply(undefined, { fleet: { totalActive: 0 }, asyncSnapshot: { runs: [{ id: 'turn-b', state: 'paused' }] } });
  assert.equal(scoped.monitor.statusFor(['turn-a']), 'idle', 'refresh retains earlier explicit root evidence');
  assert.equal(scoped.monitor.statusFor(['turn-b']), 'active');
  scoped.pi.events.emit('subagent:child-status', { runId: 'turn-b', childId: 'step', state: 'complete' });
  scoped.pi.events.emit('subagent:process-terminal', { runId: 'turn-b', state: 'complete' });
  assert.equal(scoped.monitor.statusFor(['turn-b']), 'active', 'child and process completion never settle a root');
  scoped.pi.events.emit('subagent:async-complete', { runId: 'turn-b', childId: 'step', state: 'complete' });
  scoped.pi.events.emit('subagent:async-complete', { id: 'other', runId: 'turn-b', state: 'complete' });
  assert.equal(scoped.monitor.statusFor(['turn-b']), 'active', 'ambiguous completion identity is ignored');
  scoped.pi.events.emit('subagent:async-complete', { id: 'turn-b', runId: 'turn-b' });
  assert.equal(scoped.monitor.statusFor(['turn-b']), 'active', 'completion without outcome does not prove settlement');
  scoped.pi.events.emit('subagent:async-complete', { id: 'turn-b', runId: 'turn-b', state: 'complete' });
  assert.equal(scoped.monitor.statusFor(['turn-b']), 'idle');
  tick(0); scoped.reply(undefined, { fleet: { totalActive: 1 }, asyncSnapshot: { runs: [{ id: 'unrelated', state: 'running' }] } });
  assert.equal(scoped.monitor.current(), 'active');
  assert.equal(scoped.monitor.statusFor(['turn-b']), 'idle', 'root completion survives later snapshot cleanup');
  scoped.monitor.refresh(); scoped.reply(undefined, { fleet: { totalActive: 1 }, asyncSnapshot: { runs: [{ id: 'turn-b', state: 'running' }] } });
  assert.equal(scoped.monitor.statusFor(['turn-b']), 'active', 'a later snapshot with active state keeps the strip open');
  scoped.pi.events.emit('subagent:async-started', { id: 'turn-b' });
  assert.equal(scoped.monitor.statusFor(['turn-b']), 'active', 'restart replaces prior terminal evidence');
  for (const payload of [{ state: 'paused', success: true }, { state: 'blocked' }, { success: false, exitCode: 0 }, { interrupted: true, success: false }]) {
    scoped.pi.events.emit('subagent:async-complete', { id: 'turn-b', ...payload });
    assert.equal(scoped.monitor.statusFor(['turn-b']), 'active', 'paused or blocked completion stays open');
  }
  scoped.pi.events.emit('subagent:async-complete', { runId: 'turn-b', success: false });
  assert.equal(scoped.monitor.statusFor(['turn-b']), 'idle', 'root completion boolean records a terminal failure');
  scoped.pi.events.emit('subagent:async-complete', { runId: 'event-only-complete', success: true });
  assert.equal(scoped.monitor.statusFor(['event-only-complete']), 'idle', 'validated root event supplies missing snapshot evidence');
  const staleScopedRequest = scoped.requests.at(-1);
  scoped.monitor.reset();
  assert.equal(scoped.monitor.statusFor(['turn-a', 'turn-b', 'event-only-complete']), 'unknown', 'session reset removes all scoped evidence');
  scoped.reply(staleScopedRequest, { fleet: { totalActive: 0 }, asyncSnapshot: { runs: [{ id: 'turn-a', state: 'complete' }] } });
  assert.equal(scoped.monitor.statusFor(['turn-a']), 'unknown', 'old session replies cannot repopulate scoped records');
  scoped.reply();
  assert.equal(scoped.monitor.statusFor(['turn-a']), 'unknown', 'empty snapshot never invents root completion');

  const workflow = make(['subagent']);
  workflow.pi.events.emit('subagent:async-started', { id: 'workflow' });
  workflow.pi.events.emit('subagent:async-started', { id: 'workflow-child', parentWorkflowRunId: 'workflow', workflowKey: 'lane' });
  workflow.pi.events.emit('subagent:async-complete', { id: 'independent', success: true });
  workflow.pi.events.emit('subagent:async-complete', { id: 'workflow', state: 'complete', success: true, results: [{ workflowKey: 'lane', runId: 'workflow-child', state: 'running' }] });
  assert.equal(workflow.monitor.statusFor(['workflow']), 'active', 'dispatch completion keeps its running result child visible');
  assert.equal(workflow.monitor.statusFor(['independent']), 'idle', 'workflow descendants do not block unrelated roots');
  tick(0); workflow.reply(undefined, { fleet: { totalActive: 0 }, asyncSnapshot: { runs: [{ id: 'workflow', state: 'complete' }] } });
  assert.equal(workflow.monitor.statusFor(['workflow']), 'active', 'a snapshot that omits a known child cannot settle it');
  workflow.monitor.refresh(); workflow.reply(undefined, { fleet: { totalActive: 0 }, asyncSnapshot: { runs: [{ id: 'workflow', state: 'complete', children: [{ id: 'lane', kind: 'step', state: 'running' }] }] } });
  assert.equal(workflow.monitor.statusFor(['workflow']), 'active', 'snapshot descendants remain checked after root completion');
  assert.equal(workflow.monitor.statusFor(['lane']), 'unknown', 'workflow step keys never become root run IDs');
  workflow.pi.events.emit('subagent:async-complete', { id: 'workflow-child', state: 'complete', success: true });
  assert.equal(workflow.monitor.statusFor(['workflow']), 'idle', 'the linked child completion settles its owning workflow');
  tick(0); workflow.reply(undefined, { fleet: { totalActive: 0 }, asyncSnapshot: { runs: [{ id: 'workflow', state: 'complete', children: [{ id: 'lane', kind: 'step', state: 'complete' }] }] } });
  assert.equal(workflow.monitor.statusFor(['workflow']), 'idle', 'terminal snapshot descendants preserve completed ownership');

  workflow.pi.events.emit('subagent:async-started', { id: 'snapshot-workflow' });
  workflow.pi.events.emit('subagent:async-started', { id: 'snapshot-child', parentWorkflowRunId: 'snapshot-workflow', workflowKey: 'snapshot-lane' });
  workflow.pi.events.emit('subagent:async-complete', { id: 'snapshot-workflow', state: 'complete' });
  assert.equal(workflow.monitor.statusFor(['snapshot-workflow']), 'active', 'launch ownership also works when completion has no results');
  tick(0); workflow.reply(undefined, { fleet: { totalActive: 0 }, asyncSnapshot: { runs: [{ id: 'snapshot-workflow', state: 'complete', children: [{ id: 'snapshot-lane', kind: 'step', state: 'paused' }] }] } });
  assert.equal(workflow.monitor.statusFor(['snapshot-workflow']), 'active', 'a paused child blocks its workflow');
  workflow.monitor.refresh(); workflow.reply(undefined, { fleet: { totalActive: 0 }, asyncSnapshot: { runs: [{ id: 'snapshot-workflow', state: 'complete', children: [{ id: 'snapshot-lane', kind: 'step', state: 'complete' }] }] } });
  assert.equal(workflow.monitor.statusFor(['snapshot-workflow']), 'idle', 'an explicit child snapshot can prove descendant completion');

  workflow.pi.events.emit('subagent:async-started', { id: 'nested-root' });
  workflow.pi.events.emit('subagent:async-started', { id: 'nested-child', parentWorkflowRunId: 'nested-root' });
  workflow.pi.events.emit('subagent:async-started', { id: 'grandchild', parentWorkflowRunId: 'nested-child' });
  workflow.pi.events.emit('subagent:async-complete', { id: 'nested-root', state: 'complete' });
  workflow.pi.events.emit('subagent:async-complete', { id: 'nested-child', state: 'complete' });
  assert.equal(workflow.monitor.statusFor(['nested-root']), 'active', 'a child cannot settle its running descendants');
  workflow.pi.events.emit('subagent:async-complete', { id: 'grandchild', state: 'complete' });
  assert.equal(workflow.monitor.statusFor(['nested-root']), 'idle', 'nested completion propagates to every owning ancestor');

  workflow.pi.events.emit('subagent:async-complete', { id: 'results-only', state: 'complete', results: [{ runId: 'results-only-child', state: 'running' }] });
  assert.equal(workflow.monitor.statusFor(['results-only']), 'active', 'running result references work without a launch event');
  workflow.pi.events.emit('subagent:async-complete', { id: 'results-only-child', state: 'complete' });
  assert.equal(workflow.monitor.statusFor(['results-only']), 'idle');
  workflow.pi.events.emit('subagent:async-complete', { id: 'anonymous-results', state: 'complete', results: [{ state: 'running' }] });
  assert.equal(workflow.monitor.statusFor(['anonymous-results']), 'active');
  tick(0); workflow.reply(undefined, { fleet: { totalActive: 0 }, asyncSnapshot: { runs: [{ id: 'anonymous-results', state: 'complete' }] } });
  assert.equal(workflow.monitor.statusFor(['anonymous-results']), 'active', 'absent anonymous descendants also remain unresolved');
  workflow.monitor.refresh(); workflow.reply(undefined, { fleet: { totalActive: 0 }, asyncSnapshot: { runs: [{ id: 'anonymous-results', state: 'complete', children: [{ id: 'reported-child', state: 'complete' }] }] } });
  assert.equal(workflow.monitor.statusFor(['anonymous-results']), 'idle', 'a full terminal descendant snapshot resolves an anonymous result');

  workflow.pi.events.emit('subagent:async-complete', { id: 'key-only-results', state: 'complete', results: [{ workflowKey: 'key-only-lane', state: 'running' }] });
  tick(0); workflow.reply(undefined, { fleet: { totalActive: 0 }, asyncSnapshot: { runs: [{ id: 'key-only-results', state: 'complete', children: [{ id: 'key-only-lane', state: 'complete' }] }] } });
  assert.equal(workflow.monitor.statusFor(['key-only-results']), 'idle', 'matching workflow keys resolve results without a run ID');
  workflow.pi.events.emit('subagent:async-complete', { id: 'anonymous-nested', state: 'complete', results: [{ state: 'complete', children: [{ state: 'running' }] }] });
  assert.equal(workflow.monitor.statusFor(['anonymous-nested']), 'active', 'anonymous nested completion results retain running descendants');
  tick(0); workflow.reply(undefined, { fleet: { totalActive: 0 }, asyncSnapshot: { runs: [{ id: 'self-step', state: 'complete', children: [{ id: 'self-step', kind: 'step', state: 'complete' }] }] } });
  assert.equal(workflow.monitor.statusFor(['self-step']), 'idle', 'a self-named step does not create a dependency cycle');

  // A provider may answer synchronously on the process-local bus.
  const synchronous = make(['subagent']);
  synchronous.pi.events.on('subagents:rpc:v1:request', request => synchronous.reply(request));
  synchronous.monitor.refresh(); assert.equal(synchronous.monitor.current(), 'idle');
  tick(1000); assert.equal(synchronous.monitor.current(), 'idle');
  synchronous.monitor.refresh(); const last = synchronous.requests.at(-1);
  const traffic = synchronous.requests.length;
  synchronous.pi.events.emit('subagent:child-status', {});
  const beforeDispose = synchronous.changes.length;
  synchronous.monitor.dispose(); synchronous.monitor.dispose();
  synchronous.reply(last, { fleet: { totalActive: 9 } });
  synchronous.pi.events.emit('subagent:async-started', {});
  tick(2000);
  assert.equal(synchronous.requests.length, traffic);
  assert.equal(synchronous.changes.length, beforeDispose, 'dispose cancels timers and callbacks');
  assert.equal([...synchronous.bus.entries()].filter(([key]) => key.startsWith('subagents:rpc:v1:reply:')).reduce((sum, [, handlers]) => sum + handlers.size, 0), 0);
  console.log('work strip subagents: scoped root runs, provider load order, read-only status, deferred events, timeout, stale replies, snapshots and disposal passed');
} finally {
  fixtures.forEach(({ monitor }) => monitor.dispose());
  assert.equal(timers.size, 0, 'all monitor timers are released');
  globalThis.setTimeout = nativeSetTimeout; globalThis.clearTimeout = nativeClearTimeout;
}
