import * as Tui from '@earendil-works/pi-tui';
import { activityHeading, activityRow, cardContentWidth } from './display-card.ts';

/** One heading plus the newest output lines; the running action never grows past this. */
const previewLines = 3;
/** Built-ins with plain-text or diff output. Interactive and checklist cards keep their native renderers. */
export const ompCompactToolNames = ['read', 'bash', 'grep', 'glob', 'find', 'lsp', 'eval', 'web_search', 'edit', 'write', 'apply_patch'] as const;

type RenderMode = { isEnabled(): boolean };
type HostApi = { registerToolRenderer?: unknown; on?: (event: string, handler: (event: unknown) => void) => unknown };
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
      if (options?.expanded || !mode.isEnabled()) return stock.renderCall?.(args, options, theme);
      return { render: width => compactToolRows(name, args, undefined, true, theme, width) };
    },
    renderResult(result, options, theme, args) {
      if (options?.expanded || !mode.isEnabled() || hasImage(result)) {
        return stock.renderResult?.(result, options, theme, args);
      }
      return { render: width => compactToolRows(name, args, result, options?.isPartial === true, theme, width) };
    },
  };
}

type RunItem = { name: string; segment: number; settled: boolean; expanded: boolean };
/** Consecutive settled rows of the same tool in one turn segment collapse into one action block. */
export function toolRunFor<T extends RunItem>(items: readonly T[], item: T): T[] {
  const index = items.indexOf(item);
  if (index < 0) return [item];
  const same = (candidate: T) => candidate.name === item.name && candidate.name.length > 0 && candidate.segment === item.segment && candidate.settled && !candidate.expanded;
  let start = index;
  let end = index;
  while (start > 0 && same(items[start - 1])) start--;
  while (end + 1 < items.length && same(items[end + 1])) end++;
  return items.slice(start, end + 1);
}

export const toolRunSummary = (run: readonly RunItem[]): string => `✓ ${run.length} actions · ${run[0].name}`;

type TrackedTool = RunItem & { component: object };
type ToolComponentPrototype = {
  render(this: object, width: number): readonly string[];
  updateResult(this: object, result: unknown, isPartial?: boolean, id?: unknown): unknown;
  setExecutionStarted(this: object): unknown;
  setExpanded(this: object, expanded: boolean): unknown;
  dispose(this: object): unknown;
};
/** A non-null object is a record for these one-off field reads. */
const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined;

/** OMP has no work-group hook: collapse consecutive same-tool rows by patching the public component
 *  render pass. Ctrl+O (`setExpanded`) and `/fold off` return every row unchanged.
 *  shortcut: patches `ToolExecutionComponent.prototype`; re-check on OMP upgrades. */
