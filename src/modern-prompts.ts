import type { DisplayMode } from './display-mode.ts';
import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Markdown, matchesKey, stripTerminalSequences, truncateToWidth } from "@earendil-works/pi-tui";
import { readFileSync } from "node:fs";
import { installModernPromptAdapter, invalidateModernPrompt } from "./modern-prompts-adapter.ts";

type Template = { name: string; parts: string[]; description?: string };
type PromptCard = { component: any; original: string; name?: string; open: boolean; eligible: boolean; revision: number; controlStart?: number; controlEnd?: number };
const promptLabel = (card: PromptCard) => card.name ? `/${card.name}` : "Submitted prompt";
const blankPromptRow = (row: string) => !stripTerminalSequences(row).trim();
function promptExcerpts(rows: string[]): { opening: string[]; ending: string[] } {
  let first = 0, last = rows.length;
  while (first < last && blankPromptRow(rows[first])) first++;
  while (last > first && blankPromptRow(rows[last - 1])) last--;
  let openingEnd = first;
  while (openingEnd < Math.min(first + 3, last) && !blankPromptRow(rows[openingEnd])) openingEnd++;
  let paragraphStart = last;
  while (paragraphStart > openingEnd && !blankPromptRow(rows[paragraphStart - 1])) paragraphStart--;
  const endingStart = Math.max(openingEnd, paragraphStart, last - 2);
  return { opening: rows.slice(first, openingEnd), ending: rows.slice(endingStart, last) };
}
const placeholders = /\$\{(?:\d+|ARGUMENTS|@):-[^}]*\}|\$\{@:\d+(?::\d+)?\}|\$(?:ARGUMENTS|@|\d+)/g;
export function modernPromptTemplates(commands: readonly any[]): Template[] {
  const templates: Template[] = [];
  for (const command of commands) {
    if (command.source !== "prompt" || commands.some(c => c.source === "extension" && c.name === command.name)) continue;
    try {
      const raw = readFileSync(command.sourceInfo.path, "utf8");
      if (raw.length > 100000) continue;
      const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "").trim();
      const parts = body.split(placeholders);
      if (parts[0].length >= 40 && parts.length <= 33) templates.push({ name: command.name, parts, description: typeof command.description === "string" ? command.description : undefined });
    } catch { /* Missing templates leave their original text visible. */ }
  }
  return templates;
}
export function matchingModernPrompt(text: string, templates: readonly Template[]): string | undefined {
  const value = text.trim();
  if (value.length > 200000) return;
  for (const { name, parts } of templates) {
    if (parts.length === 1) { if (value === parts[0]) return name; continue; }
    const first = parts[0].trimStart(), last = parts.at(-1)!.trimEnd();
    if (!value.startsWith(first) || last && !value.endsWith(last)) continue;
    let position = first.length, matches = true;
    for (const part of parts.slice(1, -1)) {
      const next = value.indexOf(part, position);
      if (next < 0) { matches = false; break; }
      position = next + part.length;
    }
    if (matches && (!last || position <= value.length - last.length)) return name;
  }
}

