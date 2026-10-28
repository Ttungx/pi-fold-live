import type { DisplayMode } from './display-mode.ts';
import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { hiddenThinkingShape, mixedThinkingRegion, installModernThinkingAdapter } from "./modern-thinking-adapter.ts";
import { recordedPaneHeight } from "./modern-recorded-pane.ts";
import { ToolPane, type PaneAction } from "./modern-tool-pane.ts";

type Round = { id: number; sources?: string[]; action?: PaneAction; message: any; hasThinking: boolean; joinsPrevious: boolean; component?: any; kind: "round" | "bridge" | "boundary"; group?: ThinkingGroup };
type ThinkingGroup = { members: Round[]; pane: ToolPane; activeEpoch?: number; activeResult?: boolean };
/** The label is an extract from recorded text, never a generated summary.
 * Limit work even when the first line has millions of characters. */
export function recordedThinkingLabel(sources: readonly string[]): string {
  const sample = Array.from((sources[0] || "").slice(0, 1024).replace(/[\uD800-\uDBFF]$/, "")).slice(0, 512).join("");
  const heading = sample.match(/^ {0,3}#{1,6}[ \t]+([^\r\n]+)/m)?.[1];
  const first = sample.trimStart().match(/^[^\r\n]+/)?.[0] || "";
  const sentence = first.match(/^.*?[.!?。！？](?:\s|$)/u)?.[0] || first;
  const extract = (heading || sentence).replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_match, bold, underlined) => bold || underlined).replace(/`([^`]+)`/g, "$1").replace(/[\p{Cc}\p{Cf}]/gu, char => `\\u${char.codePointAt(0)!.toString(16).padStart(4, "0")}`).trim();
  return truncateToWidth(extract || "Recorded thinking", 80, "…");
}

/** The newest recorded thinking line, for the one-row live view. It keeps the
 * tail of a growing paragraph so the row reads as continuous progress rather
 * than a label that changes only between segments. */
export function flowingThinkingLabel(sources: readonly string[]): string {
  const tail = (sources.at(-1) || "").slice(-512).replace(/[\uD800-\uDBFF]$/, "");
  const line = tail.split(/\r?\n/).map(value => value.trim()).filter(Boolean).at(-1) || "Recorded thinking";
  const text = line.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_match, bold, underlined) => bold || underlined)
    .replace(/`([^`]+)`/g, "$1").replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim() || "Recorded thinking";
  // Keep the newest columns, so the row reads as progress instead of a chop.
  const chars = Array.from(text);
  let width = visibleWidth(text), from = 0;
  while (from < chars.length && width > 76) { width -= visibleWidth(chars[from]); from++; }
  return truncateToWidth(from ? `\u2026${chars.slice(from).join("")}` : text, 80, "\u2026");
}

const hasThinking = (message: any) => (message?.content || []).some((b: any) => b.type === "thinking" && typeof b.thinking === "string" && b.thinking.trim());
// A leading run can join earlier rounds only before the first visible reply.
// Track this separately from the broad boundary kind during streaming updates.
const joinsPreviousThinking = (message: any): boolean => {
  if (["error", "aborted", "length"].includes(message?.stopReason)) return false;
  let runs = 0, inRun = false, firstVisible: string | undefined, hasText = false;
  for (const block of message?.content || []) {
    if (!["thinking", "text", "toolCall"].includes(block.type) || block.type === "toolCall" && ["ask_user_question", "question"].includes(block.name)) return false;
    if (block.type !== "thinking") inRun = false;
    if (block.type === "thinking" && block.thinking?.trim()) {
      firstVisible ??= "thinking";
      if (!inRun) { runs++; inRun = true; }
    } else if (block.type === "text" && block.text?.trim()) { firstVisible ??= "text"; hasText = true; }
  }
  return hasText && firstVisible === "thinking" && runs === 1;
};
const supportedThinking = (component: any, message: any) => hiddenThinkingShape(component, message) || !!mixedThinkingRegion(component, message);
const classify = (message: any): Round["kind"] => {
  if (["error", "aborted", "length"].includes(message?.stopReason) || (message?.content || []).some((b: any) => b.type === "text" && b.text?.trim() || b.type === "toolCall" && ["ask_user_question", "question"].includes(b.name))) return "boundary";
  return hasThinking(message) ? "round" : "bridge";
};
const boundary = (m: any) => m?.role === "toolResult" ? !!m.isError || ["ask_user_question", "question"].includes(m.toolName) || ["cancelled", "unavailable"].includes(m.details?.status) && m.toolName === "ask_user_question" : !["system"].includes(m?.role) && !(m?.role === "custom" && m.display === false);

