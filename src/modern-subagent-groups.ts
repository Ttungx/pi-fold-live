import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { ToolPane, type PaneAction, type PaneContent } from './modern-tool-pane.ts';
import { recordedPaneHeight } from './modern-recorded-pane.ts';
import { recordedValues } from './modern-tool-content.ts';
import { compactSubagent, subagentDecision, subagentTitle } from './modern-subagents.ts';

const short = (name: string) => name.split('__').at(-1) || name;
const clean = (value: unknown) => typeof value === 'string' ? value.slice(0, 72).replace(/[\p{Cc}\p{Cf}]/gu, ' ') : '';
export const hiddenSubagent = Symbol.for('compact-renderer:subagent-hidden:v1');
type Row = { key: string; kind: 'tool' | 'message' | 'entry'; source: any; name?: string; args?: any; result?: any; failed?: boolean; pending?: boolean; revision?: number; raw?: any; group?: ProjectionGroup };
export type ProjectionGroup = { members: Row[]; pane: ToolPane; answered: boolean; signature: string };
export type SubagentView = { pane: ToolPane; hidden: boolean; answered: boolean };
const stamp = (value: any) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : value;
const requestId = (d: any) => typeof d?.requestId === 'string' && d.requestId && (!d.id || d.id === d.requestId) ? d.requestId : undefined;
const textContent = (source: any) => typeof source.content === 'string' || Array.isArray(source.content) && source.content.every((b: any) => b.type === 'text' && typeof b.text === 'string');
const request = (r: Row) => textContent(r.source || {}) && typeof r.source?.details?.agent === 'string' && r.kind === 'message' && r.source.customType === 'subagent_supervisor_request' && ['need_decision', 'interview_request'].includes(r.source.details?.reason) ? requestId(r.source.details) : undefined;
const reply = (r: Row) => textContent(r.result || {}) && r.kind === 'tool' && short(r.name || '') === 'subagent_supervisor' && r.args?.action === 'reply' && !r.failed && !r.pending && (!r.result?.details?.status || ['success', 'ok', 'completed'].includes(r.result.details.status)) && typeof r.result?.details?.replyTo === 'string' && (!r.args.replyTo || r.args.replyTo === r.result.details.replyTo) && (!r.args.requestId || r.args.requestId === r.result.details.replyTo) ? r.result.details.replyTo : undefined;
const answer = (r: Row) => r.kind === 'entry' && r.source.customType === 'subagent_supervisor_reply' && typeof r.source.data?.message === 'string' && typeof r.source.data?.agent === 'string' ? requestId(r.source.data) : undefined;
const agents = (r: Row): string[] => r.kind === 'tool' ? [r.result?.details?.agent ?? r.args?.agent].filter(x => typeof x === 'string') : r.kind === 'entry' ? [r.source.data?.agent].filter(x => typeof x === 'string') : r.source.details?.runs?.map((x: any) => x.agent) || [r.source.details?.agent].filter(x => typeof x === 'string');
const guide = (r: Row) => r.kind === 'tool' && ['subagent', 'subagents'].includes(short(r.name || '')) && r.args?.action === 'guide';
const routine = (r: Row) => {
  const results = r.result?.details?.results;
  if (Array.isArray(results) && results.some((x: any) => !x || x.error || typeof x.exitCode === 'number' && x.exitCode !== 0 || x.detached || x.interrupted || x.timedOut || x.stopped || x.outputPartial || x.turnBudgetExceeded || x.toolBudgetBlocked || x.structuredOutputFailed || x.execution && x.execution.status !== 'completed')) return false;
  if (r.kind === 'tool') return ['subagent', 'subagents'].includes(short(r.name || '')) && ['launch', 'resume', 'status', 'pending', 'list', 'steer', 'guide'].includes(r.args?.action || 'launch') && compactSubagent(r.name || '') && !r.pending && !r.failed && !subagentDecision(r.name || '', r.args) && short(r.name || '') !== 'contact_supervisor' && short(r.name || '') !== 'subagent_supervisor' && !['partial', 'failed'].includes(r.result?.details?.steering?.state) && (!r.result?.details?.status || ['success', 'ok', 'completed'].includes(r.result.details.status)) && !r.result?.content?.some((b: any) => b.type !== 'text');
  const d = r.source.details;
  return r.kind === 'message' && (r.source.customType === 'subagent-notify' && Array.isArray(d?.runs) && d.runs.length > 0 && d.runs.every((x: any) => typeof x.agent === 'string' && x.status === 'completed') || r.source.customType === 'subagent_supervisor_request' && d?.reason === 'progress_update' && typeof d.agent === 'string') && (typeof r.source.content === 'string' || Array.isArray(r.source.content) && r.source.content.every((b: any) => b.type === 'text' && typeof b.text === 'string'));
};
function* primary(r: Row): Generator<PaneContent> {
  const content = r.kind === 'tool' ? r.result?.content : r.kind === 'entry' ? r.source.data?.message : r.source.content;
  if (typeof content === 'string') yield { text: content, format: 'markdown' };
  else for (const block of content || []) if (block.type === 'text' && typeof block.text === 'string') yield { text: block.text, format: 'markdown' };
}
function* exact(r: Row): Generator<PaneContent> {
  if (r.kind === 'tool') { yield { text: 'Arguments', kind: 'section' }; yield* recordedValues(r.args); yield { text: 'Result', kind: 'section' }; yield* recordedValues(r.result); }
  else yield* recordedValues(r.raw || r.source);
}
const action = (r: Row): PaneAction => ({ id: r.key, label: r.kind === 'tool' ? subagentTitle(r.name || '', r.args, r.result, r.failed ? 'failed' : r.pending ? 'pending' : 'success') : r.source.customType === 'subagent-notify' ? `${agents(r).map(clean).join(', ')} · completed` : `${clean(r.source.details?.agent)} · progress update`, sections: () => primary(r), details: () => exact(r) });

