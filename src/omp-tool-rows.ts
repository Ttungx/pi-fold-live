import * as Tui from '@earendil-works/pi-tui';
import { activityHeading, activityRow, cardContentWidth } from './display-card.ts';
import { ompToolRowsSupported } from './runtime-compatibility.ts';

/** One heading plus the newest output lines; the running action never grows past this. */
const previewLines = 3;
/** Built-ins with plain-text or diff output. Interactive and checklist cards keep their native renderers. */
export const ompCompactToolNames = ['read', 'bash', 'grep', 'glob', 'find', 'lsp', 'eval', 'web_search', 'edit', 'write', 'apply_patch'] as const;

type RenderMode = { isEnabled(): boolean; onChange?(callback: () => void): () => void };
type HostApi = {
  registerToolRenderer?: unknown;
  registerLinkScheme?: (scheme: string) => void;
  on?: (event: string, handler: (event: unknown, ctx?: unknown) => unknown) => unknown;
};
type RowTheme = { fg?(token: string, text: string): string };
type ToolArgs = Record<string, unknown> | null | undefined;
type TextBlock = { type: 'text'; text: string };
type ToolResult = { content?: readonly unknown[]; details?: unknown; isError?: boolean };
/** Host-defined details; only the flags the row prints are read. */
type RowDetails = { exitCode?: unknown; truncated?: unknown; truncation?: { truncated?: unknown } };
type ToolComponent = { render(width: number): string[] };
type RenderOptions = { expanded?: boolean; isPartial?: boolean };
type ToolRendererLike = {
  [key: string]: unknown;
  renderCall?(args: ToolArgs, options: RenderOptions, theme: RowTheme): ToolComponent | undefined;
  renderResult?(result: ToolResult | undefined, options: RenderOptions, theme: RowTheme, args?: ToolArgs): ToolComponent | undefined;
};

const isTextBlock = (block: unknown): block is TextBlock =>
  typeof block === 'object' && block !== null && 'type' in block && block.type === 'text' && 'text' in block && typeof block.text === 'string';

/** The window only shows the end of the output; never scan a large result in full. */
const tailLimit = 8192;
const tailCache = new WeakMap<object, string[]>();
const targetCache = new WeakMap<object, string>();

const tailTextOf = (result: ToolResult | undefined): string => {
  const blocks = result?.content ?? [];
  let text = '';
  for (let index = blocks.length - 1; index >= 0 && text.length < tailLimit; index--) {
    const block = blocks[index];
    if (!isTextBlock(block)) continue;
    const room = tailLimit - text.length;
    const piece = block.text.length > room ? block.text.slice(-room) : block.text;
    text = text ? `${piece}\n${text}` : piece;
  }
  return text;
};

const tailLinesOf = (result: ToolResult): string[] => {
  const cached = tailCache.get(result);
  if (cached) return cached;
  // Tabs would be measured as three cells by visibleWidth but expand to tab stops in a terminal;
  // control sequences in tool output could move the cursor out of this one-row window.
  const lines = tailTextOf(result).replace(/\r/g, '').split('\n')
    .map(line => (line.includes('\x1b') || line.includes('\t')
      ? Tui.stripTerminalSequences?.(line.replace(/\t/g, '    ')) ?? line
      : line).trimEnd())
    .filter(line => line.trim()).slice(-previewLines);
  tailCache.set(result, lines);
  return lines;
};

const hasImage = (result: ToolResult | undefined): boolean =>
  (result?.content ?? []).some(block => typeof block === 'object' && block !== null && 'type' in block && block.type === 'image');

const tint = (theme: RowTheme | undefined, token: string, text: string) => theme?.fg?.(token, text) ?? text;

/** The extension-link marker OMP strips before writing but reads back for clicks and hint tags. */
const actionLinkPrefix = 'pi-fold:action/';
let nextActionId = 0;
const actionLinkClose = '\x1b]8;;\x07';
const withActionLink = (row: string, url: string): string => row.trim().length > 0 ? `\x1b]8;id=omp-extension-link;${url}\x07${row}${actionLinkClose}` : row;
const targetKeys = ['command', 'path', 'file_path', 'pattern', 'query', 'url', 'prompt'] as const;
/** The one argument a reader recognizes the action by, in the order the built-ins name it. */
export function compactToolTarget(args: ToolArgs): string {
  if (!args) return '';
  const cached = targetCache.get(args);
  if (cached !== undefined) return cached;
  let target = '';
  for (const key of targetKeys) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) {
      target = value.slice(0, 4096).replace(/\s+/g, ' ').trim().slice(0, 120);
      if (target.includes('\x1b')) target = Tui.stripTerminalSequences?.(target) ?? target;
      break;
    }
  }
  targetCache.set(args, target);
  return target;
}

