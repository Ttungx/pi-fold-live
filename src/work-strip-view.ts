import { Box, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import { activityRow, cardContentWidth, finalReplyRendering } from './display-card.ts';

/** Shared with inspection. Canonical native children stay untouched. */
export const projectedChildren = Symbol.for('compact-renderer:projected-children:v1');
export const workEvidenceType = 'compact-renderer:work-settled:v1';
/** Native reply rendering, unchanged. The transient marker is the only addition:
 * workflow and inspection adapters must not re-own a reply the work strip already
 * projects. Native gutters, backgrounds, images and OSC zones stay byte-identical. */
export function renderFinalReply(row: any, width: number, theme: any): string[] {
  const marker = Object.getOwnPropertyDescriptor(row, finalReplyRendering);
  row[finalReplyRendering] = true;
  try { return row.render(width); } finally {
    if (marker) Object.defineProperty(row, finalReplyRendering, marker); else delete row[finalReplyRendering];
  }
}
/** Native Box owns both rendering and mouse-coordinate translation. */
export class WorkChild extends Box {
  private inset = 2;
  constructor(row: any) { super(2, 0); this.addChild(row); }
  render(width: number) {
    const padding = width >= 8 ? 2 : 0;
    if (this.inset !== padding) { this.inset = padding; this.setPaddingX(padding); }
    return super.render(width);
  }
}
export type WorkEvidence = { version: 1; userId: string; finalId: string; endId: string; startedAt: number; endedAt: number; outcome: 'completed' | 'interrupted' | 'error' };

export function workSummary(value: unknown): string {
  if (typeof value !== 'string') return '';
  const text = value.slice(0, 1024).replace(/^[\s#>*`_-]+/, '').replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim();
  return truncateToWidth(text.match(/^.*?[.!?。！？](?:\s|$)/u)?.[0]?.trim() || text, 100, '…');
}

export function workDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds >= 3600 ? `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m` : seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}

/** Completion evidence refers only to entries on this branch. No prose inference. */
export function recordedWorkEvidence(entries: readonly any[]): Map<string, WorkEvidence> {
  const result = new Map<string, WorkEvidence>(), positions = new Map(entries.map((entry, index) => [entry.id, index]));
  for (const [index, entry] of entries.entries()) {
    const d = entry?.data;
    if (entry?.type !== 'custom' || entry.customType !== workEvidenceType || d?.version !== 1 || !['completed', 'interrupted', 'error'].includes(d.outcome)) continue;
    const start = positions.get(d.userId), final = positions.get(d.finalId), end = positions.get(d.endId);
    if (start === undefined || final === undefined || end === undefined || start >= final || final > end || end >= index) continue;
    if (entries[start].message?.role !== 'user' || entries[final].message?.role !== 'assistant') continue;
    const message = entries[final].message;
    if (!Array.isArray(message.content) || !message.content.some((b: any) => b?.type === 'text' && typeof b.text === 'string' && /\S/.test(b.text))) continue;
    if (d.outcome === 'completed' && message.stopReason !== 'stop') continue;
    if (entries.slice(final + 1, end + 1).some(e => e.message?.role === 'assistant')) continue;
    if (entries.slice(start + 1, end + 1).some(e => e.message?.role === 'user')) continue;
    if (!Number.isFinite(d.startedAt) || !Number.isFinite(d.endedAt) || d.startedAt < 0 || d.endedAt < d.startedAt) continue;
    result.set(d.userId, d);
  }
  return result;
}

export class WorkStripHeader {
  open = true;
  manual = false;
  focused = false;
  state: 'history' | 'working' | 'waiting' | 'completed' | 'interrupted' | 'error' | 'stopped' = 'history';
  summary = '';
  elapsedMs = 0;
  theme: any;
  private width = 0;
  constructor(private changed: (mouse?: boolean) => void = () => {}) {}
  invalidate() {}
  toggle() { this.manual = true; this.open = !this.open; this.changed(true); }
  expand() { this.manual = true; this.open = true; this.changed(); }
  finish(following: boolean) { if (following && !this.manual && this.state === 'completed') this.open = false; }
  get title() {
    if (this.state === 'completed') return `Worked for ${workDuration(this.elapsedMs)}`;
    if (this.state === 'history') return 'Work details';
    const label = this.state === 'working' ? 'Working' : this.state === 'waiting' ? 'Waiting' : this.state === 'interrupted' ? 'Interrupted' : 'Stopped';
    return `${label} · ${workDuration(this.elapsedMs)}${this.summary ? ` · ${this.summary}` : ''}`;
  }
  render(width: number) {
    this.width = width;
    const label = `${this.open ? '▾' : '▸'} ${this.title}`;
    const remaining = cardContentWidth(width) - visibleWidth(label) - 2;
    const divider = remaining >= 4 ? `  ${'─'.repeat(remaining)}` : '';
    const heading = this.theme ? this.theme.fg(this.state === 'error' ? 'error' : 'muted', label) : label;
    return ['', activityRow(heading + (this.theme ? this.theme.fg('dim', divider) : divider), width, this.theme, this.focused)];
  }
  handleMouse(event: any) {
    if (event.type === 'click' && event.button === 'left' && event.y === 1 && event.x >= 0 && event.x < this.width && !event.ctrl && !event.alt && !event.shift) {
      this.toggle(); return { handled: true, render: true };
    }
  }
}
