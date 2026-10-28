import type { DisplayMode } from './display-mode.ts';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import * as Pi from '@earendil-works/pi-coding-agent';
import * as Tui from '@earendil-works/pi-tui';
import { ToolPane, type PaneContent } from './modern-tool-pane.ts';
import { recordedPaneHeight } from './modern-recorded-pane.ts';
import { acquireSubagentProjection, hiddenSubagent } from './modern-subagent-groups.ts';
import { installSubagentSpacingAdapter } from './modern-subagent-spacing.ts';
import { recordedValues } from './modern-tool-content.ts';
import { activityHeading } from './display-card.ts';

const { ExtensionRunner, VERSION } = Pi;
const { matchesKey, truncateToWidth } = Tui;

type Summary = { title: string; tone: string };
const record = (value: any) => value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown) => typeof value === 'string' ? truncateToWidth(value.slice(0, 512).replace(/[\p{Cc}\p{Cf}]/gu, ' '), 90, '…') : '';
const statuses = new Set(['completed', 'failed', 'paused', 'stopped']);
const messageTypes = new Set(['subagent_supervisor_request', 'subagent-notify', 'subagent_steering_notice', 'subagent_control_notice', 'subagent-supervisor-unanswered', 'subagent-supervisor-blocked', 'subagent-completion-unanswered', 'subagent-completion-unhandled', 'subagent-workflow-result-write-failed', 'subagent-incremental-child-notify', 'subagent-wait-subscription', 'subagent_watchdog_clarification']);

/** Headlines use recorded metadata. Queue acceptance never implies delivery. */
export function subagentMessageSummary(source: any, entry = false): Summary | undefined {
  const d = entry ? source?.data : source?.details;
  const named = (title: string, tone = 'mdLink') => ({ title: `Subagent · ${title}`, tone });
  if (entry) {
    if (source?.customType === 'subagent_supervisor_reply' && record(d) && typeof d.message === 'string' && typeof d.agent === 'string' && typeof d.requestId === 'string') return named(`reply sent to ${text(d.agent)}`);
    return;
  }
  switch (source?.customType) {
    case 'subagent_supervisor_request':
      if (!record(d) || typeof d.agent !== 'string' || !['need_decision', 'interview_request', 'progress_update'].includes(d.reason)) return;
      return named(`${text(d.agent)} · ${d.reason === 'need_decision' ? 'needs a decision' : d.reason === 'interview_request' ? 'asks for structured answers' : 'progress update'}`, d.reason === 'progress_update' ? 'mdLink' : 'customMessageLabel');
    case 'subagent-notify': {
      if (!record(d) || !Array.isArray(d.runs) || !d.runs.length || !d.runs.every((r: any) => record(r) && typeof r.agent === 'string' && statuses.has(r.status))) return;
      const failed = d.runs.some((r: any) => r.status === 'failed');
      return named(d.runs.length === 1 ? `${text(d.runs[0].agent)} · ${d.runs[0].status}` : `${d.runs.length} runs · ${['completed', 'failed', 'paused', 'stopped'].map(s => [s, d.runs.filter((r: any) => r.status === s).length]).filter(([, n]) => n).map(([s, n]) => `${n} ${s}`).join(' · ')}`, failed ? 'error' : 'mdLink');
    }
    case 'subagent_steering_notice':
      if (!record(d) || typeof d.runId !== 'string' || !['failed', 'partial', 'recovered'].includes(d.state)) return;
      return named(`steering ${d.state} · ${text(d.runId)}`, d.state === 'recovered' ? 'mdLink' : 'error');
    case 'subagent_control_notice':
      if (!record(d?.event) || typeof d.event.agent !== 'string' || d.event.type !== 'needs_attention') return;
      return named(`${text(d.event.agent)} · needs attention`, 'customMessageLabel');
    case 'subagent-supervisor-unanswered': return named('supervisor requests unanswered', 'customMessageLabel');
    case 'subagent-supervisor-blocked': return named('supervisor requests blocked', 'error');
    case 'subagent-completion-unanswered': return named('completion results unanswered');
    case 'subagent-completion-unhandled': return named('completion results unhandled', 'error');
    case 'subagent-workflow-result-write-failed': return named('workflow result save failed', 'error');
    case 'subagent-incremental-child-notify':
      if (!record(d) || typeof d.childKey !== 'string' || !statuses.has(d.outcome)) return;
      return named(`workflow child ${text(d.childKey)} · ${d.outcome}`, d.outcome === 'failed' ? 'error' : 'mdLink');
    case 'subagent-wait-subscription':
      if (!record(d) || typeof d.runId !== 'string' || typeof d.outcome !== 'string') return;
      return named(`wait · ${text(d.runId)} · ${text(d.outcome)}`, ['failed', 'error'].includes(d.outcome) ? 'error' : 'mdLink');
    case 'subagent_watchdog_clarification': return named('watchdog needs clarification', 'customMessageLabel');
  }
}