/** Presentation projection. Only persisted entry order and public event order create rows.
 * Render callbacks resolve recorded identities; they never append or reorder rows. */
export class SubagentProjection {
  private rows: (Row | null)[] = [];
  private tools = new Map<string, Row>();
  private sources = new WeakMap<object, Row>();
  private details = new WeakMap<object, Row | null>();
  private groups = new Map<string, ProjectionGroup>();
  private serial = 0;
  private boundaries = new WeakSet<object>();
  private dirty = true;
  clear() { this.rows = []; this.tools.clear(); this.sources = new WeakMap(); this.details = new WeakMap(); this.groups.clear(); this.serial = 0; this.boundaries = new WeakSet(); this.dirty = true; }
  private custom(source: any, kind: 'message' | 'entry', key?: string, raw?: any) {
    if (!source || typeof source !== 'object' || this.sources.has(source)) return;
    const existing = kind === 'message' && source.details && this.details.get(source.details);
    if (existing && (!key || key === existing.key) && existing.source.customType === source.customType && stamp(existing.source.timestamp) === stamp(source.timestamp)) { this.sources.set(source, existing); return; }
    const row: Row = { key: key || `live:${++this.serial}`, kind, source, raw };
    this.sources.set(source, row);
    const d = source.details;
    if (kind === 'message' && d && typeof d === 'object') this.details.set(d, this.details.has(d) ? null : row);
    this.rows.push(row); this.dirty = true;
  }
  rebuild(entries: readonly any[]) {
    const previous = this.groups; this.clear(); this.groups = previous;
    for (const entry of entries) {
      if (entry.type === 'message') this.observe(entry.message);
      else if (entry.type === 'custom_message' && entry.display !== false) this.custom({ role: 'custom', customType: entry.customType, content: entry.content, details: entry.details, timestamp: entry.timestamp }, 'message', entry.id, entry);
      else if (entry.type === 'custom' && entry.customType === 'subagent_supervisor_reply') this.custom(entry, 'entry', entry.id);
      else if (['compaction', 'branch_summary', 'custom', 'custom_message'].includes(entry.type) && entry.display !== false) { this.rows.push(null); this.dirty = true; }
    }
  }
  observe(message: any) {
    if (!message || typeof message !== 'object' || message.role === 'custom' && message.display === false) return;
    if (message.role === 'assistant') {
      if (!this.boundaries.has(message) && (message.errorMessage || ['error', 'aborted', 'length'].includes(message.stopReason) || message.content?.some((b: any) => b.type === 'text' && b.text?.trim()))) { this.boundaries.add(message); this.rows.push(null); this.dirty = true; }
      for (const call of message.content || []) if (call.type === 'toolCall') this.start(call.id, call.name, call.arguments);
    } else if (message.role === 'toolResult') this.end(message.toolCallId, message.toolName, message, message.isError);
    else if (message.role === 'custom' && message.display !== false) this.custom(message, 'message');
    else if (message.role !== 'system' && !this.boundaries.has(message)) { this.boundaries.add(message); this.rows.push(null); this.dirty = true; }
  }
  start(id: string, name: string, args?: any) {
    if (!id || !name) return;
    let row = this.tools.get(id);
    if (!row) { row = { key: `tool:${id}`, kind: 'tool', source: undefined, name, args, pending: true }; this.tools.set(id, row); this.rows.push(row); }
    else if (args !== undefined && row.args !== args) { row.args = args; row.revision = (row.revision || 0) + 1; }
    this.dirty = true;
  }
  end(id: string, name: string, result: any, error = false) {
    this.start(id, name); const row = this.tools.get(id); if (!row) return;
    if (row.result !== result || row.failed !== (!!error || !!result?.isError)) row.revision = (row.revision || 0) + 1;
    row.result = result; row.pending = false; row.failed = !!error || !!result?.isError || ['failed', 'partial'].includes(result?.details?.steering?.state); this.dirty = true;
  }
  private regroup() {
    if (!this.dirty) return; this.dirty = false;
    const previous = this.groups; this.groups = new Map();
    for (const row of this.rows) if (row) row.group = undefined;
    const counts = new Map<string, number>(), receipts = new Map<string, number>(), answers = new Map<string, number>();
    for (const row of this.rows) if (row) for (const [id, map] of [[request(row), counts], [reply(row), receipts], [answer(row), answers]] as const) if (id) map.set(id, (map.get(id) || 0) + 1);
    const group = (members: Row[], answered: boolean) => {
      if (members.length < 2) return;
      const key = members[0].key, signature = members.map(r => `${r.key}@${r.revision || 0}`).join('|') + `:${answered}`;
      const g = previous.get(key) || { members, pane: new ToolPane([], '', recordedPaneHeight), answered, signature: '' };
      if (g.signature !== signature || members.some((row, index) => row !== g.members[index] || row.result !== g.members[index]?.result)) {
        if (answered) g.pane.actions = [{ id: key, label: 'Decision answered', sections: function* () { const d = members[0].source.details; if (typeof d.requestBody === 'string') yield { text: d.requestBody, format: 'markdown' }; else yield* primary(members[0]); yield { text: 'Supervisor reply', kind: 'section' }; yield { text: members[2].source.data.message, kind: 'answer', format: 'markdown' }; }, details: function* () { for (const row of members) { yield { text: row.kind === 'tool' ? 'Reply delivery' : row.kind === 'entry' ? 'Recorded supervisor reply' : 'Recorded request', kind: 'section' }; yield* exact(row); } } }];
        else g.pane.actions = members.map(action);
        g.pane.reset(); g.signature = signature;
      }
      g.members = members; g.answered = answered;
      const names = [...new Set(members.flatMap(agents).map(clean).filter(Boolean))];
      g.pane.title = answered ? `${clean(members[0].source.details.agent)} · Decision answered` : `Subagents · ${members.length} ${guide(members[0]) ? "guide lookups" : "updates"}${names.length ? ` · ${names.slice(0, 3).join(', ')}${names.length > 3 ? ', …' : ''}` : ''}`;
      g.pane.headingTone = answered ? 'customMessageLabel' : 'mdLink';
      for (const row of members) row.group = g;
      this.groups.set(key, g);
    };
    let run: Row[] = [];
    const flush = () => { group(run, false); run = []; };
    for (let i = 0; i < this.rows.length; i++) {
      const row = this.rows[i], id = row && request(row), ack = this.rows[i + 1], recorded = this.rows[i + 2];
      if (row && id && counts.get(id) === 1 && receipts.get(id) === 1 && answers.get(id) === 1 && ack && recorded && reply(ack) === id && answer(recorded) === id && row.source.details.agent === recorded.source.data.agent && (!row.source.details.runId || row.source.details.runId === recorded.source.data.runId) && [ack.args, ack.result?.details].every(d => (!d?.agent || d.agent === row.source.details.agent) && (!d?.runId || d.runId === row.source.details.runId))) { flush(); group([row, ack, recorded], true); i += 2; }
      else if (row && routine(row)) {
        if (run.length && guide(run[0]) !== guide(row)) flush();
        run.push(row);
      }
      else flush();
    }
    flush();
  }
  viewTool(id: string): SubagentView | undefined { return this.view(this.tools.get(id)); }
  viewSource(source: any): SubagentView | undefined {
    let row = this.sources.get(source);
    const candidate = source?.details && this.details.get(source.details);
    if (!row && candidate && candidate.source.customType === source.customType && stamp(candidate.source.timestamp) === stamp(source.timestamp)) row = candidate;
    return this.view(row);
  }
  private view(row?: Row): SubagentView | undefined { this.regroup(); return row?.group ? { pane: row.group.pane, hidden: row.group.members[0] !== row, answered: row.group.answered } : undefined; }
}

