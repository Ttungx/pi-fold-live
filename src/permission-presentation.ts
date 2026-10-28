import { getKeybindings, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component } from '@earendil-works/pi-tui';
import type { DisplayMode } from './display-mode.ts';
import { cardContentWidth, activityRow } from './display-card.ts';

/** Shared with approval owners. This channel carries presentation, never policy. */
export const PERMISSION_PRESENTATION_EVENT = 'pi:permission-presentation:v1';
export interface PermissionPresentationRequest {
  version: 1;
  action: string;
  target: string;
  reason: string;
  /** Complete caller-provided input, including its existing redaction. */
  details: string;
  ui: { custom: (factory: (...args: any[]) => Component) => Promise<unknown> };
  mode: 'tui';
  signal?: AbortSignal;
  /** Only the first synchronous offer wins; offering must not open a dialog. */
  offer(present: () => Promise<boolean>): boolean;
}

// JSON details already escape input controls. Escape any actual terminal controls
// in labels or future callers, so untrusted text cannot inject terminal commands.
const safe = (text: string) => text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g,
  value => `\\u${value.charCodeAt(0).toString(16).padStart(4, '0')}`).replace(/\t/g, '    ');

type Cursor = { offset: number; fragment: number };
/** An offset viewport, not an eagerly wrapped document. Chunk segmentation and
 * painting depend on viewport size. Full arguments remain reachable by paging. */
export class PermissionDetailsViewport {
  readonly length: number;
  workUnits = 0;
  private cursor: Cursor = { offset: 0, fragment: 0 };
  private next: Cursor = this.cursor;
  private previous: Array<{ cursor: Cursor; next: Cursor; width: number; height: number }> = [];
  private layout = { width: 80, height: 8 };
  private tokens = new Map<number, string>();
  private cached?: { key: string; rows: string[] };
  private readonly segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  constructor(private parts: string[]) { this.length = parts.reduce((sum, part) => sum + part.length, 0); }
  private slice(start: number, length: number) {
    let result = '';
    for (const part of this.parts) {
      if (start >= part.length) { start -= part.length; continue; }
      const piece = part.slice(start, start + length - result.length);
      result += piece;
      start = 0;
      if (result.length >= length) break;
    }
    this.workUnits += result.length;
    return result;
  }
  private token(offset: number) {
    if (!this.tokens.has(offset)) {
      let chunk = this.slice(offset, 256);
      if (/[\uD800-\uDBFF]$/.test(chunk) && offset + chunk.length < this.length) chunk = chunk.slice(0, -1);
      this.tokens.clear();
      for (const item of this.segmenter.segment(chunk)) {
        if (item.segment === '\r\n') {
          this.tokens.set(offset + item.index, '\r'); this.tokens.set(offset + item.index + 1, '\n');
        } else this.tokens.set(offset + item.index, item.segment);
      }
    }
    return this.tokens.get(offset) ?? '';
  }
  render(width: number, height: number) {
    width = Math.max(1, width); height = Math.max(1, height);
    this.layout = { width, height };
    const key = `${width}/${height}/${this.cursor.offset}/${this.cursor.fragment}`;
    if (this.cached?.key === key) return this.cached.rows;
    const cursor = { ...this.cursor }, rows: string[] = [];
    let line = '', columns = 0, consumed = 0;
    const budget = Math.max(256, Math.min(8192, width * height * 4));
    while (cursor.offset < this.length && rows.length < height && consumed < budget) {
      const token = this.token(cursor.offset);
      if (!token) break;
      if (token === '\n') {
        rows.push(line); line = ''; columns = 0; cursor.offset++; consumed++; continue;
      }
      const escaped = safe(token), text = escaped.slice(cursor.fragment), size = visibleWidth(text);
      if (size > width && escaped !== token) {
        const piece = text.slice(0, width - columns);
        line += piece; columns += piece.length; cursor.fragment += piece.length;
        if (cursor.fragment === escaped.length) { cursor.offset += token.length; consumed += token.length; cursor.fragment = 0; }
      } else {
        if (size > width - columns && columns > 0) { rows.push(line); line = ''; columns = 0; continue; }
        // A one-column terminal cannot paint a two-column glyph. Keep its exact
        // source and use a visible marker; widening restores the recorded glyph.
        line += size > width ? '…' : text;
        columns += Math.min(size, width); cursor.offset += token.length; consumed += token.length; cursor.fragment = 0;
      }
      if (columns >= width) {
        rows.push(line); line = ''; columns = 0;
        if (cursor.offset < this.length && this.token(cursor.offset) === '\n') { cursor.offset++; consumed++; }
      }
    }
    if (line || !rows.length) rows.push(line);
    this.next = cursor;
    this.cached = { key, rows };
    return rows;
  }
  get range() { return { start: this.cursor.offset, end: this.next.offset, total: this.length }; }
  pageDown() {
    if (this.next.offset >= this.length || this.next.offset === this.cursor.offset && this.next.fragment === this.cursor.fragment) return;
    this.previous.push({ cursor: { ...this.cursor }, next: { ...this.next }, ...this.layout }); this.cursor = { ...this.next };
  }
  pageUp() {
    const previous = this.previous.at(-1);
    if (previous && previous.width === this.layout.width && previous.height === this.layout.height
      && previous.next.offset === this.cursor.offset && previous.next.fragment === this.cursor.fragment) {
      this.cursor = this.previous.pop()!.cursor;
    } else {
      this.previous = [];
      this.cursor = this.seekBackward(this.cursor, this.layout.width, this.layout.height);
    }
  }
  home() { this.cursor = { offset: 0, fragment: 0 }; this.previous = []; }
  private seekBackward(from: Cursor, width: number, height: number): Cursor {
    let offset = from.offset, fragment = 0, rows = 1, columns = 0, scanned = 0;
    if (from.fragment) {
      if (from.fragment >= width * height) return { offset, fragment: from.fragment - width * height };
      rows = Math.floor((from.fragment - 1) / width) + 1;
      columns = (from.fragment - 1) % width + 1;
    } else if (offset > 0 && this.slice(offset - 1, 1) === '\n') {
      // The newline terminates the preceding row; it is not an empty row at
      // the beginning of the current viewport.
      offset--; scanned++;
    }
    const budget = Math.max(256, Math.min(8192, width * height * 4));
    while (offset > 0 && scanned < budget) {
      const tail = this.slice(Math.max(0, offset - 2), Math.min(2, offset));
      const chars = [...tail], char = chars.at(-1)!;
      scanned += char.length;
      if (char === '\n') { if (rows >= height) break; rows++; columns = 0; }
      else {
        const size = Math.max(0, visibleWidth(safe(char)));
        if (size > width && safe(char) !== char) {
          const addedRows = Math.floor((columns + size - 1) / width);
          if (rows + addedRows > height) {
            fragment = size - ((height - rows + 1) * width - columns);
            offset -= char.length;
            break;
          }
          rows += addedRows; columns = (columns + size - 1) % width + 1;
        }
        else if (columns + size > width) { if (rows >= height) break; rows++; columns = Math.min(size, width); }
        else columns += size;
      }
      offset -= char.length;
    }
    return { offset, fragment };
  }
  end(width: number, height: number) {
    this.layout = { width: Math.max(1, width), height: Math.max(1, height) };
    this.previous = [];
    this.cursor = this.seekBackward({ offset: this.length, fragment: 0 }, this.layout.width, this.layout.height);
  }
}