/** Pi 1.3 resolver seam. Keep each extension's original renderer as the fallback.
 * Registering another message renderer cannot delegate through Pi's first-match registry. */
export function installSubagentMessageAdapter(wrap: (native: any, entry: boolean) => any, _version = VERSION): (() => void) | undefined {
  const proto = ExtensionRunner?.prototype as any;
  if (!proto || !['getMessageRenderer', 'getEntryRenderer'].every(k => typeof proto[k] === 'function')) return;
  const owner = Symbol.for('compact-renderer:subagent-message-adapter:v1');
  proto[owner]?.();
  const message = proto.getMessageRenderer, entry = proto.getEntryRenderer;
  let disposed = false;
  const messages = function(this: any, ...args: any[]) { const native = message.apply(this, args); return !disposed && native && messageTypes.has(args[0]) ? wrap(native, false) : native; };
  const entries = function(this: any, ...args: any[]) { const native = entry.apply(this, args); return !disposed && native && args[0] === 'subagent_supervisor_reply' ? wrap(native, true) : native; };
  const dispose = () => {
    if (disposed) return; disposed = true;
    if (proto.getMessageRenderer === messages) proto.getMessageRenderer = message;
    if (proto.getEntryRenderer === entries) proto.getEntryRenderer = entry;
    if (proto[owner] === dispose) delete proto[owner];
  };
  proto.getMessageRenderer = messages; proto.getEntryRenderer = entries; proto[owner] = dispose;
  return dispose;
}

type Card = { source: any; entry: boolean; pane: ToolPane; component?: any; expanded: boolean; summary: Summary };
function* content(source: any, entry: boolean): Generator<PaneContent> {
  if (entry) { yield { text: source.data.message, format: 'markdown' }; return; }
  if (typeof source.content === 'string') yield { text: source.content, format: 'markdown' };
  else for (const part of source.content || []) if (part?.type === 'text' && typeof part.text === 'string') yield { text: part.text, format: 'markdown' };
}

