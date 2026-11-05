import type { DisplayMode } from './display-mode.ts';
import * as Tui from '@earendil-works/pi-tui';
import { chainNativeMethod } from './native-method-chain.ts';
import { ompThinkingSupported } from './runtime-compatibility.ts';

type Node = { k?: string; key?: string; p?: { role?: string; text?: string; [key: string]: unknown }; c?: readonly Node[] };
type Block = { type: string; text?: string; thinking?: string };
type Message = { content: Block[] };
type Component = { children?: Component[]; render(width: number): readonly string[]; describe?(): Node; getText?(): string; invalidate?(): void };
type Prototype = Component & { [owner]?: () => void; updateContent(message: Message, opts?: { transient?: boolean }): void; markTranscriptBlockFinalized(): void; setHideThinkingBlock(hide: boolean): void; handleNativeEvent(event: unknown): void; dispose(): void };
type State = { message: Message; finalized: boolean; transient: boolean; toggles: Map<number, boolean> };
type Run = { first: number; last: number; label: string; live: boolean };
type Surface = { AssistantMessageComponent: unknown; Markdown: unknown; Spacer: unknown; Text: unknown };
type NativeSurface = { AssistantMessageComponent: { prototype: Prototype }; Markdown: abstract new (...args: never[]) => Component; Spacer: abstract new (...args: never[]) => Component; Text: abstract new (...args: never[]) => Component };
const owner = Symbol.for('compact-renderer:omp-thinking:v1');

