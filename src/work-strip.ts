import type { DisplayMode } from './display-mode.ts';
import { AssistantMessageComponent, CustomMessageComponent, InteractiveMode, SkillInvocationMessageComponent, ToolExecutionComponent, UserMessageComponent, type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Container, Spacer, matchesKey } from '@earendil-works/pi-tui';
import { chainNativeMethod } from './native-method-chain.ts';
import { ToolPane } from './modern-tool-pane.ts';
import { recordedPaneHeight } from './modern-recorded-pane.ts';
import { monitorWorkStripSubagents } from './work-strip-subagents.ts';
import { mixedThinkingRegion } from './modern-thinking-adapter.ts';
import { actionIntent } from './action-intent.ts';
import { projectedChildren, recordedWorkEvidence, renderFinalReply, workEvidenceType, workSummary, WorkChild, WorkStripHeader, type WorkEvidence } from './work-strip-view.ts';

type Turn = { user: any; header: WorkStripHeader; rows: any[]; activity?: boolean; evidence?: WorkEvidence; startedAt?: number; settled?: boolean; final?: any; finalReply?: any; outcome?: WorkEvidence['outcome']; completedAt?: number; persisted?: boolean; noFinal?: boolean; children: Set<string> };
const text = (message: any) => typeof message?.content === 'string' ? message.content : Array.isArray(message?.content) ? message.content.filter((b: any) => b?.type === 'text' && typeof b.text === 'string').map((b: any) => b.text).join('\n') : '';
const visibleText = (message: any) => typeof message?.content === 'string' ? message.content : message?.content?.find((b: any) => b?.type === 'text' && typeof b.text === 'string' && /\S/.test(b.text))?.text || '';
const shortName = (name: string) => name.split(/[/:]/).at(-1) || name;
/** Thinking, commentary and a response clock alone are not execution activity. */
export function isWorkActivity(row: any): boolean {
  if (row instanceof ToolExecutionComponent) return true;
  if (row instanceof AssistantMessageComponent) return row.lastMessage?.content?.some((b: any) => b.type === 'toolCall') === true;
  const message = row.message || row.entry;
  return message?.role === 'bashExecution' || /^subagent(?:s?[-_]|$)/.test(message?.customType || '');
}
const descendant = (component: any, target: (c: any) => boolean, seen = new Set<any>()): boolean => {
  if (!component || seen.has(component)) return false;
  seen.add(component);
  return target(component) || (Array.isArray(component.children) && component.children.some((c: any) => descendant(c, target, seen))) || !!component.child && descendant(component.child, target, seen);
};

/** Known decision records always remain outside the work fold, even after an answer. */
export function keepWorkRowVisible(row: any, completed: boolean): boolean {
  if (row instanceof ToolExecutionComponent) {
    const name = shortName(row.toolName);
    if (['ask_user_question', 'contact_supervisor'].includes(name)) return true;
    if (['subagent_supervision', 'subagent_supervisor'].includes(name)) {
      // Recorded reply content remains in the decision entry. Successful tool
      // receipts/status checks are routine activity; unknown operations stay out.
      if (row.result && !row.isPartial && !row.result.isError &&
          ['reply', 'pending', 'status', 'list'].includes(row.args?.action) &&
          (!row.result.details?.status || ['success', 'ok', 'completed'].includes(row.result.details.status))) return false;
      return true;
    }
    return !row.result || row.isPartial || !completed && !!row.result.isError;
  }
  if (row instanceof AssistantMessageComponent) return ['error', 'aborted', 'length'].includes(row.lastMessage?.stopReason);
  const message = row.message || row.entry;
  if (message?.customType) {
    const kind = message.customType;
    if (kind === 'ddd') return message.details?.severity !== 'notice';
    if (kind === 'subagent_supervisor_request') return message.details?.reason !== 'progress_update';
    if (kind === 'subagent_supervisor_reply' || /unanswered|blocked|unhandled|failed|clarification/.test(kind)) return true;
    if (kind === 'subagent-notify') return message.details?.runs?.some((r: any) => r.status !== 'completed') ?? true;
    return !['subagent-incremental-child-notify', 'subagent-wait-subscription'].includes(kind);
  }
  // Native notifications, summaries, unknown extensions and user shell output
  // are not classified from their prose or concealed by this adapter.
  return !(row instanceof Spacer);
}

