import type { DisplayMode } from './display-mode.ts';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import * as Pi from '@earendil-works/pi-coding-agent';
import * as Tui from '@earendil-works/pi-tui';
import { fillBackground } from './display-card.ts';
import { chainNativeMethod } from './native-method-chain.ts';
import { projectedChildren } from './work-strip-view.ts';

const { InteractiveMode, SkillInvocationMessageComponent, UserMessageComponent, VERSION } = Pi;
const { Container, Markdown, MouseRegion, Spacer, Text, matchesKey, stripTerminalSequences, visibleWidth } = Tui;

type Card = { skill: any; user?: any; gap?: any; detachGap?: () => void; headerEnd?: number; userStart?: number; userHeight?: number; body?: InstanceType<typeof Markdown>; bodyKey?: string; bodyTheme?: any };
const startZone = '\x1b]133;A\x07', endZone = '\x1b]133;B\x07\x1b]133;C\x07';

/** Pi 1.3 creates a native skill and optional user row from one user envelope.
 * Keep those identities and inputs; combine only their rendered presentation. */
export function registerModernSkillPrompts(pi: ExtensionAPI, mode: DisplayMode, _version = VERSION): () => void {
  const owner = Symbol.for('compact-renderer:skill-prompts:v1'), shared = globalThis as any;
  shared[owner]?.();
  const proto = InteractiveMode?.prototype as any;
  if (![Container, Markdown, MouseRegion, Spacer, Text, matchesKey, stripTerminalSequences, visibleWidth].every(value => typeof value === 'function') ||
      !proto || typeof proto.addMessageToChat !== 'function' ||
      !['setExpanded', 'render'].every(key => typeof SkillInvocationMessageComponent?.prototype?.[key] === 'function') ||
      typeof UserMessageComponent?.prototype?.render !== 'function' || typeof pi.on !== 'function' ||
      typeof pi.events?.on !== 'function' || typeof pi.events?.emit !== 'function') return () => {};
  const cards = new Map<any, Card>(), users = new WeakMap<any, Card>();
  let active = false, disposed = false, ctx: any, host: any, input: (() => void) | undefined, selected: Card | undefined, rendering: Card | undefined;
  const redraw = () => host?.ui?.requestRender?.();
  const release = () => { selected = undefined; };
  const compatible = (card: Card) => cards.get(card.skill) === card &&
    typeof card.skill.skillBlock?.name === 'string' && typeof card.skill.skillBlock?.content === 'string' &&
    Array.isArray(card.skill.children) && card.skill.children.length === 1 && card.skill.children[0] instanceof MouseRegion && card.skill.children[0].child instanceof Container && Array.isArray(card.skill.children[0].child.children) &&
    (card.skill.expanded ? card.skill.children[0].child.children.length === 2 && card.skill.children[0].child.children[0] instanceof Text && card.skill.children[0].child.children[1] instanceof Markdown :
      card.skill.children[0].child.children.length === 1 && card.skill.children[0].child.children[0] instanceof Text) &&
    (!card.user || Array.isArray(card.user.children) && card.user.children.length === 1 && card.user.children[0] instanceof Markdown && card.user.children[0].paddingY === 1 && card.user.text === card.skill.skillBlock.userMessage);
  const enabled = (card: Card) => !disposed && active && mode.isEnabled() &&
    typeof ctx?.ui?.theme?.fg === 'function' && typeof ctx?.ui?.theme?.bg === 'function' && compatible(card);
  const publish = (card: Card) => {
    // Inspection must find the native long-user-prompt target inside the visible
    // skill anchor. Canonical native children and prompt-jump identity stay intact.
    if (enabled(card) && card.user) card.skill[projectedChildren] = [card.user];
    else delete card.skill[projectedChildren];
  };
  const focus = (card: Card) => {
    if (!enabled(card)) return;
    selected = card; card.skill.setExpanded(true); redraw();
    pi.events.emit('compact-renderer:focus:v1', { owner: 'skills', target: (row: any) => row === card.skill });
  };
  const renderCard = (card: Card, width: number) => {
    const theme = ctx.ui.theme, skill = card.skill, block = skill.skillBlock, pad = skill.paddingX;
    const fill = (line: string) => line.includes('\x1b_G') || line.includes('\x1b]1337;File=') ? line : fillBackground(line, Math.max(width, visibleWidth(line)), theme, 'userMessageBg');
    let userLines: string[] = [];
    if (card.user) {
      const previous = rendering; rendering = card;
      try { userLines = card.user.render(width); } finally { rendering = previous; }
    }
    const name = stripTerminalSequences(block.name).replace(/[\p{Cc}\p{Cf}]/gu, '');
    const hint = selected === card ? ' · Enter toggles · Esc returns' : '';
    const heading = new Text(theme.fg('muted', `${skill.expanded ? '▾' : '▸'} /skill:${name}${hint}`), pad, 0).render(width).map(fill);
    const blank = fill('');
    const lines = [userLines[0] ?? startZone + blank, ...heading];
    card.headerEnd = lines.length;
    if (skill.expanded) {
      const bodyPad = pad + (width >= 8 ? 2 : 0);
      const bodyKey = [block.content, bodyPad, theme.bg('userMessageBg', ''), theme.fg('userMessageText', '')].join('\u0000');
      if (!card.body || card.bodyKey !== bodyKey || card.bodyTheme !== skill.markdownTheme) {
        card.body = new Markdown(block.content, bodyPad, 0, skill.markdownTheme, { color: (text: string) => theme.fg('userMessageText', text) });
        card.bodyKey = bodyKey; card.bodyTheme = skill.markdownTheme;
      }
      lines.push(blank, ...card.body.render(width).map(fill));
    }
    card.userStart = undefined; card.userHeight = userLines.length;
    if (card.user) {
      lines.push(blank); card.userStart = lines.length;
      lines.push(...userLines.slice(1, -1));
    }
    lines.push(userLines.at(-1) ?? endZone + blank);
    return lines;
  };
  const detachAdd = chainNativeMethod(proto, 'addMessageToChat', function(native, message, ...args) {
    host = this;
    const before = this.chatContainer?.children.length ?? 0;
    const result = native.call(this, message, ...args);
    if (message.role !== 'user') return result;
    const added = this.chatContainer.children.slice(before);
    while (added[0] instanceof Spacer) added.shift();
    const [skill, gap, user] = added;
    if (!(skill instanceof SkillInvocationMessageComponent) ||
        !(added.length === 1 && !skill.skillBlock.userMessage || added.length === 3 && gap instanceof Spacer && user instanceof UserMessageComponent)) return result;
    const card: Card = { skill, user, gap };
    cards.set(skill, card);
    if (user) users.set(user, card);
    if (gap) card.detachGap = chainNativeMethod(gap, 'render', function(native, width) { return enabled(card) ? [] : native.call(this, width); });
    publish(card);
    return result;
  });
  const detachUser = chainNativeMethod(UserMessageComponent.prototype, 'render', function(native, width) {
    const card = users.get(this);
    return card && rendering !== card && enabled(card) ? [] : native.call(this, width);
  });
  const detachSkill = chainNativeMethod(SkillInvocationMessageComponent.prototype, 'render', function(native, width) {
    const card = cards.get(this);
    if (!card) return native.call(this, width);
    publish(card);
    return enabled(card) ? renderCard(card, width) : native.call(this, width);
  });
  const detachMouse = chainNativeMethod(SkillInvocationMessageComponent.prototype, 'handleMouse', function(native, event) {
    const card = cards.get(this);
    if (!card || !enabled(card)) return native?.call(this, event);
    if (event.type === 'click' && event.button === 'left' && !event.ctrl && !event.alt && !event.shift && event.y >= 1 && event.y < card.headerEnd!) {
      release(); this.setExpanded(!this.expanded);
      pi.events.emit('compact-renderer:focus:v1', { owner: 'editor' }); redraw();
      return { handled: true, render: true };
    }
    if (card.user && card.userStart !== undefined && event.y >= card.userStart && event.y < card.userStart + card.userHeight! - 2) {
      return card.user.handleMouse?.({ ...event, y: event.y - card.userStart + 1, height: card.userHeight });
    }
  });
  const prune = () => {
    const mounted = new Set(host?.chatContainer?.children || []);
    for (const [skill, card] of cards) if (!mounted.has(skill)) { card.detachGap?.(); delete skill[projectedChildren]; cards.delete(skill); }
  };
  const reset = (_event: any, context: any) => {
    input?.(); input = undefined; release(); prune();
    ctx = context; active = context.mode === 'tui';
    for (const card of cards.values()) publish(card);
    if (active) input = ctx.ui.onTerminalInput?.((data: string) => {
      if (!selected || !enabled(selected)) return;
      if (matchesKey(data, 'enter')) { selected.skill.setExpanded(!selected.skill.expanded); redraw(); return { consume: true }; }
      const escape = matchesKey(data, 'escape'); release();
      pi.events.emit('compact-renderer:inspection-ended:v1', {}); redraw();
      if (escape) return { consume: true };
    });
    redraw();
  };
  const clear = () => {
    active = false; input?.(); input = undefined; release();
    for (const card of cards.values()) { card.detachGap?.(); delete card.skill[projectedChildren]; }
    cards.clear(); ctx = undefined;
  };
  const subscriptions = [
    pi.on('session_start', reset), pi.on('session_tree', reset), pi.on('session_compact', reset), pi.on('session_before_switch', clear),
    pi.on('ui_prompt_start', release),
    pi.events.on('compact-renderer:focus:v1', (event: any) => { if (event?.owner !== 'skills') release(); }),
    pi.events.on('compact-renderer:inspect:v1', (request: any) => {
      if (!active || !mode.isEnabled()) return;
      prune();
      for (const [index, card] of [...cards.values()].entries()) if (enabled(card)) request?.add?.({ id: `skill-${index}`, kind: 'Skill', label: `/skill:${card.skill.skillBlock.name}`, focus: () => focus(card) });
    }),
    mode.onChange(() => { release(); for (const card of cards.values()) publish(card); redraw(); }),
  ];
  const dispose = () => {
    if (disposed) return; disposed = true; clear(); subscriptions.forEach(off => off?.());
    detachMouse(); detachSkill(); detachUser(); detachAdd(); redraw();
    if (shared[owner] === dispose) delete shared[owner];
  };
  subscriptions.push(pi.on('session_shutdown', dispose));
  shared[owner] = dispose;
  return dispose;
}