/** Recorded object identity and public event order determine membership. No content
 * matching, generated summaries, transcript writes, or model calls. */
export class ModernThinkingGroups {
  private records: (Round | null)[] = [];
  private aliases = new WeakMap<object, Round>();
  private components = new WeakMap<object, Round>();
  private boundaries = new WeakSet<object>();
  private live?: Round;
  private dirty = true;
  private epoch = 0;
  private groups: ThinkingGroup[] = [];
  private selected?: ThinkingGroup;
  /** Follow holds one row for a whole thinking phase, not for one segment. */
  private followPhase = false;
  private replaying = false;
  private layouts = new WeakMap<object, { width: number; height: number }>();
  focused = false;
  constructor(private enabled: () => boolean, private theme: () => any, private focus: (inspection?: { target: (component: any) => boolean; label: string }) => void, private inspectionEnded: () => void = () => {}, private follow: () => boolean = () => false) {}
  clear() { this.records = []; this.followPhase = false; this.aliases = new WeakMap(); this.components = new WeakMap(); this.boundaries = new WeakSet(); this.layouts = new WeakMap(); this.live = undefined; this.groups = []; this.selected = undefined; this.focused = false; this.dirty = true; this.epoch++; }
  rebuild(entries: readonly any[]) {
    this.clear();
    // Replayed history is settled: no phase, no flowing label. Only live events
    // open a thinking phase.
    this.replaying = true;
    try {
      for (const entry of entries) {
        if (entry.type === "message") this.observe("end", entry.message);
        else if (["compaction", "branch_summary"].includes(entry.type) || entry.type === "custom_message" && entry.display !== false) this.records.push(null);
      }
    } finally { this.replaying = false; }
  }
  /** A thinking phase starts with recorded reasoning and ends at the next action:
   * a visible reply, a tool result, a terminal stop reason, or a tool start. */
  private trackFollowPhase(phase: "start" | "update" | "end", message: any) {
    if (this.replaying) { this.followPhase = false; return; }
    if (message.role !== "assistant") { this.followPhase = false; return; }
    const visible = Array.isArray(message.content) && message.content.some((block: any) => block.type === "text" && block.text?.trim());
    if (visible || phase === "end" && ["stop", "error", "aborted", "length"].includes(message.stopReason)) this.followPhase = false;
    else if (hasThinking(message)) this.followPhase = true;
  }
  observe(phase: "start" | "update" | "end", message: any) {
    if (!message || typeof message !== "object") return;
    this.epoch++;
    this.trackFollowPhase(phase, message);
    if (message.role !== "assistant") {
      if (boundary(message) && !this.boundaries.has(message)) { this.records.push(null); this.boundaries.add(message); this.live = undefined; this.dirty = true; }
      return;
    }
    let record = this.aliases.get(message) || (phase === "start" ? undefined : this.live);
    if (!record) { record = { id: this.records.length, message, hasThinking: hasThinking(message), joinsPrevious: joinsPreviousThinking(message), kind: classify(message) }; this.records.push(record); this.dirty = true; }
    // Native streaming messages can share a mutated content array.
    const thinking = hasThinking(message);
    if (record.hasThinking !== thinking) { record.hasThinking = thinking; this.dirty = true; }
    const joinsPrevious = joinsPreviousThinking(message);
    if (record.joinsPrevious !== joinsPrevious) { record.joinsPrevious = joinsPrevious; this.dirty = true; }
    record.message = message; this.aliases.set(message, record);
    const kind = classify(message);
    if (record.kind !== kind) { record.kind = kind; this.dirty = true; }
    this.live = phase === "end" ? undefined : record;
  }
  associate(component: any, message: any) {
    this.epoch++;
    const previous = this.components.get(component), record = this.aliases.get(message);
    if (previous && previous !== record && previous.component === component) previous.component = undefined;
    if (!record) { this.components.delete(component); return; }
    if (record.component && record.component !== component) this.components.delete(record.component);
    record.component = component; this.components.set(component, record);
  }
  private regroup() {
    if (!this.dirty) return;
    this.dirty = false;
    const previous = new Map(this.groups.map(group => [group.members[0], group]));
    this.groups = [];
    let members: Round[] = [];
    const flush = () => {
      if (!members.length) return;
      const group = previous.get(members[0]) || { members: [], pane: new ToolPane([], "", recordedPaneHeight) };
      group.members = members;
      for (const record of members) record.group = group;
      this.groups.push(group); members = [];
    };
    for (const record of this.records) {
      if (record) record.group = undefined;
      if (!record || record.kind === "boundary") {
        const message = record?.message;
        const mixed = record && hasThinking(message) && message.content.some((block: any) => block.type === "text" && block.text?.trim());
        // Leading thinking precedes this reply boundary and belongs with the
        // previous rounds. Text-first runs and failed/question messages stay separate.
        if (!record?.joinsPrevious) flush();
        if (mixed) members.push(record);
        flush();
      }
      else if (record.kind === "round") members.push(record);
    }
    flush();
    if (this.selected && !this.groups.includes(this.selected)) { this.selected = undefined; this.focused = false; }
  }
  private active(group?: ThinkingGroup): group is ThinkingGroup {
    if (!group || !this.enabled()) return false;
    if (group.activeEpoch !== this.epoch) {
      group.activeResult = group.members.every(record => record.component && this.components.get(record.component) === record && hasThinking(record.message)
        && (record.kind === "round" ? hiddenThinkingShape(record.component, record.message) : !!mixedThinkingRegion(record.component, record.message)));
      group.activeEpoch = this.epoch;
    }
    return group.activeResult === true;
  }
  association(component: any) {
    this.regroup();
    const record = this.components.get(component);
    if (record && !supportedThinking(component, record.message)) this.epoch++;
    return record && record.component === component && this.active(record.group) ? { record, group: record.group } : undefined;
  }
  private choose(group: ThinkingGroup) {
    this.selected = group; this.focused = true;
    const component = group.members.at(-1)?.component;
    this.focus({ target: candidate => candidate === component, label: `Thinking · ${group.members.length} round${group.members.length === 1 ? "" : "s"}` });
  }
  private release() { this.focused = false; this.inspectionEnded(); }
  /** The next action owns the screen again: the thinking row folds on its own. */
  endFollowPhase(): boolean {
    if (!this.followPhase) return false;
    this.followPhase = false;
    return true;
  }
  /** Follow shows one row for the running thinking phase. Consecutive segments
   * belong to the same phase, so nothing opens or closes between them. */
  private followTarget(): ThinkingGroup | undefined {
    if (!this.follow() || !this.followPhase) return;
    for (let index = this.groups.length - 1; index >= 0; index--) if (this.active(this.groups[index])) return this.groups[index];
  }
  private sources(group: ThinkingGroup) {
    let changed = group.pane.actions.length !== group.members.length || group.pane.actions.some((action, index) => action.id !== String(group.members[index]?.id));
    group.pane.actions = group.members.map(record => {
      const sources = record.message.content.filter((block: any) => block.type === "thinking" && typeof block.thinking === "string" && block.thinking.trim()).map((block: any) => block.thinking);
      if (!record.sources || sources.length !== record.sources.length || sources.some((source: string, index: number) => source !== record.sources![index])) {
        record.sources = sources;
        record.action = { id: String(record.id), label: recordedThinkingLabel(sources), repeatedSummary: recordedThinkingLabel(sources), sections: () => record.sources!.map(text => ({ text, format: "markdown" as const })) };
        changed = true;
      }
      return record.action!;
    });
    if (changed) group.pane.reset();
  }
  disclosures(request: any) {
    this.regroup();
    for (const group of this.groups) if (this.active(group)) request?.add?.((component: any) => group.members.some(record => record.component === component), group.pane.open, () => {
      if (this.selected === group) { this.selected = undefined; this.focused = false; }
      group.pane.collapse();
    });
  }
  inspectionChoices() {
    this.regroup();
    return this.groups.filter(group => this.active(group)).map(group => {
      this.sources(group);
      return {
        id: `thinking:${group.members[0].id}`, kind: "Thinking" as const,
        label: `Thinking · ${group.members.length} round${group.members.length === 1 ? "" : "s"} · ${group.pane.actions[0]?.label || ""}`,
        focus: () => { if (this.active(group)) { group.pane.open = true; this.choose(group); } },
        target: () => group.members.at(-1)?.component,
      };
    });
  }
  render(component: any, width: number): string[] | undefined {
    const match = this.association(component);
    if (!match) return;
    const { record, group } = match;
    if (group.members.at(-1) !== record) return [];
    const pane = group.pane, theme = this.theme();
    this.sources(group);
    // A running phase reads as one row whose text keeps moving; an opened pane
    // and every finished phase keep the stable recorded label.
    const flowing = !pane.open && this.followTarget() === group;
    pane.title = flowing ? `Thinking · ${flowingThinkingLabel(group.members.at(-1)?.sources ?? [])}`
      : group.members.length === 1 ? `Thinking · ${pane.actions[0]?.label || "Recorded thinking"}` : `Thinking · ${group.members.length} rounds`;
    pane.directContent = group.members.length === 1;
    pane.focused = this.focused && this.selected === group;
    pane.theme = theme; pane.headingTone = "thinkingText"; pane.itemName = "round";
    pane.styleHeader = text => theme.fg("thinkingText", text);
    const rows = ["", ...pane.render(Math.max(1, width))];
    this.layouts.set(component, { width, height: rows.length });
    return rows;
  }
  mouse(component: any, event: any) {
    const match = this.association(component), layout = this.layouts.get(component);
    if (!match || match.group.members.at(-1) !== match.record || !layout || event.x < 0 || event.x >= layout.width || event.y < 1 || event.y >= layout.height) return;
    // Mouse inspection never takes keyboard focus from the native editor.
    const handled = match.group.pane.handleMouse({ ...event, y: event.y - 1 });
    if (handled) { this.focused = false; match.group.pane.focused = false; this.focus(); }
    return handled;
  }
  input(data: string): boolean {
    if (!this.enabled()) { this.focused = false; return false; }
    this.regroup();
    if (matchesKey(data, "alt+t")) {
      const active = this.groups.filter(group => this.active(group));
      if (!active.length) return false;
      const index = this.focused ? active.indexOf(this.selected!) : -1;
      this.choose(index < 0 ? active.at(-1)! : active[(index + active.length - 1) % active.length]);
      return true;
    }
    if (!this.focused || !this.active(this.selected)) { this.focused = false; return false; }
    if (matchesKey(data, "escape")) { this.release(); return true; }
    if (this.selected.pane.handle(data)) return true;
    this.release();
    return false;
  }
}