export interface WorkStripControls {
  dispose(): void;
  setExpanded(open: boolean): boolean;
  isShortcutEnabled(): boolean;
  setShortcutEnabled(enabled: boolean): void;
}

/** Pi 1.3 display seam. The native tree, transcript, execution and Fleet remain
 * authoritative. Only chatContainer's rendered child list is projected. */
export function registerWorkStrip(pi: ExtensionAPI, mode: DisplayMode, version?: string, unavailable?: (reason: string) => void): WorkStripControls {
  const owner = Symbol.for('compact-renderer:work-registration:v1'), shared = globalThis as any;
  shared[owner]?.();
  const proto = InteractiveMode.prototype as any;
  if (!['addMessageToChat', 'handleEvent', 'renderSessionItems'].every(k => typeof proto?.[k] === 'function')) return { dispose() {}, setExpanded: () => false, isShortcutEnabled: () => false, setShortcutEnabled() {} };
  let disposed = false, ctx: any, host: any, attached: any, detachChat: (() => void) | undefined;
  let turns = new Map<any, Turn>(), sources = new WeakMap<any, any>(), hooks = new Map<any, ToolPane>();
  let selected: WorkStripHeader | ToolPane | undefined, input: (() => void) | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  let ticker: ReturnType<typeof setInterval> | undefined, running = false, pendingStart: number | undefined;
  let records: any[] = [], evidence = new Map<string, WorkEvidence>(), messageIds = new Map<any, string>();
  let entryIds = new Set<string>();
  const aliases = new WeakMap<object, string>();
  let ownership = false, replaying = 0;
  let liveStarts = new WeakMap<any, number>();
  const finalViews = new WeakMap<any, any>();
  const childViews = new WeakMap<any, WorkChild>();
  const hookViews = new WeakMap<any, Container>();
  const redraw = () => host?.ui?.requestRender?.();
  const release = () => { if (selected) selected.focused = false; selected = undefined; };
  const publishOwnership = (force = false) => {
    const active = !disposed && !!ctx && !!attached && mode.isEnabled() && current()?.activity === true;
    if (force || active !== ownership) {
      ownership = active;
      pi.events.emit('compact-renderer:work-strip:v1', { version: 1, ownsExecutionStatus: active });
    }
  };
  const readRecords = () => {
    records = ctx?.sessionManager?.getBranch?.() || [];
    messageIds = new Map(records.filter(e => e.type === 'message').map(e => [e.message, e.id]));
    entryIds = new Set(records.map(e => e.id));
    evidence = recordedWorkEvidence(records);
  };
  const idFor = (message: any) => {
    if (!message || typeof message !== 'object') return;
    const known = messageIds.get(message) || aliases.get(message);
    if (known && entryIds.has(known)) return known;
    const sameContent = (a: any, b: any) => a === b || Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((part: any, i: number) => part === b[i] || part?.type === b[i]?.type &&
      (part.type === 'text' ? part.text === b[i].text : part.type === 'thinking' ? part.thinking === b[i].thinking : false));
    const entry = records.find(e => e.type === 'message' && e.message?.role === message.role && Number.isFinite(message.timestamp) && e.message.timestamp === message.timestamp && sameContent(e.message.content, message.content));
    if (entry) aliases.set(message, entry.id);
    return entry?.id;
  };
  const follow = () => host?.ui?.isFollowingOutput === true;
  let latestTurn: Turn | undefined;
  const current = () => latestTurn;
  const monitor = monitorWorkStripSubagents(pi, () => { scheduleFinish(); redraw(); });
  const select = (item: WorkStripHeader | ToolPane, target: any) => {
    release(); selected = item; item.focused = true;
    if (item instanceof WorkStripHeader) item.expand(); else item.open = true;
    redraw();
    pi.events.emit('compact-renderer:focus:v1', { owner: 'work', target: (c: any) => c === target });
  };
  const hookPane = (row: any) => {
    let pane = hooks.get(row);
    if (!pane) {
      const content = text(row.message);
      const summary = workSummary(content);
      pane = new ToolPane([{ id: 'notice', label: 'DDD', repeatedSummary: summary, sections: () => [{ text: content, format: 'markdown' }] }], `DDD · ${summary || 'Recorded notice'}`, recordedPaneHeight);
      pane.directContent = true; pane.headingTone = row.message.details?.severity === 'blocking' ? 'error' : 'muted';
      hooks.set(row, pane);
    }
    pane.theme = ctx?.ui?.theme;
    pane.styleHeader = value => pane!.theme ? pane!.theme.fg(pane!.headingTone, pane!.theme.bold(value)) : value;
    return pane;
  };
  const finalView = (row: any, foldThinking: boolean) => {
    let view = finalViews.get(row);
    if (!view) {
      view = { children: [row], theme: undefined, foldThinking: false, invalidate: () => row.invalidate(), handleMouse: (event: any) => row.handleMouse(event), render(width: number) {
        // Only the known hidden-thinking region is folded. Native reply Markdown,
        // OSC markers, explicit Ctrl+T expansion and unknown shapes are retained.
        const region = this.foldThinking && mixedThinkingRegion(row, row.lastMessage);
        if (!region) return renderFinalReply(row, width, this.theme);
        const container = row.contentContainer, children = container.children;
        const index = children.indexOf(region);
        // The validated native shape places a spacer after hidden thinking
        // when text follows. Remove both, retaining the initial message gap.
        container.children = children.filter((child: any, i: number) => child !== region && !(i === index + 1 && child instanceof Spacer));
        try { return renderFinalReply(row, width, this.theme); } finally { container.children = children; }
      } };
      finalViews.set(row, view);
    }
    view.theme = ctx?.ui?.theme; view.foldThinking = foldThinking;
    return view;
  };
  const childView = (row: any) => {
    let view = childViews.get(row);
    if (!view) { view = new WorkChild(row); childViews.set(row, view); }
    return view;
  };
  const hookView = (row: any) => {
    const pane = hookPane(row);
    let view = hookViews.get(row);
    if (!view || !view.children.includes(pane)) {
      // Preserve CustomMessageComponent's internal leading gap in its compact
      // replacement. Outer transcript spacers are handled independently.
      view = new Container(); view.addChild(new Spacer(1)); view.addChild(pane);
      hookViews.set(row, view);
    }
    return view;
  };
  const scan = (rows: any[]) => {
    let turn: Turn | undefined;
    const present = new Set<any>();
    for (const row of rows) {
      if ((row instanceof UserMessageComponent || row instanceof SkillInvocationMessageComponent) && sources.has(row)) {
        const user = sources.get(row);
        turn = turns.get(user);
        if (!turn) {
          const header = new WorkStripHeader(mouse => { if (mouse) { release(); pi.events.emit('compact-renderer:focus:v1', { owner: 'editor' }); } redraw(); });
          turn = { user, rows: [], header, children: new Set(), startedAt: liveStarts.get(user) };
          turns.set(user, turn);
        }
        turn.rows = []; present.add(user);
        const saved = evidence.get(idFor(user));
        if (saved && !turn.startedAt) { turn.evidence = saved; turn.completedAt = saved.endedAt; turn.outcome = saved.outcome; }
      } else if (turn) {
        turn.rows.push(row);
        if (row instanceof ToolExecutionComponent && ['subagent', 'subagents'].includes(shortName(row.toolName))) {
          const id = row.result?.details?.asyncId || row.args?.async === true && row.result?.details?.runId;
          if (typeof id === 'string') turn.children.add(id);
        }
      }
    }
    latestTurn = turn;
    for (const key of turns.keys()) if (!present.has(key)) turns.delete(key);
    for (const turn of turns.values()) turn.activity = turn.children.size > 0 || turn.rows.some(isWorkActivity);
    publishOwnership();
  };
  const project = (rows: any[]) => {
    scan(rows);
    const starts = new Map<any, Turn>();
    for (const turn of turns.values()) if (turn.rows.length) {
      starts.set(turn.rows[0], turn);
      turn.final = turn.evidence ? turn.rows.find(r => r instanceof AssistantMessageComponent && idFor(r.lastMessage) === turn.evidence!.finalId) : turn.rows.findLast(r => r instanceof AssistantMessageComponent);
      // Replayed terminal replies can use their native turn boundary. Live
      // replies wait for settlement; a text-bearing tool call is still work.
      const settled = !!turn.evidence || (turn.startedAt ? turn.settled && (current() !== turn || !running) &&
        monitor.statusFor([...turn.children]) === 'idle' : true);
      const message = turn.final?.lastMessage;
      turn.finalReply = settled && !turn.final?.isStreaming && visibleText(message) &&
        ['stop', 'error', 'aborted', 'length'].includes(message?.stopReason) &&
        !message.content.some((block: any) => block.type === 'toolCall') ? turn.final : undefined;
    }
    const output: any[] = [];
    let spacing: Spacer[] = [];
    const append = (row: any) => { output.push(...spacing, row); spacing = []; };
    let turn: Turn | undefined;
    for (const row of rows) {
      if (row instanceof UserMessageComponent || row instanceof SkillInvocationMessageComponent) {
        turn = undefined; append(row); continue;
      }
      if (starts.has(row)) {
        turn = starts.get(row)!;
      }
      if (starts.has(row) && turn?.activity) {
        const h = turn.header, saved = turn.evidence;
        h.theme = ctx?.ui?.theme;
        h.state = turn.completedAt ? turn.noFinal ? 'stopped' : turn.outcome || 'completed' : turn.startedAt ? turn.outcome === 'interrupted' ? 'interrupted' : running && current() === turn ? 'working' : 'waiting' : saved?.outcome || 'history';
        // Completed/history titles do not display a summary. Live titles follow
        // the last operation without copying and reversing the turn twice.
        if (h.state !== 'completed' && h.state !== 'history') {
          const operation = turn.rows.findLast(r => r instanceof ToolExecutionComponent || r instanceof AssistantMessageComponent && visibleText(r.lastMessage));
          const assistant = turn.rows.findLast(r => r instanceof AssistantMessageComponent);
          h.summary = operation instanceof ToolExecutionComponent ? actionIntent(operation.toolName, operation.args) : workSummary(visibleText(assistant?.lastMessage));
        }
        h.elapsedMs = saved ? saved.endedAt - saved.startedAt : turn.startedAt ? (turn.completedAt ?? Date.now()) - turn.startedAt : 0;
        h.finish(follow());
        output.push(h);
      }
      // Native outer spacing belongs to the immediately following block, not
      // to the previous turn. Keep it with visible skills, prompts, summaries,
      // and unknown cards; discard it with hidden content. Do not accumulate
      // gaps across hidden blocks or add gaps to internally spaced components.
      if (row instanceof Spacer) { spacing.push(row); continue; }
      if (!turn?.activity || turn.header.open || row === turn.final || keepWorkRowVisible(row, turn.header.state === 'completed')) {
        let view = row instanceof CustomMessageComponent && row.message?.customType === 'ddd' ? hookView(row) : turn && row === turn.finalReply ? finalView(row, !!turn.activity && !turn.header.open) : row;
        // The newest assistant row is only a final candidate until settlement.
        // Keep it and attention rows in the work gutter until final confirmation.
        if (turn?.activity && row !== turn.finalReply && (row instanceof AssistantMessageComponent || isWorkActivity(row) ||
            row instanceof CustomMessageComponent && row.message?.customType === 'ddd')) view = childView(view);
        append(view);
      } else spacing = [];
    }
    if (!turn?.activity || turn.header.open) output.push(...spacing);
    return output;
  };
  const attach = (candidate: any) => {
    if (disposed) return false;
    if (!(candidate?.chatContainer instanceof Container) || !Array.isArray(candidate.chatContainer.children) || typeof candidate.chatContainer.render !== 'function' || !candidate.ui) { unavailable?.('native chat container changed'); return false; }
    if (host !== candidate) { detachChat?.(); host = candidate; attached = undefined; }
    if (attached) return true;
    const chat = candidate.chatContainer;
    detachChat = chainNativeMethod(chat, 'render', function(native, width) {
      if (disposed || !ctx || !mode.isEnabled() || !Array.isArray(this.children)) { delete this[projectedChildren]; return native.call(this, width); }
      const canonical = this.children;
      this[projectedChildren] = project(canonical);
      this.children = this[projectedChildren];
      try { return native.call(this, width); } finally { this.children = canonical; }
    });
    attached = chat;
    return true;
  };
  const detachAdd = chainNativeMethod(proto, 'addMessageToChat', function(native, message, ...args) {
    if (!attach(this)) return native.call(this, message, ...args);
    const before = this.chatContainer.children.length;
    const result = native.call(this, message, ...args);
    for (const row of (Array.isArray(this.chatContainer?.children) ? this.chatContainer.children.slice(before) : [])) if (!(row instanceof Spacer)) sources.set(row, message);
    if (!replaying && running && message.role === 'user') liveStarts.set(message, Date.now());
    return result;
  });
  const detachReplay = chainNativeMethod(proto, 'renderSessionItems', function(native, ...args) { attach(this); replaying++; try { return native.apply(this, args); } finally { replaying--; } });
  const detachEvent = chainNativeMethod(proto, 'handleEvent', function(native, event, ...args) { attach(this); return native.call(this, event, ...args); });

  function scheduleFinish() {
    if (disposed || !ctx) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      if (disposed || !ctx) return;
      if (attached) scan(attached.children);
      readRecords();
      for (const turn of turns.values()) {
        if (!turn.settled || !turn.startedAt || turn.persisted || current() === turn && (running || ctx.isIdle?.() === false)) continue;
        if (!turn.activity) continue;
        if (monitor.statusFor([...turn.children]) !== 'idle') continue;
        const userId = idFor(turn.user), startIndex = records.findIndex(e => e.id === userId);
        if (!userId || startIndex < 0) continue;
        const nextUser = records.findIndex((e, i) => i > startIndex && e.message?.role === 'user');
        const span = records.slice(startIndex + 1, nextUser < 0 ? undefined : nextUser);
        const final = [...span].reverse().find(e => e.type === 'message' && e.message.role === 'assistant');
        if (!final || !visibleText(final.message) || !['stop', 'error', 'aborted', 'length'].includes(final.message.stopReason)) {
          turn.noFinal = true; turn.completedAt = Date.now(); turn.persisted = true;
          continue; // Never promote earlier commentary to a final response.
        }
        const outcome = turn.outcome || (final.message.stopReason === 'error' || final.message.stopReason === 'length' ? 'error' : final.message.stopReason === 'aborted' ? 'interrupted' : 'completed');
        const data: WorkEvidence = { version: 1, userId, finalId: final.id, endId: span.at(-1).id, startedAt: turn.startedAt, endedAt: Date.now(), outcome };
        turn.completedAt = data.endedAt; turn.outcome = outcome; turn.evidence = data; turn.persisted = true;
        // Presentation metadata is excluded from model context. Original messages
        // and tool results are not rewritten.
        pi.appendEntry(workEvidenceType, data);
      }
      readRecords(); redraw();
    }, 100);
  }
  const reset = (_event: any, context: any) => {
    release(); input?.(); input = undefined; ctx = context.mode === 'tui' ? context : undefined;
    running = false; pendingStart = undefined;
    turns.clear(); latestTurn = undefined; hooks.clear(); liveStarts = new WeakMap(); readRecords(); monitor.reset();
    if (timer) clearTimeout(timer); timer = undefined;
    if (ticker) clearInterval(ticker); ticker = undefined;
    if (ctx) {
      input = ctx.ui.onTerminalInput?.((data: string) => {
        if (!selected || !mode.isEnabled()) return;
        if (matchesKey(data, 'escape')) { release(); pi.events.emit('compact-renderer:inspection-ended:v1', {}); redraw(); return { consume: true }; }
        if (selected instanceof WorkStripHeader && matchesKey(data, 'enter')) {
          const header = selected; header.manual = true; header.open = !header.open; redraw(); return { consume: true };
        }
        if (selected instanceof ToolPane && selected.handle(data)) { redraw(); return { consume: true }; }
        release(); pi.events.emit('compact-renderer:inspection-ended:v1', {}); redraw();
      });
      ticker = setInterval(() => { if (running || current()?.header.state === 'waiting') redraw(); }, 1000);
      ticker.unref?.();
    }
    publishOwnership(true); redraw();
  };
  const subscriptions = [
    pi.on('session_start', reset), pi.on('session_tree', (event, context) => { if (running) { readRecords(); redraw(); } else reset(event, context); }), pi.on('session_compact', () => { readRecords(); redraw(); }),
    pi.on('session_before_switch', () => { reset({}, { mode: 'none' }); detachChat?.(); detachChat = undefined; attached = undefined; host = undefined; sources = new WeakMap(); }),
    pi.on('agent_start', () => {
      running = true; pendingStart = Date.now();
      monitor.refresh(); redraw();
    }),
    pi.on('message_start', (event: any) => {
      if (event.message?.role !== 'assistant' || !running || !attached) return;
      scan(attached.children);
      const turn = current();
      if (turn) {
        turn.startedAt ??= pendingStart ?? Date.now(); turn.settled = false;
        turn.completedAt = undefined; turn.evidence = undefined; turn.persisted = false; turn.outcome = undefined; turn.noFinal = false;
      }
      redraw();
    }),
    pi.on('message_end', () => { readRecords(); redraw(); }),
    pi.on('agent_settled', (event: any) => {
      running = false; readRecords(); if (attached) scan(attached.children);
      for (const turn of turns.values()) if (turn.startedAt && !turn.completedAt) turn.settled = true;
      if (event.aborted && current()) current()!.outcome = 'interrupted';
      monitor.refresh(); scheduleFinish(); redraw();
    }),
    pi.events.on('subagent:async-started', (event: any) => {
      if (!ctx || !attached || typeof event?.id !== 'string' || event.parentWorkflowRunId) return;
      const sessionId = ctx.sessionManager?.getSessionId?.();
      if (event.sessionId && sessionId && event.sessionId !== sessionId) return;
      scan(attached.children); current()?.children.add(event.id); redraw();
    }),
    pi.on('ui_prompt_start', release),
    mode.onChange(() => { release(); if (attached && !mode.isEnabled()) delete attached[projectedChildren]; publishOwnership(); redraw(); }),
    pi.events.on('compact-renderer:work-strip-query:v1', () => publishOwnership(true)),
    pi.events.on('compact-renderer:focus:v1', (event: any) => {
      if (event?.owner !== 'work') release();
      if (typeof event?.target === 'function' && mode.isEnabled()) {
        for (const turn of turns.values()) if (turn.activity && turn.rows.some(row => descendant(row, event.target))) turn.header.expand();
        redraw();
      }
    }),
    pi.events.on('compact-renderer:inspect:v1', (request: any) => {
      if (!ctx || !mode.isEnabled()) return;
      for (const [index, turn] of [...turns.values()].entries()) if (turn.activity) request?.add?.({ id: `work-${index}`, kind: 'Work', label: turn.header.title, focus: () => select(turn.header, turn.header) });
      for (const [row, pane] of hooks) request?.add?.({ id: `hook-${[...hooks.keys()].indexOf(row)}`, kind: 'Hook', label: pane.title, focus: () => select(pane, pane) });
    }),
  ];
  // Use native shortcut dispatch so dialogs and editor input keep their owners.
  // The command remains available on terminals that do not send modified keys.
  let shortcut = true;
  const nestedDisclosures = (eligible: Turn[]) => {
    const resets = new Set<() => void>();
    let visibleOpen = false;
    const add = (target: (component: any) => boolean, open: boolean, collapse: () => void) => {
      for (const turn of eligible) for (const row of turn.rows) if (descendant(row, target)) {
        resets.add(collapse);
        if (open && (turn.header.open || row === turn.final || keepWorkRowVisible(row, turn.header.state === 'completed'))) visibleOpen = true;
      }
    };
    // Owners identify and reset their own panes. Never alter native disclosure properties.
    pi.events.emit('compact-renderer:disclosures:v1', { add });
    for (const [row, pane] of hooks) add(component => component === row, pane.open, () => pane.collapse());
    return { visibleOpen, collapse: () => resets.forEach(reset => reset()) };
  };
  const setAll = (open: boolean) => {
    if (disposed || !ctx || !mode.isEnabled() || !attached) return false;
    project(attached.children);
    release();
    const eligible = [...turns.values()].filter(turn => turn.activity && !['working', 'waiting'].includes(turn.header.state));
    if (!open) nestedDisclosures(eligible).collapse();
    for (const turn of turns.values()) {
      if (!turn.activity || !open && ['working', 'waiting'].includes(turn.header.state)) continue;
      turn.header.manual = true; turn.header.open = open;
    }
    pi.events.emit('compact-renderer:inspection-ended:v1', {});
    redraw();
    return true;
  };
  const toggleCompleted = () => {
    if (disposed || !ctx || !mode.isEnabled() || !attached) return false;
    project(attached.children);
    const eligible = [...turns.values()].filter(turn => turn.activity && !['working', 'waiting'].includes(turn.header.state));
    if (!eligible.length) return true;
    const nested = nestedDisclosures(eligible);
    const open = !eligible.some(turn => turn.header.open) && !nested.visibleOpen;
    release();
    if (!open) nested.collapse();
    for (const turn of eligible) { turn.header.manual = true; turn.header.open = open; }
    pi.events.emit('compact-renderer:inspection-ended:v1', {});
    redraw();
    return true;
  };
  pi.registerShortcut?.('ctrl+alt+w', {
    description: 'Toggle completed work sections (enabled with /fold shortcut)',
    handler: () => { if (shortcut) toggleCompleted(); },
  });
  const dispose = () => {
    if (disposed) return; disposed = true;
    release(); input?.(); if (timer) clearTimeout(timer); if (ticker) clearInterval(ticker);
    monitor.dispose(); subscriptions.forEach(off => off?.());
    if (attached) delete attached[projectedChildren];
    detachChat?.(); detachEvent(); detachReplay(); detachAdd();
    publishOwnership(true); redraw(); turns.clear(); latestTurn = undefined; hooks.clear(); ctx = undefined;
    if (shared[owner] === dispose) delete shared[owner];
  };
  subscriptions.push(pi.on('session_shutdown', dispose));
  shared[owner] = dispose;
  return {
    dispose,
    setExpanded: setAll,
    isShortcutEnabled: () => shortcut,
    setShortcutEnabled: enabled => { if (!disposed) shortcut = enabled; },
  };
}