/** Bounded display text from existing metadata or the recorded expansion, never a model summary. */
export function modernPromptSummary(original: string, description?: string): string {
  const sample = (description?.trim() || original).slice(0, 1024).replace(/[\uD800-\uDBFF]$/, "");
  const text = sample.replace(/^[ \t]*#{1,6}[ \t]+/gm, "").replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim();
  const sentence = description?.trim() ? text : text.match(/^.*?[.!?。！？](?:\s|$)/u)?.[0]?.trim() || text;
  return truncateToWidth(sentence, 110, "…").replace(/\x1b\[[0-9;]*m/g, "");
}

/** Display only: the public transformer sees the original Markdown. Its output
 * does not replace messages, prompt expansion, transcript entries, or model input. */
export function registerModernPrompts(pi: ExtensionAPI, mode: DisplayMode): () => void {
  const owner = Symbol.for("compact-renderer:prompt-registration:v1"), shared = globalThis as any;
  shared[owner]?.();
  let templates: Template[] = [], cards = new Map<any, PromptCard>();
  let rendering: PromptCard | undefined, selected: PromptCard | undefined;
  let focused = false, active = false, disposed = false, revision = 0, redraw: (() => void) | undefined, input: (() => void) | undefined, theme: any;
  const invalidate = () => { for (const card of cards.values()) invalidateModernPrompt(card.component); };
  const release = () => { if (focused) { focused = false; revision++; } };
  const select = (card: PromptCard, open = false) => {
    if (!card.eligible) return;
    selected = card; focused = true; if (open) card.open = true;
    revision++; redraw?.();
    pi.events.emit("compact-renderer:focus:v1", { owner: "prompts", label: `Prompt ${promptLabel(card)}`, target: (component: any) => component === card.component });
  };
  const adapter = installModernPromptAdapter({
    render(component, markdown, original) {
      if (disposed || !active || !mode.isEnabled()) return original();
      const name = matchingModernPrompt(markdown, templates);
      let card = cards.get(component);
      if (!name) {
        // Count the native rendered body, excluding its top/bottom padding. The
        // native Markdown cache handles width changes and retains all formatting.
        const lines = original(), native = component.children[0];
        const padding = native.paddingY;
        if (padding !== 1 || !Number.isFinite(native.cachedWidth)) {
          if (card) { cards.delete(component); if (selected === card) { selected = undefined; release(); } }
          return lines;
        }
        if (card && card.original !== markdown) { card.original = markdown; card.open = false; }
        if (lines.length - padding * 2 <= 8) {
          // Width can temporarily make a long prompt short. Retain its chosen
          // expansion state, but remove controls and inspection while it fits.
          if (card) {
            card.eligible = false;
            if (selected === card) { selected = undefined; release(); pi.events.emit("compact-renderer:inspection-ended:v1", {}); }
          }
          return lines;
        }
        if (!card || card.name) { card = { component, original: markdown, open: false, eligible: true, revision: -1 }; cards.set(component, card); }
        card.eligible = true;
        const controlText = `${card.open ? "▴ Show less" : "⋯ Show more"}${focused && selected === card ? " · Enter toggles · Esc returns" : ""}`;
        const control = new Markdown(controlText, native.paddingX, 0, native.theme, {
          ...native.defaultTextStyle, bold: false,
          color: (text: string) => theme?.fg("muted", text) ?? native.defaultTextStyle?.color?.(text) ?? text,
        });
        const controlLines = control.render(native.cachedWidth);
        const blank = " ".repeat(native.cachedWidth), gap = native.defaultTextStyle?.bgColor?.(blank) ?? blank;
        const excerpts = card.open ? undefined : promptExcerpts(lines.slice(padding, -padding));
        const before = card.open ? [...lines.slice(0, -padding), gap] : [...lines.slice(0, padding), ...excerpts!.opening, gap];
        card.controlStart = before.length;
        card.controlEnd = before.length + controlLines.length;
        // Keep the native prompt-zone markers on the first/last padding rows.
        // Pi 1.3.0 supplies one padding row at each end of user Markdown.
        return [...before, ...controlLines, ...(excerpts ? [gap, ...excerpts.ending] : []), ...lines.slice(-padding)];
      }
      if (!card) { card = { component, original: markdown, name, open: false, eligible: true, revision: -1 }; cards.set(component, card); }
      card.eligible = true;
      if (card.original !== markdown) { card.original = markdown; card.open = false; card.revision = -1; }
      if (card.revision !== revision || card.name !== name) { invalidateModernPrompt(component); card.revision = revision; card.name = name; }
      const previous = rendering;
      rendering = card;
      try { return original(); } finally { rendering = previous; }
    },
    fallback(component) { cards.delete(component); if (selected?.component === component) { selected = undefined; release(); } },
    mouse(component, event) {
      const card = cards.get(component);
      const onControl = card?.name ? event.y === 1 : card && event.y >= card.controlStart! && event.y < card.controlEnd!;
      if (!disposed && active && mode.isEnabled() && card?.eligible && event.type === "click" && event.button === "left" && onControl) {
        release(); pi.events.emit("compact-renderer:focus:v1", { owner: "editor" });
        card.open = !card.open; revision++; return { handled: true, render: true };
      }
    },
  });
  // No usable inline adapter means no collapse. Unsupported hosts show originals.
  pi.registerMarkdownTransformer((markdown, context) => {
    if (disposed || !active || !adapter || !mode.isEnabled() || context.messageType !== "user" || !rendering || markdown !== rendering.original) return markdown;
    const label = rendering.name!.replace(/[\\`*_\[\]<>\p{Cc}\p{Cf}]/gu, "");
    const heading = `**${rendering.open ? "▾" : "▸"} prompt · /${label}**${focused && selected === rendering ? ` · Enter ${rendering.open ? "collapses" : "expands"} · Esc returns` : ""}`;
    const summary = modernPromptSummary(markdown, templates.find(template => template.name === rendering.name)?.description);
    return rendering.open ? `${heading}\n\n${markdown}` : `${heading} — ${summary}`;
  });
  const reset = (_event: unknown, ctx: any) => {
    invalidate(); cards.clear(); rendering = undefined; selected = undefined; focused = false; revision++;
    input?.(); input = undefined; redraw = undefined; active = false;
    if (disposed) return;
    templates = modernPromptTemplates(pi.getCommands());
    if (ctx.mode !== "tui" || !adapter) return;
    active = true;
    const ui = ctx.ui;
    theme = ui.theme;
    redraw = typeof ui.setHiddenThinkingLabel === "function" ? () => ui.setHiddenThinkingLabel() : undefined;
    input = ui.onTerminalInput?.((data: string) => {
      if (!mode.isEnabled()) { release(); return; }
      if (matchesKey(data, "alt+i")) {
        const choices = [...cards.values()].filter(card => card.eligible);
        if (!choices.length) return;
        const index = focused ? choices.indexOf(selected!) : -1;
        select(index < 0 ? choices.at(-1)! : choices[(index + choices.length - 1) % choices.length]);
        // Focus appears in the same short label on the next render.
        revision++; redraw?.(); return { consume: true };
      }
      if (!focused || !selected?.eligible || !cards.has(selected.component)) return;
      if (matchesKey(data, "escape")) { release(); pi.events.emit("compact-renderer:inspection-ended:v1", {}); redraw?.(); return { consume: true }; }
      if (matchesKey(data, "enter")) { selected.open = !selected.open; revision++; redraw?.(); return { consume: true }; }
      release(); pi.events.emit("compact-renderer:inspection-ended:v1", {}); redraw?.();
    });
    redraw?.();
  };
  const subscriptions: (() => void)[] = [];
  for (const event of ["session_start", "session_tree", "session_compact"] as const) subscriptions.push(pi.on(event, reset));
  subscriptions.push(pi.events.on("compact-renderer:inspect:v1", (request: any) => {
    if (disposed || !active || !mode.isEnabled()) return;
    [...cards.values()].filter(card => card.eligible).forEach((card, index) => request?.add?.({ id: `prompt-${index}`, kind: "Prompt", label: `${promptLabel(card)} — ${modernPromptSummary(card.original, templates.find(template => template.name === card.name)?.description)}`, focus: () => { if (!disposed && active && mode.isEnabled() && cards.get(card.component) === card) select(card, true); } }));
  }));
  subscriptions.push(pi.on("ui_prompt_start", release));
  subscriptions.push(pi.on("session_shutdown", () => { active = false; invalidate(); input?.(); input = undefined; redraw = undefined; cards.clear(); selected = undefined; rendering = undefined; release(); }));
  subscriptions.push(pi.events.on("compact-renderer:focus:v1", (event: any) => { if (event?.owner !== "prompts") release(); }));
  subscriptions.push(mode.onChange(() => { revision++; release(); invalidate(); redraw?.(); }));
  const dispose = () => { if (disposed) return; disposed = true; active = false; for (const unsub of subscriptions) unsub?.(); input?.(); input = undefined; invalidate(); cards.clear(); adapter?.(); redraw?.(); redraw = undefined; release(); if (shared[owner] === dispose) delete shared[owner]; };
  shared[owner] = dispose;
  return dispose;
}