export function registerModernThinking(pi: ExtensionAPI, mode: DisplayMode, follow?: DisplayMode): () => void {
  const owner = Symbol.for("compact-renderer:thinking-registration:v1"), shared = globalThis as any;
  shared[owner]?.();
  let groups: ModernThinkingGroups | undefined, adapter: (() => void) | undefined, input: (() => void) | undefined;
  let redraw: (() => void) | undefined, disposed = false;
  const stop = () => { input?.(); input = undefined; adapter?.(); adapter = undefined; groups?.clear(); groups = undefined; redraw = undefined; };
  const rebuild = (_event: unknown, ctx: any) => {
    if (disposed) return;
    stop();
    if (ctx.mode !== "tui" || typeof ctx.ui.setHiddenThinkingLabel !== "function" || !ctx.sessionManager || (typeof ctx.sessionManager.buildContextEntries !== "function" && typeof ctx.sessionManager.getBranch !== "function")) return;
    const ui = ctx.ui, theme = ui.theme;
    groups = new ModernThinkingGroups(() => mode.isEnabled(), () => theme, inspection => {
      redraw?.();
      pi.events.emit("compact-renderer:focus:v1", { owner: inspection ? "thinking" : "editor", ...inspection });
    }, () => pi.events.emit("compact-renderer:inspection-ended:v1", { owner: "thinking" }), () => follow?.isEnabled() === true);
    // Match the native transcript sequence, including retained compaction entries.
    const sessions = ctx.sessionManager;
    groups.rebuild(typeof sessions.buildContextEntries === "function" ? sessions.buildContextEntries() : sessions.getBranch());
    adapter = installModernThinkingAdapter({ associate: (c, m) => groups?.associate(c, m), render: (c, w) => groups?.render(c, w), mouse: (c, e) => groups?.mouse(c, e), clear: () => groups?.clear() });
    if (!adapter) { groups.clear(); groups = undefined; return; }
    redraw = () => ui.setHiddenThinkingLabel();
    input = ui.onTerminalInput?.((data: string) => {
      const wasFocused = groups?.focused;
      if (groups?.input(data)) { redraw?.(); return { consume: true }; }
      if (wasFocused && !groups?.focused) redraw?.();
    });
    redraw();
  };
  const subscriptions: (() => void)[] = [];
  for (const event of ["session_start", "session_tree", "session_compact"] as const) subscriptions.push(pi.on(event, rebuild));
  for (const [event, phase] of [["message_start", "start"], ["message_update", "update"], ["message_end", "end"]] as const) subscriptions.push(pi.on(event, (event: any) => groups?.observe(phase, event.message)));
  subscriptions.push(pi.on("ui_prompt_start", () => { if (groups) groups.focused = false; }));
  // The next action owns the screen: the thinking row folds before the tool runs.
  subscriptions.push(pi.on("tool_execution_start", () => { if (groups?.endFollowPhase()) redraw?.(); }));
  subscriptions.push(pi.on("session_shutdown", stop));
  subscriptions.push(pi.events.on("compact-renderer:disclosures:v1", (request: any) => groups?.disclosures(request)));
  subscriptions.push(pi.events.on("compact-renderer:inspect:v1", (event: any) => { for (const choice of groups?.inspectionChoices() || []) event?.add?.(choice); }));
  subscriptions.push(pi.events.on("compact-renderer:focus:v1", (event: any) => { if (event?.owner !== "thinking" && groups) groups.focused = false; }));
  subscriptions.push(mode.onChange(() => { if (groups) groups.focused = false; redraw?.(); }));
  if (follow) subscriptions.push(follow.onChange(() => redraw?.()));
  const dispose = () => { if (disposed) return; disposed = true; for (const unsub of subscriptions) unsub?.(); const repaint = redraw; stop(); if (shared[owner] === dispose) delete shared[owner]; repaint?.(); };
  shared[owner] = dispose;
  return dispose;
}