/** Read only the bounded tail of recorded thinking, never a generated summary. */
function latestLabel(source: string): string {
  const tail = source.slice(-512).replace(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/g, '');
  const line = tail.split(/\r?\n/).map(value => value.trim()).filter(Boolean).at(-1) || 'Recorded thinking';
  const text = line.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_match, bold, underlined) => bold || underlined)
    .replace(/`([^`]+)`/g, '$1').replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim() || 'Recorded thinking';
  return newestColumns(text, 76);
}

function newestColumns(text: string, columns: number): string {
  let width = Tui.visibleWidth(text);
  if (width <= columns) return text;
  if (columns <= 1) return columns === 1 ? '…' : '';
  const chars = Array.from(text);
  let from = 0;
  while (from < chars.length && width > columns - 1) width -= Tui.visibleWidth(chars[from++]);
  return `…${chars.slice(from).join('')}`;
}

function runsFor(state: State): Run[] {
  const content = state.message?.content;
  if (!Array.isArray(content)) return [];
  let tail = -1, tool = false;
  for (let index = 0; index < content.length; index++) {
    const block = content[index];
    if (block.type === 'toolCall') tool = true;
    if (block.type === 'thinking' && typeof block.thinking === 'string' && block.thinking.length
      || block.type === 'text' && typeof block.text === 'string' && block.text.trim()) tail = index;
  }
  const runs: Run[] = [];
  for (let index = 0; index < content.length; index++) {
    if (content[index].type !== 'thinking') continue;
    const first = index;
    let source = '';
    while (index < content.length && content[index].type === 'thinking') {
      const thinking = content[index].thinking;
      if (typeof thinking === 'string' && thinking.length) source = thinking;
      index++;
    }
    const last = index - 1;
    if (source) runs.push({ first, last, label: latestLabel(source), live: !state.finalized && state.transient && !tool && tail === last });
    index--;
  }
  return runs;
}

const sectionIndex = (node: Node) => node?.k === 'section' && /^omp\.thinking(?:\.live)?$/.test(node.p?.role || '') && /^k\d+$/.test(node.key || '') ? Number(node.key!.slice(1)) : undefined;
const contentIndex = (node: Node) => /^[tki]\d+(?:\.\d+)?$/.test(node?.key || '') ? Number(node.key!.slice(1).split('.')[0]) : undefined;

/** OMP 18's semantic tree remains native: copy, images, errors and section events
 * still belong to the original assistant component. Unknown roots stay stock. */
function describeCompact(root: Node, state: State, runs: Run[]): Node {
  if (!runs.length || root?.k !== 'col' || !/^omp\.assistant(?:\.rewound)?$/.test(root.p?.role || '') || !Array.isArray(root.c)) return root;
  if (root.c.some(node => /^t\d+$/.test(node.key || '') && state.message.content[contentIndex(node)!]?.type !== 'text')) return root;
  const children = root.c.slice();
  for (const run of runs) {
    const sections = children.filter(node => { const index = sectionIndex(node); return index !== undefined && index >= run.first && index <= run.last; });
    if (sections.some(section => state.toggles.get(sectionIndex(section)!) === false)) continue;
    const native = sections.at(-1);
    // Hidden finished thinking has no stock section. Its compact section still
    // routes the ordinary kN toggle back to OMP and retains the recorded body.
    const bodies: Node[] = [];
    for (let index = run.first; index <= run.last; index++) bodies.push(sections.find(section => sectionIndex(section) === index)?.c?.[1] || { k: 'md', key: `k${index}`, p: { text: state.message.content[index].thinking } });
    const body: Node = bodies.length === 1 ? bodies[0] : { k: 'col', key: 'body', c: bodies };
    const head: Node = { k: 'text', key: 'head', p: { spans: [{ t: `${run.live ? 'Thinking' : 'Thought'} · ${run.label}`, s: 'muted' }], wrap: 'none', truncate: 'start', lines: 1 } };
    const section: Node = { ...(native || { k: 'section', key: `k${run.last}` }), p: { ...native?.p, role: run.live ? 'omp.thinking.live' : 'omp.thinking', collapsible: true, collapsed: state.toggles.get(run.last) ?? true }, c: [head, body] };
    let at = children.findIndex(node => { const index = contentIndex(node); return index !== undefined && index >= run.first; });
    if (at < 0) {
      at = children.length;
      while (at > 0 && contentIndex(children[at - 1]) === undefined) at--;
    }
    for (let index = children.length - 1; index >= 0; index--) {
      const thinking = sectionIndex(children[index]);
      if (thinking !== undefined && thinking >= run.first && thinking <= run.last) children.splice(index, 1);
    }
    children.splice(Math.min(at, children.length), 0, section);
  }
  return { ...root, c: children };
}

/** Inject the actual OMP classes for native-instance regression probes. */
export function installOmpThinkingAdapter(surface: Surface, mode: DisplayMode): (() => void) | undefined {
  if (!Object.values(surface).every(value => typeof value === 'function')) return;
  // These in-process constructors are OMP's own; guard their prototype seam below.
  const { AssistantMessageComponent, Markdown, Spacer, Text } = surface as NativeSurface;
  const proto = AssistantMessageComponent.prototype;
  const methods = ['updateContent', 'render', 'describe', 'setHideThinkingBlock', 'markTranscriptBlockFinalized', 'handleNativeEvent', 'dispose'] as const;
  if (!proto || !methods.every(key => typeof proto[key] === 'function')) return;
  proto[owner]?.();
  const states = new Map<Component, State>();
  const detach: (() => void)[] = [];
  const refresh = () => { for (const component of states.keys()) component.invalidate?.(); };
  const stockDescribe = proto.describe;
  let disposed = false;

  detach.push(chainNativeMethod(proto, 'updateContent', function(this: Component, update, message: Message, opts?: { transient?: boolean }) {
    const previous = states.get(this);
    const state: State = { message, transient: opts?.transient === true, finalized: previous?.finalized ?? opts?.transient !== true, toggles: previous?.toggles || new Map() };
    states.set(this, state);
    return update.call(this, message, opts);
  }));
  detach.push(chainNativeMethod(proto, 'markTranscriptBlockFinalized', function(this: Component, finalize, ...args: unknown[]) {
    const state = states.get(this);
    if (state) state.finalized = true;
    return finalize.apply(this, args);
  }));
  detach.push(chainNativeMethod(proto, 'setHideThinkingBlock', function(this: Component, setHide, ...args: unknown[]) {
    states.get(this)?.toggles.clear();
    return setHide.apply(this, args);
  }));
  detach.push(chainNativeMethod(proto, 'handleNativeEvent', function(this: Component, handle, event: { type?: string; key?: string; collapsed?: boolean }) {
    if (event?.type === 'toggle' && /^k\d+$/.test(event.key || '') && typeof event.collapsed === 'boolean') states.get(this)?.toggles.set(Number(event.key!.slice(1)), event.collapsed);
    return handle.call(this, event);
  }));
  detach.push(chainNativeMethod(proto, 'describe', function(this: Component, describe, ...args: unknown[]) {
    const root: Node = describe.apply(this, args), state = states.get(this);
    return mode.isEnabled() && state ? describeCompact(root, state, runsFor(state)) : root;
  }));
  detach.push(chainNativeMethod(proto, 'render', function(this: Component, render, width: number) {
    const state = states.get(this), content = this.children?.[0];
    if (!mode.isEnabled() || !state || !Array.isArray(content?.children) || this.children?.length !== 2) return render.call(this, width);
    const runs = runsFor(state);
    // shortcut: unfamiliar/image ANSI layouts remain native; TSP retains indexed image anchors.
    if (!runs.length || state.message.content.some(block => !['text', 'thinking', 'toolCall'].includes(block.type))) return render.call(this, width);
    const root = stockDescribe!.call(this);
    if (root?.k !== 'col' || !Array.isArray(root.c) || root.c.some(node => /^t\d+$/.test(node.key || '') && state.message.content[contentIndex(node)!]?.type !== 'text')) return render.call(this, width);
    const entries = root.c.flatMap((node: Node) => node.k === 'md' && /^t\d+$/.test(node.key || '')
      ? [{ index: contentIndex(node)!, thinking: false, node }]
      : sectionIndex(node) !== undefined && node.c?.[1]?.k === 'md' ? [{ index: sectionIndex(node)!, thinking: true, node: node.c[1] }] : []);
    const markdown = content.children.filter(child => child instanceof Markdown);
    const prose = entries.filter(entry => !entry.thinking);
    const hidden = markdown.length === prose.length;
    const expected = hidden ? prose : entries;
    if (markdown.length !== expected.length || markdown.some((child, index) => child.describe?.()?.p?.text !== expected[index].node.p?.text)) return render.call(this, width);
    const original = content.children, children = original.slice();
    const anchors = new Map<number, Component>(expected.map((entry, index) => [entry.index, markdown[index]]));
    for (const run of runs) {
      if ([...state.toggles].some(([index, collapsed]) => index >= run.first && index <= run.last && !collapsed)) continue;
      const thinking = expected.filter(entry => entry.thinking && entry.index >= run.first && entry.index <= run.last).map(entry => anchors.get(entry.index)!);
      let at = thinking.length ? children.indexOf(thinking[0]) : children.findIndex(child => [...anchors].some(([index, anchor]) => index > run.last && anchor === child));
      if (at < 0) {
        const last = [...anchors.values()].at(-1);
        at = last ? children.indexOf(last) + 1 : 0;
      }
      for (const child of thinking) {
        const index = children.indexOf(child);
        children.splice(index, 1);
        if (children[index] instanceof Spacer) children.splice(index, 1);
      }
      if (hidden && run.live) {
        const pulse = children.findIndex(child => child instanceof Text && typeof child.getText === 'function' && /^\S+ Thinking(?: ·.*)?$/.test((Tui.stripTerminalSequences?.(child.getText()) || child.getText()).trim()));
        if (pulse < 0) return render.call(this, width);
        children.splice(pulse, 1);
        if (children[pulse - 1] instanceof Spacer) children.splice(pulse - 1, 1);
      }
      const prefix = ` ${run.live ? 'Thinking' : 'Thought'} · `;
      const row = { render: (cols: number) => [Tui.truncateToWidth(`${prefix}${newestColumns(run.label, Math.max(0, cols - Tui.visibleWidth(prefix)))}`, Math.max(1, cols), '…')] };
      children.splice(Math.min(at, children.length), 0, row);
    }
    // Temporary children also withhold native stable-thinking publication: the
    // moving row must not be retired into append-only terminal history.
    content.children = children;
    try { return render.call(this, width); }
    finally { content.children = original; }
  }));
  detach.push(chainNativeMethod(proto, 'dispose', function(this: Component, dispose, ...args: unknown[]) {
    states.delete(this);
    return dispose.apply(this, args);
  }));
  detach.push(mode.onChange(refresh));
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const restore of detach.reverse()) restore();
    refresh();
    states.clear();
    if (proto[owner] === dispose) delete proto[owner];
  };
  proto[owner] = dispose;
  return dispose;
}

export async function registerOmpThinking(pi: unknown, mode: DisplayMode): Promise<(() => void) | undefined> {
  try {
    // This OMP-only platform module does not exist on Pi; a static import breaks Pi loading.
    const { AssistantMessageComponent } = await import('@earendil-works/pi-tui/chat/assistant-message');
    if (!ompThinkingSupported(pi, AssistantMessageComponent?.prototype)) return;
    return installOmpThinkingAdapter({ AssistantMessageComponent, Markdown: Tui.Markdown, Spacer: Tui.Spacer, Text: Tui.Text }, mode);
  } catch {
    // Pi and unknown OMP surfaces keep their exact native rendering.
    return;
  }
}