type Shared = { projection: SubagentProjection; sync(): void; release(): void };
const owners = new WeakMap<object, { shared: Shared; count: number }>();
export function acquireSubagentProjection(pi: ExtensionAPI): Shared {
  const found = owners.get(pi); if (found) { found.count++; return found.shared; }
  const projection = new SubagentProjection(); let manager: any, last: any, length = -1, leaf: any = Symbol();
  const sync = () => {
    const nextLeaf = manager?.getLeafId?.();
    if (typeof manager?.getLeafId === 'function' && nextLeaf === leaf) return;
    leaf = nextLeaf;
    const entries = manager?.buildContextEntries?.() ?? manager?.getBranch?.();
    if (!entries || entries.length === length && entries.at(-1) === last) return;
    length = entries.length; last = entries.at(-1); projection.rebuild(entries);
  };
  const subscriptions: (() => void)[] = [];
  const reset = (_event: any, ctx: any) => { manager = ctx.sessionManager; last = undefined; length = -1; leaf = Symbol(); projection.clear(); sync(); };
  for (const event of ['session_start', 'session_tree', 'session_compact']) subscriptions.push((pi.on as any)(event, reset));
  for (const event of ['session_before_switch', 'session_shutdown']) subscriptions.push((pi.on as any)(event, () => { manager = undefined; projection.clear(); length = -1; }));
  for (const event of ['message_start', 'message_update', 'message_end']) subscriptions.push((pi.on as any)(event, (event: any) => { sync(); projection.observe(event.message); }));
  subscriptions.push(pi.on('tool_execution_start', (event: any) => { if (!event.parentToolCallId) { sync(); projection.start(event.toolCallId, event.toolName, event.args); } }));
  subscriptions.push(pi.on('tool_execution_end', (event: any) => { if (!event.parentToolCallId) { sync(); projection.end(event.toolCallId, event.toolName, event.result, event.isError); } }));
  const shared = { projection, sync, release() { const owner = owners.get(pi); if (!owner || --owner.count) return; subscriptions.forEach(off => off?.()); projection.clear(); owners.delete(pi); } };
  owners.set(pi, { shared, count: 1 }); return shared;
}