async function installToolRunFolding(pi: HostApi, mode: RenderMode): Promise<(() => void) | undefined> {
  let prototype: ToolComponentPrototype | undefined;
  try {
    // Static import cannot work: this subpath exists only on OMP, and must not break Pi loads.
    // The host class is not exported through the extension API; this is its documented subpath shape.
    const componentModule = await import('@earendil-works/pi-tui/chat/tool-execution') as unknown as { ToolExecutionComponent?: { prototype: ToolComponentPrototype } };
    prototype = componentModule.ToolExecutionComponent?.prototype;
  } catch {
    return undefined;
  }
  if (!prototype || typeof prototype.render !== 'function') return undefined;
  // Static import cannot work: Pi's TUI has no theme singleton; OMP's root does.
  const themeModule = await import('@earendil-works/pi-tui/theme').catch(() => undefined) as { theme?: RowTheme } | undefined;
  const originalRender = prototype.render;
  const originalUpdate = prototype.updateResult;
  const originalStarted = prototype.setExecutionStarted;
  const originalExpanded = prototype.setExpanded;
  const originalDispose = prototype.dispose;
  const tracks = new WeakMap<object, TrackedTool>();
  const live = new Set<TrackedTool>();
  let segment = 0;
  const track = (component: object): TrackedTool => {
    let tracked = tracks.get(component);
    if (!tracked) {
      tracked = { component, name: '', segment, settled: false, expanded: false };
      tracks.set(component, tracked);
      live.add(tracked);
    }
    return tracked;
  };
  prototype.updateResult = function (this: object, result, isPartial, id) {
    const tracked = track(this);
    tracked.settled = isPartial !== true;
    if (!tracked.settled) tracked.name = '';
    return originalUpdate.call(this, result, isPartial, id);
  };
  prototype.setExecutionStarted = function (this: object) {
    track(this).settled = false;
    return originalStarted.call(this);
  };
  prototype.setExpanded = function (this: object, expanded) {
    track(this).expanded = expanded === true;
    return originalExpanded.call(this, expanded);
  };
  prototype.render = function (this: object, width) {
    const rows = originalRender.call(this, width);
    const tracked = track(this);
    // The card's Box starts with a blank padding row; the activity row is the first visible one.
    const first = rows.map(row => Tui.stripTerminalSequences?.(row) ?? row).find(row => row.trim().length > 0) ?? '';
    const match = /^\s*✓\s+([a-z_]+)\b/.exec(first);
    tracked.name = match?.[1] ?? '';
    if (!mode.isEnabled() || !tracked.name || !tracked.settled || tracked.expanded) return rows;
    const run = toolRunFor([...live], tracked);
    if (run.length < 2) return rows;
    if (run[0] !== tracked) return [];
    const theme = themeModule?.theme;
    return [activityRow(activityHeading(toolRunSummary(run), theme), width, theme)];
  };
  prototype.dispose = function (this: object) {
    const tracked = tracks.get(this);
    if (tracked) { live.delete(tracked); tracks.delete(this); }
    return originalDispose.call(this);
  };
  const offs: (() => void)[] = [];
  const on = (event: string, handler: (event: unknown) => void) => {
    const off = pi.on?.(event, handler);
    if (typeof off === 'function') offs.push(off as () => void);
  };
  // Prose and custom cards separate work runs; tool batches in consecutive assistant messages do not.
  on('message_start', event => {
    const role = asRecord(asRecord(event)?.message)?.role;
    if (role === 'user' || role === 'custom') segment++;
  });
  on('message_end', event => {
    const message = asRecord(asRecord(event)?.message);
    if (message?.role !== 'assistant' || !Array.isArray(message.content)) return;
    if (message.content.some(block => isTextBlock(block) && block.text.trim().length > 0)) segment++;
  });
  on('turn_start', () => { segment++; });
  return () => {
    prototype!.render = originalRender;
    prototype!.updateResult = originalUpdate;
    prototype!.setExecutionStarted = originalStarted;
    prototype!.setExpanded = originalExpanded;
    prototype!.dispose = originalDispose;
    for (const off of offs.splice(0)) off();
    live.clear();
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

async function installOmpToolRows(pi: HostApi, mode: RenderMode): Promise<(() => void) | undefined> {
  // Static import cannot work: this subpath exists only on OMP, and must not break Pi loads.
  let registry: Record<string, ToolRendererLike> | undefined;
  try {
    registry = (await import('@earendil-works/pi-tui/tools') as unknown as { toolRenderers?: Record<string, ToolRendererLike> }).toolRenderers;
  } catch {
    return undefined;
  }
  if (!registry || typeof registry !== 'object') return undefined;
  const originals = new Map<string, ToolRendererLike>();
  for (const name of ompCompactToolNames) {
    const stock = registry[name];
    if (!stock || typeof stock !== 'object') continue;
    originals.set(name, stock);
    registry[name] = wrapOmpToolRenderer(name, stock, mode);
  }
  const restoreFolding = await installToolRunFolding(pi, mode);
  return () => {
    restoreFolding?.();
    for (const [name, stock] of originals) registry![name] = stock;
  };
}