export function compactToolRows(name: string, args: ToolArgs, result: ToolResult | undefined, partial: boolean, theme: RowTheme | undefined, width: number): string[] {
  const target = compactToolTarget(args);
  const label = `${name}${target ? ` · ${target}` : ''}`;
  if (!result) return [activityRow(activityHeading(`… ${label} · preparing`, theme), width, theme)];
  if (partial) {
    const bodyWidth = Math.max(1, cardContentWidth(width) - 3);
    const rows = [activityRow(activityHeading(`▾ ${label} · running`, theme), width, theme)];
    for (const line of tailLinesOf(result)) {
      rows.push(activityRow(`   ${tint(theme, 'text', Tui.truncateToWidth(line, bodyWidth, '…'))}`, width, theme));
    }
    // Pad so the live window keeps its height as output arrives.
    while (rows.length <= previewLines) rows.push(activityRow('', width, theme));
    return rows;
  }
  // OMP's tool details are host-defined; these are the two flags the final row reads.
  const details = (result.details ?? undefined) as RowDetails | undefined;
  const exitCode = details?.exitCode;
  const failed = result.isError === true || typeof exitCode === 'number' && exitCode !== 0;
  const truncated = details?.truncation?.truncated === true || details?.truncated === true;
  return [activityRow(`${tint(theme, failed ? 'error' : 'success', failed ? '✗' : '✓')} ${activityHeading(label, theme)}${failed ? ' · failed' : ''}${truncated ? ' · output truncated' : ''}`, width, theme)];
}

/** OMP's built-in renderer entry, reduced to the call row and the live result window.
 *  `expanded` (Ctrl+O) and folding-off return the stock renderer unchanged. */
export function wrapOmpToolRenderer(name: string, stock: ToolRendererLike, mode: RenderMode): ToolRendererLike {
  return {
    ...stock,
    renderCall(args, options, theme) {
      if (options?.expanded || typeof stock.renderCall !== 'function') return stock.renderCall?.(args, options, theme);
      let native: ToolComponent | undefined;
      return { render: width => mode.isEnabled() ? compactToolRows(name, args, undefined, true, theme, width) : (native ??= stock.renderCall?.(args, options, theme))?.render(width) ?? [] };
    },
    renderResult(result, options, theme, args) {
      if (options?.expanded || hasImage(result) || typeof stock.renderResult !== 'function') {
        return stock.renderResult?.(result, options, theme, args);
      }
      let native: ToolComponent | undefined;
      return { render: width => mode.isEnabled() ? compactToolRows(name, args, result, options?.isPartial === true, theme, width) : (native ??= stock.renderResult?.(result, options, theme, args))?.render(width) ?? [] };
    },
  };
}

type RunItem = { name: string; segment: number; settled: boolean; expanded: boolean; successful?: boolean };
/** Consecutive settled rows of the same tool in one turn segment collapse into one action block. */
export function toolRunFor<T extends RunItem>(items: readonly T[], item: T): T[] {
  const index = items.indexOf(item);
  if (index < 0 || !item.settled || item.expanded || item.successful === false) return [item];
  const same = (candidate: T) => candidate.name === item.name && candidate.name.length > 0 && candidate.segment === item.segment && candidate.settled && !candidate.expanded && candidate.successful !== false;
  let start = index;
  let end = index;
  while (start > 0 && same(items[start - 1])) start--;
  while (end + 1 < items.length && same(items[end + 1])) end++;
  return items.slice(start, end + 1);
}

export const toolRunSummary = (run: readonly RunItem[]): string => `✓ ${run.length} actions · ${run[0].name}`;

type NativeNode = { k: string; p?: Record<string, unknown>; c?: readonly unknown[]; key?: string };
type TrackedTool = RunItem & { component: object; url: string; image: boolean; nativeTool?: boolean; disclosure?: TrackedTool[] };
type ToolComponentPrototype = {
  render(this: object, width: number): readonly string[];
  describe(this: object, context?: unknown): NativeNode;
  handleNativeEvent(this: object, event: unknown): unknown;
  updateResult(this: object, result: unknown, isPartial?: boolean, id?: unknown): unknown;
  setExecutionStarted(this: object, id?: unknown): unknown;
  setExpanded(this: object, expanded: boolean): unknown;
  dispose(this: object): unknown;
};
/** A non-null object is a record for these one-off field reads. */
const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined;

/** Guarded OMP component seam: per-action links for ANSI, native toggles for TSP.
 * shortcut: patches ToolExecutionComponent; unknown native nodes stay stock. */
