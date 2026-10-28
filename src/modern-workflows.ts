import type { DisplayMode } from './display-mode.ts';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import * as Pi from '@earendil-works/pi-coding-agent';
import * as Tui from '@earendil-works/pi-tui';
import { activityRow, cardContentWidth, finalReplyRendering } from './display-card.ts';
import { richTextRows } from './modern-rich-text.ts';
import { recordedPaneHeight } from './modern-recorded-pane.ts';
import { chainNativeMethod } from './native-method-chain.ts';

const { AssistantMessageComponent, VERSION } = Pi;
const { Container, Markdown, MouseRegion, Spacer, Text, matchesKey, truncateToWidth } = Tui;

export type WorkflowFence = { start: number; end: number; source: string; summary: string };
const summaryText = (value: string) => truncateToWidth(value.slice(0, 1024).replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim(), 90, '…');

/** Recognize complete, top-level tagged fences only. Other fences shield their bodies.
 * Scan once per recorded text revision; formatting is separate and viewport-bounded. */
export function modernWorkflowFences(text: string): WorkflowFence[] {
  const fences: WorkflowFence[] = [];
  let offset = 0, open: { marker: string; start: number; body: number; workflow: boolean } | undefined;
  while (offset < text.length) {
    const newline = text.indexOf('\n', offset), end = newline < 0 ? text.length : newline;
    const line = text.slice(offset, end).replace(/\r$/, '');
    if (!open) {
      const marker = /^(`{3,}|~{3,})/.exec(line);
      if (marker) open = { marker: marker[1], start: offset, body: newline < 0 ? end : end + 1, workflow: /^```(?:js|javascript) workflow[ \t]*$/.test(line) };
    } else {
      const close = /^(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (close && close[1][0] === open.marker[0] && close[1].length >= open.marker.length) {
        if (open.workflow && close[1] === '```') {
          const source = text.slice(open.body, offset);
          if (source.trim()) {
            const comment = /^\s*\/\/[^\S\r\n]*([^\r\n]+)/.exec(source.slice(0, 1024))?.[1];
            const prose = text.slice(Math.max(0, open.start - 1024), open.start).trim().split(/\r?\n\s*\r?\n/).at(-1) || '';
            fences.push({ start: open.start, end: newline < 0 ? end : end + 1, source, summary: summaryText(comment || prose) || 'Recorded JavaScript' });
          }
        }
        open = undefined;
      }
    }
    if (newline < 0) break;
    offset = end + 1;
  }
  return fences;
}

/** Lazy source viewport. Neither highlighting nor wrapping receives the full script. */
export class WorkflowPane {
  open = false; focused = false; offset = 0; paintedRows = 0;
  theme?: any;
  private rows: string[] = []; private iterator?: Iterator<string>; private done = false;
  private width = 0; private themeKey = ''; private lastWidth = 0; private lastHeight = 0; private lastBodyHeight = 0; private lastMore = false;
  constructor(readonly source: string, readonly summary: string, private release: () => void = () => {}) {}
  collapse() { this.open = false; this.focused = false; this.offset = 0; this.invalidate(); }
  invalidate() { this.rows = []; this.iterator = undefined; this.done = false; this.width = 0; }
  handle(data: string) {
    if (matchesKey(data, 'enter')) { this.open = !this.open; this.offset = 0; return true; }
    if (matchesKey(data, 'home')) { this.open = true; this.offset = 0; return true; }
    for (const key of ['up', 'down', 'pageUp', 'pageDown'] as const) if (matchesKey(data, key)) {
      const distance = key === 'pageUp' || key === 'pageDown' ? recordedPaneHeight() : 1;
      this.open = true; this.offset = Math.max(0, this.offset + (key === 'down' || key === 'pageDown' ? distance : -distance)); return true;
    }
    return false;
  }
  render(width: number) {
    this.lastWidth = width;
    const theme = this.theme;
    const inner = cardContentWidth(width), indent = inner >= 4 ? '  ' : '', sourceWidth = Math.max(1, inner - indent.length);
    const themeKey = ['syntaxKeyword', 'syntaxString', 'syntaxComment', 'syntaxNumber', 'syntaxFunction', 'syntaxOperator', 'syntaxPunctuation', 'syntaxType', 'syntaxVariable', 'mdCodeBlock'].map(token => theme?.fg(token, 'x') ?? 'x').join('');
    if (this.width !== sourceWidth || themeKey !== this.themeKey) { this.invalidate(); this.width = sourceWidth; this.themeKey = themeKey; this.offset = 0; }
    const label = `${this.open ? '▾' : '▸'} Subagent workflow`;
    const rows = [activityRow(theme ? theme.fg('mdLink', theme.bold(label)) + theme.fg('muted', ` · ${this.summary}`) : `${label} · ${this.summary}`, width, theme, this.focused)];
    this.lastBodyHeight = 0; this.lastMore = false;
    if (this.open) {
      this.iterator ??= richTextRows(this.source, sourceWidth, { format: 'code', language: 'javascript' });
      const height = recordedPaneHeight();
      this.offset = Math.min(this.offset, this.rows.length);
      while (!this.done && this.rows.length <= this.offset + height) {
        const row = this.iterator.next();
        if (row.done) this.done = true;
        else { this.rows.push(row.value); this.paintedRows++; }
      }
      if (this.done) this.offset = Math.min(this.offset, Math.max(0, this.rows.length - height));
      rows.push(...this.rows.slice(this.offset, this.offset + height).map(row => activityRow(indent + row, width, theme)));
      const more = !this.done || this.offset + height < this.rows.length;
      this.lastBodyHeight = rows.length - 1; this.lastMore = more;
      const hint = [more ? 'more ↓' : this.offset > 0 ? 'more ↑' : '', this.focused ? 'Enter collapse · ↑/↓ scroll · Home start · Esc release' : ''].filter(Boolean).join(' · ');
      if (hint) rows.push(activityRow(theme ? theme.fg('muted', hint) : hint, width, theme));
    }
    this.lastHeight = rows.length;
    return rows;
  }
  handleMouse(event: any) {
    if (event.x < 0 || event.x >= this.lastWidth || event.y < 0 || event.y >= this.lastHeight) return;
    if (event.type === 'wheel' && this.open && Number.isFinite(event.wheelDelta) && event.wheelDelta) {
      this.release(); this.offset = Math.max(0, this.offset + Math.max(-20, Math.min(20, Math.trunc(event.wheelDelta)))); return { handled: true };
    }
    if (event.type === 'click' && event.button === 'left' && !event.ctrl && !event.alt && !event.shift) {
      if (event.y === 0) { this.release(); this.open = !this.open; this.offset = 0; return { handled: true }; }
      if (this.open && (this.lastMore || this.offset > 0) && event.y === this.lastHeight - 1) { this.release(); this.offset = Math.max(0, this.offset + (this.lastMore ? 1 : -1) * Math.max(1, this.lastBodyHeight)); return { handled: true }; }
    }
  }
}

type Card = { id: number; component: any; sources: string[]; fences: WorkflowFence[][]; panes: Map<string, WorkflowPane>; displays: Map<any, InstanceType<typeof Container>> };

/** The public Markdown transformer cannot return components or identify a card.
 * This isolated 1.3.0 seam substitutes display children only during native render.
 * Native messages, Markdown sources, updateContent, and execution remain untouched. */
export function registerModernWorkflows(pi: ExtensionAPI, mode: DisplayMode, _version = VERSION): () => void {
  const owner = Symbol.for('compact-renderer:workflow-registration:v1'), shared = globalThis as any;
  shared[owner]?.();
  const proto = AssistantMessageComponent?.prototype as any;
  if (![Container, Markdown, MouseRegion, Spacer, Text, matchesKey, truncateToWidth].every(value => typeof value === 'function') ||
      !proto || typeof proto.render !== 'function' || typeof proto.updateContent !== 'function' ||
      typeof pi.on !== 'function' || typeof pi.events?.on !== 'function' || typeof pi.events?.emit !== 'function') return () => {};
  const cards = new Map<any, Card>();
  let active = false, disposed = false, selected: WorkflowPane | undefined, uiTheme: any, nextCard = 0;
  let input: (() => void) | undefined, redraw: (() => void) | undefined;
  const release = () => { if (selected) selected.focused = false; selected = undefined; };
  const mouseRelease = () => { release(); pi.events.emit('compact-renderer:focus:v1', { owner: 'editor' }); };
  const clear = () => { release(); cards.clear(); input?.(); input = undefined; redraw = undefined; active = false; };
  const supported = (component: any): any[] | undefined => {
    const message = component.lastMessage, container = component.contentContainer;
    if (component[finalReplyRendering] || component.isStreaming !== false || message?.role !== 'assistant' || !Array.isArray(message.content) || !Array.isArray(component.children) || component.children.length !== 1 || component.children[0] !== container || container?.constructor !== Container || !Array.isArray(container.children)) return;
    if (!container.children.every((child: any) => child instanceof Markdown || child instanceof Spacer || child instanceof Text || child instanceof MouseRegion && (child.child instanceof Markdown || child.child instanceof Text))) return;
    const text = message.content.filter((block: any) => block.type === 'text' && typeof block.text === 'string' && block.text.trim()).map((block: any) => block.text.trim());
    const markdown = container.children.filter((child: any) => child instanceof Markdown);
    if (text.length !== markdown.length || markdown.some((child: any, index: number) => child.text !== text[index] || typeof child.options?.transform !== 'function' || child.paddingY !== 0)) return;
    return markdown;
  };
  const renderWrapper = function(this: any, nativeRender: (...args: any[]) => any, width: number) {
    const markdown = !disposed && active && mode.isEnabled() ? supported(this) : undefined;
    if (!markdown) { const old = cards.get(this); if (old && [...old.panes.values()].includes(selected!)) release(); cards.delete(this); return nativeRender.call(this, width); }
    const sources = markdown.map((child: any) => child.text);
    let card = cards.get(this);
    if (!card || sources.length !== card.sources.length || sources.some((source: string, index: number) => source !== card!.sources[index])) {
      if (card && [...card.panes.values()].includes(selected!)) release();
      card = { id: nextCard++, component: this, sources, fences: sources.map(modernWorkflowFences), panes: new Map(), displays: new Map() };
      cards.set(this, card);
    }
    if ([...card.displays.keys()].some(child => !markdown.includes(child))) card.displays.clear();
    for (const [blockIndex, child] of markdown.entries()) if (!card.displays.has(child)) {
      const fences = card.fences[blockIndex];
      if (!fences.length) continue;
      const display = new Container(); let offset = 0;
      fences.forEach((fence, index) => {
        const prose = child.text.slice(offset, fence.start);
        if (prose.trim()) display.addChild(new Markdown(prose, child.paddingX, 0, child.theme, child.defaultTextStyle, child.options));
        // Native redraws rebuild Markdown children. Preserve per-fence UI state.
        const key = `${blockIndex}:${index}`;
        let pane = card!.panes.get(key);
        if (!pane) { pane = new WorkflowPane(fence.source, fence.summary, mouseRelease); card!.panes.set(key, pane); }
        display.addChild(pane); offset = fence.end;
      });
      const tail = child.text.slice(offset);
      if (tail.trim()) display.addChild(new Markdown(tail, child.paddingX, 0, child.theme, child.defaultTextStyle, child.options));
      card.displays.set(child, display);
    }
    const container = this.contentContainer, original = container.children;
    for (const pane of card.panes.values()) pane.theme = uiTheme;
    for (const [native, display] of card.displays) for (const child of display.children) if (child instanceof Markdown) {
      const padding = Math.min(native.paddingX, Math.max(0, Math.floor((width - 1) / 2)));
      if ((child as any).paddingX !== padding) { (child as any).paddingX = padding; child.invalidate(); }
    }
    container.children = original.map((child: any) => card!.displays.get(child) || child);
    try { return nativeRender.call(this, width); }
    finally { container.children = original; }
  };
  const mouseWrapper = function(this: any, nativeMouse: (...args: any[]) => any, event: any) {
    if (!disposed && active && mode.isEnabled() && supported(this)) return nativeMouse?.call(this, event);
    // Do not dispatch stale temporary display children after a native fallback.
    if (this.contentContainer) this.contentContainer.mouseLayout = undefined;
    return nativeMouse?.call(this, event);
  };
  const detachRender = chainNativeMethod(proto, 'render', renderWrapper);
  const detachMouse = chainNativeMethod(proto, 'handleMouse', mouseWrapper);
  const reset = (_event: any, ctx: any) => {
    clear(); if (disposed || ctx.mode !== 'tui') return;
    active = true;
    uiTheme = ctx.ui.theme;
    redraw = typeof ctx.ui.setHiddenThinkingLabel === 'function' ? () => ctx.ui.setHiddenThinkingLabel() : undefined;
    input = ctx.ui.onTerminalInput?.((data: string) => {
      if (!selected || !mode.isEnabled()) { release(); return; }
      if (matchesKey(data, 'escape')) { release(); pi.events.emit('compact-renderer:inspection-ended:v1', {}); redraw?.(); return { consume: true }; }
      if (selected.handle(data)) { redraw?.(); return { consume: true }; }
      release(); pi.events.emit('compact-renderer:inspection-ended:v1', {}); redraw?.();
    });
    redraw?.();
  };
  const subscriptions: (() => void)[] = [];
  for (const event of ['session_start', 'session_tree', 'session_compact'] as const) subscriptions.push(pi.on(event, reset));
  subscriptions.push(pi.on('session_before_switch', clear), pi.on('session_shutdown', clear), pi.on('ui_prompt_start', release));
  subscriptions.push(pi.events.on('compact-renderer:focus:v1', (event: any) => { if (event?.owner !== 'workflows') release(); }));
  subscriptions.push(pi.events.on('compact-renderer:disclosures:v1', (request: any) => {
    if (disposed || !active || !mode.isEnabled()) return;
    for (const card of cards.values()) for (const pane of card.panes.values()) request?.add?.((component: any) => component === card.component, pane.open, () => {
      if (selected === pane) release();
      pane.collapse();
    });
  }));
  subscriptions.push(pi.events.on('compact-renderer:inspect:v1', (request: any) => {
    if (disposed || !active || !mode.isEnabled()) return;
    for (const card of cards.values()) card.panes.forEach((pane, index) => request?.add?.({ id: `workflow-${card.id}-${index}`, kind: 'Workflow', label: pane.summary, focus() {
      if (disposed || !active || !mode.isEnabled() || cards.get(card.component) !== card || !supported(card.component)) return;
      release(); selected = pane; pane.focused = true; pane.open = true; redraw?.();
      pi.events.emit('compact-renderer:focus:v1', { owner: 'workflows', label: 'Subagent workflow', target: (component: any) => component === card.component });
    } }));
  }));
  subscriptions.push(mode.onChange(() => { release(); redraw?.(); }));
  const dispose = () => {
    if (disposed) return; disposed = true; clear(); subscriptions.forEach(off => off?.());
    detachMouse(); detachRender();
    if (shared[owner] === dispose) delete shared[owner];
  };
  shared[owner] = dispose;
  return dispose;
}
