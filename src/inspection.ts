import type { RuntimeCompatibility } from './runtime-compatibility.ts';
import type { DisplayMode } from './display-mode.ts';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import * as nativeTui from '@earendil-works/pi-tui';
import type { Component, ScrollView as NativeScrollView } from '@earendil-works/pi-tui';
const { Container, ScrollView, isViewportTUI } = nativeTui;
import { projectedChildren } from './work-strip-view.ts';
import { installFullscreenOverlayGuard, supportsOverlayHost } from './fullscreen-overlays.ts';

type Choice = { id: string; kind: string; label: string; focus(): void };
type Target = (component: Component) => boolean;
const children = (component: any): Component[] => [...(Array.isArray(component?.[projectedChildren]) ? component[projectedChildren] : Array.isArray(component?.children) ? component.children : []), ...(component?.child && typeof component.child.render === 'function' ? [component.child] : [])];

/** Pi 1.3 viewport seam. Read the mounted tree; never replace its layout/root. */
export function revealInspection(tui: any, target: Target, version?: string): boolean {
  if (typeof isViewportTUI !== 'function' || typeof ScrollView !== 'function' || !tui || !isViewportTUI(tui) || typeof tui.getMountedRoots !== 'function') return false;
  const scrolls: NativeScrollView[] = [], seen = new Set<Component>();
  const find = (component: Component) => {
    if (seen.has(component)) return; seen.add(component);
    if (component instanceof ScrollView && component.primary) { scrolls.push(component); return; }
    children(component).forEach(find);
  };
  for (const root of tui.getMountedRoots()) find(root);
  if (scrolls.length !== 1) return false;
  const scroll = scrolls[0], document = scroll.children[0];
  if (!document || typeof scroll.getContentWidth !== 'function' || typeof scroll.scrollTo !== 'function' || typeof tui.requestRender !== 'function' || !Number.isFinite(tui.terminal?.columns)) return false;
  const width = scroll.getContentWidth(Math.max(1, tui.terminal.columns));
  // Opening a work strip changes its projected child list. Measure before the
  // traversal so nested inspection uses the same tree as native mouse layout.
  document.render(width);
  const contains = (component: Component, visited = new Set<Component>()): boolean => {
    if (visited.has(component)) return false; visited.add(component);
    return target(component) || children(component).some(child => contains(child, visited));
  };
  let row = 0, found: number | undefined;
  const visit = (component: Component) => {
    if (found !== undefined) return;
    // Plain Containers add no own spacing. Subclasses own their final rendered height.
    if (component.constructor === Container) { for (const child of children(component)) visit(child); return; }
    const height = component.render(width).length;
    if (height && contains(component)) { found = row; return; }
    row += height;
  };
  visit(document);
  if (found === undefined) return false;
  scroll.scrollTo(found, { disableFollow: true }); tui.requestRender();
  return true;
}

/** Native picker plus visible focus status. No model tools, transcript or editor mutation. */
export function registerInspection(pi: ExtensionAPI, mode: DisplayMode, compatibility?: RuntimeCompatibility): () => void {
  let ui: any, tui: any, disposed = false;
  let restoreFullscreenOverlays: (() => void) | undefined;
  let revealTimer: ReturnType<typeof setTimeout> | undefined;
  const clearStatus = () => { if (revealTimer) clearTimeout(revealTimer); revealTimer = undefined; ui?.setStatus?.('compact-inspection', undefined); };
  const clear = () => { clearStatus(); restoreFullscreenOverlays?.(); restoreFullscreenOverlays = undefined; ui?.setWidget?.('compact-inspection-host', undefined); ui = undefined; tui = undefined; };
  const subscriptions = [
    pi.on('session_start', (_event, ctx) => {
      clear(); if (disposed || !ctx.hasUI) return; ui = ctx.ui;
      if (typeof ui.select !== 'function') compatibility?.disable('inspection', 'ui.select missing');
      if (typeof ui.setWidget !== 'function') { compatibility?.disable('reveal', 'ui.setWidget missing'); compatibility?.disable('overlays', 'TUI host unavailable'); }
      // This zero-row widget only obtains the supported TUI handle. It owns no root.
      ui.setWidget?.('compact-inspection-host', (host: any) => {
        tui = host; restoreFullscreenOverlays?.();
        if (typeof isViewportTUI !== 'function' || !isViewportTUI(host) || typeof host?.getMountedRoots !== 'function' || typeof host?.requestRender !== 'function' || !Number.isFinite(host?.terminal?.columns)) compatibility?.disable('reveal', 'viewport host unavailable');
        if (!supportsOverlayHost(host)) compatibility?.disable('overlays', 'overlay host unavailable');
        if (!compatibility || compatibility.available('overlays')) restoreFullscreenOverlays = installFullscreenOverlayGuard(host);
        return { render: () => [], invalidate() {} };
      });
    }),
    pi.on('session_before_switch', clear), pi.on('session_shutdown', clear),
    pi.on('ui_prompt_start', clearStatus), pi.on('session_tree', clearStatus), pi.on('session_compact', clearStatus), mode.onChange(clearStatus),
    pi.events.on('compact-renderer:inspection-ended:v1', clearStatus),
    pi.events.on('compact-renderer:focus:v1', (event: any) => {
      if (event?.owner === 'editor') { clearStatus(); return; }
      if (!event?.target || disposed || !mode.isEnabled()) return;
      clearStatus();
      revealInspection(tui, event.target);
      // Opening a pane changes the layout height. Reapply once after the native
      // render frame has measured it; do not poll or replace the layout root.
      revealTimer = setTimeout(() => { revealTimer = undefined; if (!disposed) revealInspection(tui, event.target); }, 30);
      ui?.setStatus?.('compact-inspection', `Inspecting ${event.owner === 'work' ? 'work' : event.owner === 'tools' ? 'tools' : event.owner === 'thinking' ? 'thinking' : event.owner === 'subagents' ? 'subagents' : 'prompt'} · Esc or type to return`);
    }),
  ];
  pi.registerCommand('inspect', {
    description: 'Select tools, subagent activity, thinking, or a prompt to inspect',
    async handler(_args, ctx) {
      if (!ctx.hasUI || disposed || typeof ctx.ui.select !== 'function') return;
      if (!mode.isEnabled()) { ctx.ui.notify('Use /fold on to inspect grouped blocks.', 'info'); return; }
      const choices: Choice[] = [];
      pi.events.emit('compact-renderer:inspect:v1', { add(choice: Choice) { if (choice && typeof choice.focus === 'function') choices.push(choice); } });
      if (!choices.length) { ctx.ui.notify('No Pi Fold blocks to inspect yet.', 'info'); return; }
      const labels = choices.map((choice, index) => `${index + 1}. ${choice.kind} — ${choice.label.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').slice(0, 160)}`);
      const selected = await ctx.ui.select('Inspect a block', labels);
      const index = selected === undefined ? -1 : labels.indexOf(selected);
      if (index >= 0 && !disposed && mode.isEnabled()) choices[index].focus();
    },
  });
  return () => { if (disposed) return; disposed = true; clear(); subscriptions.forEach(off => { if (typeof off === 'function') off(); }); };
}
