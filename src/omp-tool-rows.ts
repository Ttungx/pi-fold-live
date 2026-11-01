import * as Tui from '@earendil-works/pi-tui';
import { activityHeading, activityRow, cardContentWidth } from './display-card.ts';

/** One heading plus the newest output lines; the running action never grows past this. */
const previewLines = 3;
/** Built-ins whose output is plain text. Interactive and diff cards keep their native renderers. */
export const ompCompactToolNames = ['read', 'bash', 'grep', 'glob', 'find', 'lsp', 'eval', 'web_search'] as const;

type RenderMode = { isEnabled(): boolean };
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

/** OMP resolves `@earendil-works/pi-tui/tools` onto its own copy. It removed `registerToolRenderer`,
 *  so its name-keyed renderer registry is the only render-only hook for built-ins.
 *  shortcut: patches an exported registry, not an extension API; switch to a real renderer hook when OMP adds one. */
let installing: Promise<(() => void) | undefined> | undefined;
let owners = 0;
export async function registerOmpToolRows(pi: { registerToolRenderer?: unknown }, mode: RenderMode): Promise<(() => void) | undefined> {
  if (typeof pi?.registerToolRenderer === 'function') return undefined;
  installing ??= installOmpToolRows(mode);
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

async function installOmpToolRows(mode: RenderMode): Promise<(() => void) | undefined> {
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
  return () => { for (const [name, stock] of originals) registry![name] = stock; };
}