export class PermissionDialog implements Component {
  private selected = 1; // Explicit denial is the safe default for Enter.
  private detailsOpen = false;
  readonly detailsViewport: PermissionDetailsViewport;
  private width = 80;
  private settled = false;
  private pageSize = 8;
  constructor(private request: Pick<PermissionPresentationRequest, 'action' | 'target' | 'reason' | 'details'>,
    private theme: any, private redraw: () => void, private done: (allow: boolean) => void,
    private availableRows: () => number = () => 24) {
    this.detailsViewport = new PermissionDetailsViewport([request.details, '\n\nFull action:\n', request.action,
      '\n\nFull target:\n', request.target, '\n\nFull reason:\n', request.reason]);
  }

  finish(allow: boolean) {
    if (this.settled) return;
    this.settled = true;
    this.done(allow);
  }
  dispose() { this.finish(false); }
  invalidate() {}
  render(width: number) {
    width = Math.max(1, Math.floor(width));
    const outerWidth = width;
    width = cardContentWidth(width);
    this.width = width;
    const fg = (color: string, value: string) => this.theme.fg(color, value);
    const lines = (value: string) => wrapTextWithAnsi(safe(value), width).map(row => truncateToWidth(row, width, ''));
    let shortened = false;
    const field = (label: string, value: string) => {
      const limit = Math.min(256, width * 2);
      const wrapped = lines(`${label}: ${value.slice(0, limit)}`);
      const cut = value.length > limit || wrapped.length > 2;
      shortened ||= cut;
      const result = wrapped.slice(0, 2);
      if (cut) result[result.length - 1] = truncateToWidth(result.at(-1)!, Math.max(0, width - 1), '') + '…';
      return result;
    };
    const rows = [fg('accent', truncateToWidth('Approval required', width)),
      ...field('Action', this.request.action), ...field('Target', this.request.target), ...field('Reason', this.request.reason)];
    let selectedRow = -1;
    if (shortened) rows.push(...lines('Summary shortened; full text in Details.'));
    const hints = lines('↑↓ choose · Enter select · Esc deny · d Details');
    if (this.detailsOpen) hints.push(...lines('←/→ page Details · Home/End'));
    const availableRows = this.availableRows();
    // Leave room for the choices and at least one Details row before adding space.
    const padded = rows.length + 3 + hints.length + (this.detailsOpen ? 2 : 0) + 4 <= availableRows;
    if (padded) { rows.unshift(''); rows.push(''); }
    for (const [index, title] of ['Allow once', 'Deny', `${this.detailsOpen ? 'Hide' : 'Show'} Details`].entries()) {
      if (index === this.selected) selectedRow = rows.length;
      const label = truncateToWidth(`${index === this.selected ? '→' : ' '} ${title}`, width, '');
      rows.push(fg(index === this.selected ? 'accent' : 'text', index === this.selected && this.theme.bold ? this.theme.bold(label) : label));
    }
    this.pageSize = Math.max(1, Math.min(8, availableRows - rows.length - hints.length - 1 - (padded ? 2 : 0)));
    if (this.detailsOpen) {
      const body = this.detailsViewport.render(width, this.pageSize);
      const range = this.detailsViewport.range;
      rows.push(fg('muted', truncateToWidth(`Details · text offset ${range.start}–${range.end}/${range.total}`, width)), ...body);
    }
    if (padded) rows.push('');
    rows.push(...hints.map(row => fg('muted', row)));
    if (padded) rows.push('');
    return rows.map((row, index) => activityRow(fg('text', row), outerWidth, this.theme, index === selectedRow));
  }
  handleInput(data: string) {
    if (this.settled) return;
    const kb = getKeybindings();
    if (kb.matches(data, 'tui.select.cancel') || matchesKey(data, 'ctrl+c')) { this.finish(false); return; }
    if (data === 'd') this.detailsOpen = !this.detailsOpen;
    else if (kb.matches(data, 'tui.select.up') || data === 'k') this.selected = Math.max(0, this.selected - 1);
    else if (kb.matches(data, 'tui.select.down') || data === 'j') this.selected = Math.min(2, this.selected + 1);
    else if (kb.matches(data, 'tui.select.confirm') || data === '\n') {
      if (this.selected === 2) this.detailsOpen = !this.detailsOpen;
      else { this.finish(this.selected === 0); return; }
    // Fullscreen Pi consumes PgUp/PgDn in its first input listener, before any
    // extension listener or custom component. Plain arrows reach this dialog.
    } else if (this.detailsOpen && (matchesKey(data, 'left') || matchesKey(data, 'pageup'))) this.detailsViewport.pageUp();
    else if (this.detailsOpen && (matchesKey(data, 'right') || matchesKey(data, 'pagedown'))) this.detailsViewport.pageDown();
    else if (this.detailsOpen && matchesKey(data, 'home')) this.detailsViewport.home();
    else if (this.detailsOpen && matchesKey(data, 'end')) this.detailsViewport.end(this.width, this.pageSize);
    else return;
    this.redraw();
  }
}