export function installOmpToolComponents(pi: HostApi, mode: RenderMode, prototype: ToolComponentPrototype, theme?: RowTheme): () => void {
  const originalRender = prototype.render;
  const originalDescribe = prototype.describe;
  const originalNativeEvent = prototype.handleNativeEvent;
  const originalUpdate = prototype.updateResult;
  const originalStarted = prototype.setExecutionStarted;
  const originalExpanded = prototype.setExpanded;
  const originalDispose = prototype.dispose;
  const tracks = new WeakMap<object, TrackedTool>();
  const live = new Set<TrackedTool>();
  const actions = new Map<string, TrackedTool>();
  let segment = 0;
  const track = (component: object): TrackedTool => {
    let tracked = tracks.get(component);
    if (!tracked) {
      tracked = { component, url: `${actionLinkPrefix}${++nextActionId}`, name: '', segment, settled: false, expanded: false, image: false, successful: true };
      tracks.set(component, tracked);
      live.add(tracked);
      actions.set(tracked.url, tracked);
    }
    return tracked;
  };
  const runFor = (tracked: TrackedTool) => toolRunFor([...live], tracked);
  const expand = (tracked: TrackedTool, expanded: boolean) => {
    const members = tracked.disclosure ?? runFor(tracked);
    for (const member of members) {
      if (!live.has(member)) continue;
      prototype.setExpanded.call(member.component, expanded);
      member.disclosure = expanded && members.length > 1 ? members : undefined;
    }
  };
  prototype.updateResult = function (result, isPartial, id) {
    const tracked = track(this);
    tracked.settled = isPartial !== true;
    const frame = asRecord(result);
    tracked.image = hasImage(frame as ToolResult | undefined);
    const exitCode = asRecord(frame?.details)?.exitCode;
    tracked.successful = frame?.isError !== true && !(typeof exitCode === 'number' && exitCode !== 0) && !tracked.image;
    return originalUpdate.call(this, result, isPartial, id);
  };
  prototype.setExecutionStarted = function (id) {
    track(this).settled = false;
    return originalStarted.call(this, id);
  };
  prototype.setExpanded = function (expanded) {
    const tracked = track(this);
    tracked.expanded = expanded === true;
    tracked.disclosure = undefined;
    return originalExpanded.call(this, expanded);
  };
  prototype.render = function (width) {
    const rows = originalRender.call(this, width);
    if (!mode.isEnabled()) return rows;
    const tracked = track(this);
    const first = rows.find(row => (Tui.stripTerminalSequences?.(row) ?? row).trim().length > 0) ?? '';
    const plain = Tui.stripTerminalSequences?.(first) ?? first;
    const match = /^\s*[✓✗▾…]\s+([a-z_]+)\b/.exec(plain);
    if (match) tracked.name = match[1];
    else if (!tracked.expanded) tracked.name = '';
    if (!tracked.name || tracked.image) return rows;
    const link = (shown: readonly string[]) => {
      if (!tracked.expanded) return shown.map(row => withActionLink(row, tracked.url));
      const header = shown.findIndex(row => (Tui.stripTerminalSequences?.(row) ?? row).trim().length > 0 && !row.includes('\x1b]8;'));
      if (header < 0) return shown;
      const linked = shown.slice();
      linked[header] = withActionLink(linked[header], tracked.url);
      return linked;
    };
    const run = runFor(tracked);
    if (run.length < 2) return link(rows);
    if (run[0] !== tracked) return [];
    return link([activityRow(activityHeading(toolRunSummary(run), theme), width, theme)]);
  };
  prototype.describe = function (context) {
    const node = originalDescribe.call(this, context);
    const tracked = track(this);
    tracked.nativeTool = node.k === 'tool';
    if (!mode.isEnabled() || node.k !== 'tool') return node;
    const name = typeof node.p?.role === 'string' ? /^omp\.tool\.([a-z_]+)$/.exec(node.p.role)?.[1] : undefined;
    if (!name || !(ompCompactToolNames as readonly string[]).includes(name)) return node;
    tracked.name = name;
    tracked.settled = ['done', 'error', 'cancelled'].includes(String(node.p?.status));
    tracked.successful = node.p?.status === 'done' && tracked.successful !== false && !tracked.image;
    if (tracked.expanded || tracked.image) return node;
    const run = runFor(tracked);
    if (run.length > 1 && run[0] !== tracked) return { k: 'col', c: [] };
    // Keep stock bodies and native toggle routing: only presentation and the collapsed preview change.
    const props = { ...node.p, frame: 'inline', collapsed: true, preview: tracked.settled ? 'none' : { tail: previewLines },
      ...(run.length > 1 ? { title: toolRunSummary(run), target: undefined, meta: undefined, badges: undefined } : {}) };
    return { ...node, p: props };
  };
  prototype.handleNativeEvent = function (event) {
    const toggle = asRecord(event);
    const tracked = tracks.get(this);
    if (mode.isEnabled() && tracked?.nativeTool && tracked.name && toggle?.type === 'toggle' && toggle.key === '' && typeof toggle.collapsed === 'boolean') {
      expand(tracked, !toggle.collapsed);
      return;
    }
    return originalNativeEvent.call(this, event);
  };
  prototype.dispose = function () {
    const tracked = tracks.get(this);
    if (tracked) { live.delete(tracked); tracks.delete(this); actions.delete(tracked.url); }
    return originalDispose.call(this);
  };
  const offs: (() => void)[] = [];
  const on = (event: string, handler: (event: unknown, ctx?: unknown) => void) => {
    const off = pi.on?.(event, handler);
    if (typeof off === 'function') offs.push(off as () => void);
  };
  pi.registerLinkScheme?.('pi-fold');
  on('link_activate', (event, ctx) => {
    if (!mode.isEnabled()) return;
    const url = asRecord(event)?.url;
    const tracked = typeof url === 'string' ? actions.get(url) : undefined;
    const ui = asRecord(asRecord(ctx)?.ui);
    if (!tracked?.name || typeof ui?.setWidget !== 'function') return;
    expand(tracked, !tracked.expanded);
    // OMP exposes no standalone repaint; removing our absent widget schedules one without UI chrome.
    ui.setWidget.call(ui, 'pi-fold:refresh', undefined);
  });
  on('message_start', event => {
    const role = asRecord(asRecord(event)?.message)?.role;
    if (role === 'user' || role === 'custom') segment++;
  });
  on('message_end', event => {
    const message = asRecord(asRecord(event)?.message);
    if (message?.role === 'assistant' && Array.isArray(message.content) && message.content.some(block => isTextBlock(block) && block.text.trim().length > 0)) segment++;
  });
  on('turn_start', () => { segment++; });
  let repaint: (() => void) | undefined;
  on('session_start', (_event, ctx) => {
    const ui = asRecord(asRecord(ctx)?.ui);
    repaint = typeof ui?.setWidget === 'function' ? () => (ui.setWidget as (key: string, content: undefined) => void).call(ui, 'pi-fold:refresh', undefined) : undefined;
  });
  const modeOff = mode.onChange?.(() => repaint?.());
  if (modeOff) offs.push(modeOff);
  return () => {
    prototype.render = originalRender;
    prototype.describe = originalDescribe;
    prototype.handleNativeEvent = originalNativeEvent;
    prototype.updateResult = originalUpdate;
    prototype.setExecutionStarted = originalStarted;
    prototype.setExpanded = originalExpanded;
    prototype.dispose = originalDispose;
    for (const off of offs.splice(0)) off();
    live.clear();
    actions.clear();
  };
}

