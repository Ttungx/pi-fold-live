import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

type Status = 'idle' | 'active' | 'unknown';
const requestEvent = 'subagents:rpc:v1:request';
const replyPrefix = 'subagents:rpc:v1:reply:';
const terminalStates = new Set(['complete', 'completed', 'failed', 'partial', 'stopped', 'rejected']);
let nextRequest = 0;
const unfinished = (node: any): boolean => !node || !terminalStates.has(node.state)
  || node.children !== undefined && (!Array.isArray(node.children) || node.children.some(unfinished));
const runId = (event: any): string | undefined => {
  const id = typeof event?.id === 'string' && event.id.trim() ? event.id : undefined;
  const run = typeof event?.runId === 'string' && event.runId.trim() ? event.runId : undefined;
  return event?.childId !== undefined || id && run && id !== run ? undefined : id || run;
};
const completionState = (event: any): string | undefined => {
  if (event?.stopped === true) return 'stopped';
  const state = event?.state ?? event?.status;
  if (state === 'paused' || state === 'blocked' || event?.interrupted === true || event?.success === false && event?.exitCode === 0) return 'paused';
  return state ?? (typeof event?.success === 'boolean' ? event.success ? 'complete' : 'failed' : undefined);
};

function replyStatus(data: any): Status {
  const active = data?.fleet?.totalActive;
  if (!Number.isSafeInteger(active) || active < 0) return 'unknown';
  if (active > 0) return 'active';
  const snapshot = data?.asyncSnapshot;
  if (snapshot === undefined) return 'idle';
  if (!snapshot || !Array.isArray(snapshot.runs)) return 'unknown';
  if (snapshot.runs.some(unfinished)) return 'active';
  if (snapshot.omitted?.runs > 0 || snapshot.omitted?.children > 0 || snapshot.omitted?.byteLimitExceeded === true) return 'unknown';
  return 'idle';
}

/** Observe child status through the provider's read-only RPC bus. Missing evidence
 * keeps a work strip open; this monitor never starts or controls a child. */