function compatible(value: any): value is PermissionPresentationRequest {
  return value?.version === 1 && value.mode === 'tui' && ['action', 'target', 'reason', 'details'].every(key => typeof value[key] === 'string')
    && typeof value.offer === 'function' && typeof value.ui?.custom === 'function'
    && (!value.signal || (typeof value.signal.addEventListener === 'function' && typeof value.signal.removeEventListener === 'function'));
}

export function registerPermissionPresentation(pi: any, mode: DisplayMode): () => void {
  if (typeof pi.events?.on !== 'function') return () => {};
  let disposed = false;
  const active = new Set<() => void>();
  const cancelAll = () => { for (const cancel of [...active]) cancel(); };
  const unsubscribe = pi.events.on(PERMISSION_PRESENTATION_EVENT, (request: unknown) => {
    if (disposed || !mode.isEnabled() || !compatible(request)) return;
    request.offer(async () => {
      if (disposed || !mode.isEnabled() || request.signal?.aborted) return false;
      let dialog: PermissionDialog | undefined;
      let cancelled = false;
      const cancel = () => { cancelled = true; dialog?.finish(false); };
      active.add(cancel);
      request.signal?.addEventListener('abort', cancel, { once: true });
      try {
        const result = await request.ui.custom((tui, theme, _keys, done) => {
          dialog = new PermissionDialog(request, theme, () => tui.requestRender(), done, () => tui.terminal?.rows ?? 24);
          if (cancelled || request.signal?.aborted || disposed || !mode.isEnabled()) dialog.finish(false);
          return dialog;
        });
        return result === true && !cancelled && !request.signal?.aborted && !disposed;
      } finally {
        active.delete(cancel);
        request.signal?.removeEventListener('abort', cancel);
      }
    });
  });
  const unsubscribeMode = mode.onChange(() => { if (!mode.isEnabled()) cancelAll(); });
  const lifecycle = ['session_switch', 'session_tree', 'session_compact', 'session_shutdown'].map(event => pi.on?.(event, cancelAll));
  return () => {
    if (disposed) return;
    disposed = true;
    unsubscribe?.();
    unsubscribeMode();
    lifecycle.forEach(off => { if (typeof off === 'function') off(); });
    cancelAll();
  };
}