/** OMP resolves `@earendil-works/pi-tui/tools` onto its own copy. It removed `registerToolRenderer`,
 *  so its name-keyed renderer registry is the only render-only hook for built-ins.
 *  shortcut: patches an exported registry, not an extension API; switch to a real renderer hook when OMP adds one. */
let installing: Promise<(() => void) | undefined> | undefined;
let owners = 0;
export async function registerOmpToolRows(pi: HostApi, mode: RenderMode): Promise<(() => void) | undefined> {
  if (typeof pi?.registerToolRenderer === 'function') return undefined;
  installing ??= installOmpToolRows(pi, mode);
  const restore = await installing;
  if (!restore) return undefined;
  owners++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--owners === 0) { restore(); installing = undefined; }
  };
}

async function loadOmpToolComponents(): Promise<ToolComponentPrototype | undefined> {
  try {
    const componentModule = await import('@earendil-works/pi-tui/chat/tool-execution') as unknown as { ToolExecutionComponent?: { prototype: ToolComponentPrototype } };
    return componentModule.ToolExecutionComponent?.prototype;
  } catch {
    return undefined;
  }
}

async function installOmpToolRows(pi: HostApi, mode: RenderMode): Promise<(() => void) | undefined> {
  // Static import cannot work: this subpath exists only on OMP, and must not break Pi loads.
  let registry: Record<string, ToolRendererLike> | undefined;
  try {
    registry = (await import('@earendil-works/pi-tui/tools') as unknown as { toolRenderers?: Record<string, ToolRendererLike> }).toolRenderers;
  } catch {
    return undefined;
  }
  const prototype = await loadOmpToolComponents();
  if (!registry || !prototype || !ompToolRowsSupported(pi, registry, prototype)) return undefined;
  const themeModule = await import('@earendil-works/pi-tui/theme').catch(() => undefined) as { theme?: RowTheme } | undefined;
  const originals = new Map<string, ToolRendererLike>();
  for (const name of ompCompactToolNames) {
    const stock = registry[name];
    if (!stock || typeof stock !== 'object') continue;
    originals.set(name, stock);
    registry[name] = wrapOmpToolRenderer(name, stock, mode);
  }
  const restoreFolding = installOmpToolComponents(pi, mode, prototype, themeModule?.theme);
  return () => {
    restoreFolding();
    for (const [name, stock] of originals) registry![name] = stock;
  };
}