/** Display only. Native execution, Fleet, messages, entries and wake routing stay authoritative. */
export function registerModernSubagentMessages(pi: ExtensionAPI, mode: DisplayMode): () => void {
  const owner = Symbol.for('compact-renderer:subagent-message-registration:v1'), shared = globalThis as any;
  shared[owner]?.();
  const proto = ExtensionRunner?.prototype as any;
  if (!proto || !['getMessageRenderer', 'getEntryRenderer'].every(key => typeof proto[key] === 'function') ||
      typeof pi.on !== 'function' || typeof pi.events?.on !== 'function' || typeof pi.events?.emit !== 'function' ||
      ![matchesKey, truncateToWidth].every(value => typeof value === 'function')) return () => {};
  const spacing = installSubagentSpacingAdapter();
  if (!spacing) return () => {};
  const subagents = acquireSubagentProjection(pi);
  let cards = new Map<any, Card>(), selected: Card | undefined, focused = false, active = false, disposed = false;
  let input: (() => void) | undefined, redraw: (() => void) | undefined;
  const release = (preserveAnchor = false) => { if (focused && selected) { (view(selected.source)?.pane || selected.pane).focused = false; if (!preserveAnchor) (view(selected.source)?.pane || selected.pane).releaseInspection(); } focused = false; };
  const view = (source: any) => { subagents.sync(); return subagents.projection.viewSource(source); };
  const adapter = installSubagentMessageAdapter((native, entry) => {
    return (source: any, options: any, theme: any) => {
      const summary = subagentMessageSummary(source, entry);
      const supportedContent = entry || typeof source.content === 'string' || Array.isArray(source.content) && source.content.every((part: any) => part?.type === 'text' && typeof part.text === 'string');
      if (disposed || !active || !mode.isEnabled() || !summary || !supportedContent) return native(source, options, theme);
      let card = cards.get(source);
      if (!card) {
        const pane = new ToolPane([{ id: 'notice', label: summary.title, sections: () => content(source, entry), details: () => recordedValues(entry ? source.data : source.details) }], summary.title, recordedPaneHeight);
        card = { source, entry, pane, expanded: options.expanded, summary }; pane.open = options.expanded;
        cards.set(source, card); if (options.expanded && view(source)) view(source)!.pane.open = true;
      }
      if (card.expanded !== options.expanded) { card.expanded = options.expanded; card.pane.open = options.expanded; card.pane.reset(); const projected = view(source); if (projected) { projected.pane.open = options.expanded; projected.pane.reset(); } }
      card.summary = summary;
      let fallback: any;
      const current = card;
      const projectedPane = () => view(source)?.pane || current.pane;
      const component = {
        [hiddenSubagent]: () => !disposed && active && mode.isEnabled() && !!view(source)?.hidden,
        render(width: number) {
          if (disposed || !active || !mode.isEnabled() || cards.get(source) !== current) { fallback ??= native(source, options, theme); return fallback?.render(width) || []; }
          const projected = view(source);
          if (projected?.hidden) return [];
          const pane = projectedPane();
          if (!projected) { pane.title = current.summary.title; pane.headingTone = current.summary.tone; }
          pane.theme = theme; pane.styleHeader = line => activityHeading(line, theme, pane.headingTone);
          pane.focused = focused && selected === current;
          if (pane.focused) pane.open = true;
          return pane.render(width);
        },
        handleMouse(event: any) {
          if (disposed || !active || !mode.isEnabled() || cards.get(source) !== current) { fallback ??= native(source, options, theme); return fallback?.handleMouse?.(event); }
          if (view(source)?.hidden) return;
          const handled = projectedPane().handleMouse(event);
          if (handled?.handled && handled.render !== false) { release(true); pi.events.emit('compact-renderer:focus:v1', { owner: 'editor' }); redraw?.(); }
          return handled;
        },
        invalidate() { projectedPane().invalidate(); fallback?.invalidate?.(); },
      };
      card.component = component;
      return component;
    };
  });
  const stop = () => { active = false; release(); input?.(); input = undefined; cards.clear(); selected = undefined; redraw = undefined; };
  const reset = (_event: unknown, ctx: any) => {
    stop();
    if (disposed || !adapter || ctx.mode !== 'tui') return;
    active = true;
    redraw = typeof ctx.ui.setHiddenThinkingLabel === 'function' ? () => ctx.ui.setHiddenThinkingLabel() : undefined;
    input = ctx.ui.onTerminalInput?.((data: string) => {
      if (!active || !mode.isEnabled() || !focused || !selected || cards.get(selected.source) !== selected) return;
      if (matchesKey(data, 'escape')) { release(); pi.events.emit('compact-renderer:inspection-ended:v1', { owner: 'subagents' }); redraw?.(); return { consume: true }; }
      if ((view(selected.source)?.pane || selected.pane).handle(data)) { redraw?.(); return { consume: true }; }
      release(); pi.events.emit('compact-renderer:inspection-ended:v1', { owner: 'subagents' }); redraw?.();
    });
  };
  const subscriptions: (() => void)[] = [];
  for (const event of ['session_start', 'session_tree', 'session_compact'] as const) subscriptions.push(pi.on(event, reset));
  subscriptions.push(pi.on('session_before_switch', stop), pi.on('session_shutdown', stop), pi.on('ui_prompt_start', () => release()));
  subscriptions.push(pi.events.on('compact-renderer:focus:v1', (event: any) => { if (event?.owner !== 'subagents') release(); }));
  subscriptions.push(pi.events.on('compact-renderer:disclosures:v1', (request: any) => {
    if (disposed || !active || !mode.isEnabled()) return;
    for (const card of cards.values()) {
      const projected = view(card.source);
      if (projected?.hidden) continue;
      const pane = projected?.pane || card.pane;
      request?.add?.((component: any) => component === card.component, pane.open, () => {
        if (selected === card) { release(); selected = undefined; }
        pane.collapse();
        if (pane !== card.pane) card.pane.collapse();
      });
    }
  }));
  subscriptions.push(pi.events.on('compact-renderer:inspect:v1', (request: any) => {
    if (disposed || !active || !mode.isEnabled()) return;
    [...cards.values()].filter(card => !view(card.source)?.hidden).forEach((card, index) => request?.add?.({ id: `subagent-${index}`, kind: 'Subagent', label: view(card.source)?.pane.title || card.summary.title, focus() {
      if (disposed || !active || !mode.isEnabled() || cards.get(card.source) !== card) return;
      release(); selected = card; focused = true; (view(card.source)?.pane || card.pane).open = true; redraw?.();
      pi.events.emit('compact-renderer:focus:v1', { owner: 'subagents', label: card.summary.title, target: (component: any) => component === card.component });
    } }));
  }));
  subscriptions.push(mode.onChange(() => { release(); redraw?.(); }));
  const dispose = () => { if (disposed) return; disposed = true; subscriptions.forEach(off => off?.()); const repaint = redraw; stop(); adapter?.(); spacing?.(); subagents.release(); if (shared[owner] === dispose) delete shared[owner]; repaint?.(); };
  shared[owner] = dispose;
  return dispose;
}