export function monitorWorkStripSubagents(pi: ExtensionAPI, onChange: () => void): {
  hasProvider(): boolean;
  current(): Status;
  statusFor(ids: readonly string[]): Status;
  refresh(): void;
  reset(): void;
  dispose(): void;
} {
  let provider = false, seenProvider = false, disposed = false, generation = 0;
  let status: Status = 'idle';
  type Child = { runId?: string; key?: string; status: Status };
  const runs = new Map<string, Status>(), descendants = new Map<string, Map<string, Child>>();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let deferred: ReturnType<typeof setTimeout> | undefined;
  let unsubscribeReply: (() => void) | undefined;
  const set = (value: Status, available = provider, recordsChanged = false) => {
    const changed = recordsChanged || value !== status || available !== provider;
    status = value; provider = available;
    if (changed && !disposed) onChange();
  };
  const record = (id: string, value: Status): boolean => {
    const changed = runs.get(id) !== value;
    runs.set(id, value); return changed;
  };
  const childMap = (parent: string) => {
    let children = descendants.get(parent);
    if (!children) { children = new Map(); descendants.set(parent, children); }
    return children;
  };
  const recordChild = (parent: string, id: string, child: Child): boolean => {
    const children = childMap(parent), previous = children.get(id);
    if (child.key) for (const [key, known] of children) if (key !== id && (known.key === child.key || known.runId === child.key)) children.delete(key);
    const next = { ...previous, ...child };
    const changed = previous?.runId !== next.runId || previous?.key !== next.key || previous?.status !== next.status;
    children.set(id, next); return changed;
  };
  const stateStatus = (state: any): Status => typeof state !== 'string' ? 'unknown' : terminalStates.has(state) ? 'idle' : 'active';
  const resultStatus = (child: any): Status => {
    const values = [stateStatus(completionState(child))];
    if (Array.isArray(child?.children)) values.push(...child.children.map(resultStatus));
    else if (child?.children !== undefined) values.push('unknown');
    return values.includes('active') ? 'active' : values.includes('unknown') ? 'unknown' : 'idle';
  };
  const recordResults = (parent: string, results: any): boolean => {
    if (results === undefined) return false;
    if (!Array.isArray(results)) return recordChild(parent, 'invalid-results', { status: 'unknown' });
    let changed = false;
    results.forEach((child: any, index: number) => {
      const id = typeof child?.runId === 'string' && child.runId.trim() ? child.runId : undefined;
      const key = typeof child?.workflowKey === 'string' && child.workflowKey.trim() ? child.workflowKey : undefined;
      const value = stateStatus(completionState(child));
      if (id && !runs.has(id)) changed = record(id, value) || changed;
      changed = recordChild(parent, id ? `run:${id}` : key ? `key:${key}` : `anonymous:${index}`, { runId: id, key, status: id ? value : resultStatus(child) }) || changed;
      if (id && child?.children !== undefined) changed = recordResults(id, child.children) || changed;
    });
    return changed;
  };
  const recordSnapshot = (data: any): boolean => {
    let changed = false;
    if (!Number.isSafeInteger(data?.fleet?.totalActive) || data.fleet.totalActive < 0 || !Array.isArray(data?.asyncSnapshot?.runs)) return false;
    // Step IDs do not create root records. They can update a child already linked
    // by its launch or workflow result. Dispatch completion does not settle children.
    for (const root of data.asyncSnapshot.runs) {
      if (typeof root?.id !== 'string' || !root.id.trim()) continue;
      changed = record(root.id, stateStatus(root.state)) || changed;
      if (root.children !== undefined && !Array.isArray(root.children)) {
        changed = recordChild(root.id, 'invalid-children', { status: 'unknown' }) || changed;
        continue;
      }
      const visit = (node: any, path: string) => {
        const nodeId = typeof node?.id === 'string' && node.id.trim() ? node.id : undefined;
        const linkedEntry = [...childMap(root.id)].find(([, child]) => child.runId === nodeId || child.key === nodeId);
        const linked = linkedEntry?.[1];
        const id = linked?.runId || nodeId;
        const value = stateStatus(node?.state);
        if (id && runs.has(id)) changed = record(id, value) || changed;
        changed = recordChild(root.id, linkedEntry?.[0] || (id ? `run:${id}` : `snapshot:${path}`), { runId: id === root.id ? undefined : id, key: linked?.key, status: value }) || changed;
        if (Array.isArray(node?.children)) node.children.forEach((child: any, index: number) => visit(child, `${path}:${index}`));
        else if (node?.children !== undefined) changed = recordChild(root.id, `invalid:${path}`, { status: 'unknown' }) || changed;
      };
      root.children?.forEach((child: any, index: number) => visit(child, String(index)));
      const omitted = data.asyncSnapshot.omitted;
      if (root.children?.length && !unfinished(root) && !(omitted?.runs > 0 || omitted?.children > 0 || omitted?.byteLimitExceeded)) {
        // A full terminal descendant tree can resolve an anonymous dispatch result.
        for (const [key, child] of childMap(root.id)) if (key.startsWith('anonymous:') || key === 'invalid-results' || key === 'invalid-children') changed = recordChild(root.id, key, { ...child, status: 'idle' }) || changed;
      }
    }
    return changed;
  };
  const runStatus = (id: string, visited = new Set<string>()): Status => {
    if (visited.has(id)) return 'unknown';
    const next = new Set(visited); next.add(id);
    const values: Status[] = [runs.get(id) || 'unknown'];
    for (const child of descendants.get(id)?.values() || []) values.push(child.runId && runs.has(child.runId) ? runStatus(child.runId, next) : child.status);
    return values.includes('active') ? 'active' : values.includes('unknown') ? 'unknown' : 'idle';
  };
  const statusFor = (ids: readonly string[]): Status => {
    if (!ids.length) return 'idle';
    const values = ids.map(id => runStatus(id));
    return values.includes('active') ? 'active' : values.includes('unknown') ? 'unknown' : 'idle';
  };
  const detect = () => {
    try { return seenProvider || pi.getAllTools().some(tool => /^(subagent|subagents)$/.test(tool.name)); }
    catch { return seenProvider || provider; }
  };
  const cancelRequest = () => {
    generation++;
    if (timeout) clearTimeout(timeout);
    timeout = undefined;
    unsubscribeReply?.(); unsubscribeReply = undefined;
  };
  const cancelDeferred = () => {
    if (deferred) clearTimeout(deferred);
    deferred = undefined;
  };
  const refresh = () => {
    if (disposed) return;
    cancelDeferred(); cancelRequest();
    if (!detect()) { set('idle', false); return; }
    set('unknown', true);
    const ownGeneration = generation, requestId = `compact-work-strip-${Date.now()}-${++nextRequest}`;
    const finish = (value: Status, recordsChanged = false) => {
      if (disposed || generation !== ownGeneration) return;
      cancelRequest(); set(value, provider, recordsChanged);
    };
    const off = pi.events.on(`${replyPrefix}${requestId}`, (reply: any) => {
      if (reply?.requestId !== requestId || disposed || generation !== ownGeneration) return;
      const valid = reply.version === 1 && reply.method === 'status' && reply.success === true;
      finish(valid ? replyStatus(reply.data) : 'unknown', valid && recordSnapshot(reply.data));
    });
    unsubscribeReply = typeof off === 'function' ? off : undefined;
    timeout = setTimeout(() => finish('unknown'), 1000);
    timeout.unref?.();
    try {
      pi.events.emit(requestEvent, { version: 1, requestId, method: 'status', params: {}, source: { extension: 'pi-fold' } });
    } catch { finish('unknown'); }
  };
  const scheduleRefresh = (recordsChanged = false) => {
    if (disposed) return;
    seenProvider = true;
    cancelRequest();
    set(status === 'active' ? 'active' : 'unknown', true, recordsChanged);
    if (deferred) return;
    deferred = setTimeout(() => { deferred = undefined; refresh(); }, 0);
    deferred.unref?.();
  };
  const subscriptions = [
    pi.events.on('subagent:async-started', (event: any) => {
      if (disposed) return;
      seenProvider = true;
      const id = runId(event);
      let changed = id ? record(id, 'active') : false;
      if (id) descendants.delete(id);
      if (id && typeof event?.parentWorkflowRunId === 'string' && event.parentWorkflowRunId.trim()) changed = recordChild(event.parentWorkflowRunId, `run:${id}`, { runId: id, key: event.workflowKey, status: 'active' }) || changed;
      cancelDeferred(); cancelRequest(); set('active', true, changed);
    }),
    pi.events.on('subagent:async-complete', (event: any) => {
      if (disposed) return;
      const id = runId(event);
      const state = completionState(event);
      let changed = false;
      if (id && typeof state === 'string') {
        changed = record(id, stateStatus(state));
        changed = recordResults(id, event.results) || changed;
      }
      scheduleRefresh(changed);
    }),
    ...['subagent:child-status', 'subagent:process-terminal', 'subagents:rpc:v1:ready'].map(event => pi.events.on(event, () => scheduleRefresh())),
  ];
  const reset = () => {
    if (disposed) return;
    cancelDeferred(); cancelRequest();
    const recordsChanged = runs.size > 0 || descendants.size > 0;
    runs.clear(); descendants.clear();
    refresh();
    if (recordsChanged && !disposed) onChange();
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelDeferred(); cancelRequest();
    subscriptions.forEach(off => { if (typeof off === 'function') off(); });
  };
  reset();
  return { hasProvider: () => provider, current: () => status, statusFor, refresh, reset, dispose };
}
