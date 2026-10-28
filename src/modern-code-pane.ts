import { matchesKey, truncateToWidth, visibleWidth, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { activityHeading, activityRow, cardContentWidth } from "./display-card.ts";
import { CodeContent } from "./modern-code-content.ts";

/** Native-style codemode with lazy bounded text/call formatting. Native-off stays stock. */
export class CodePane {
  open = false; focused = false; offset = 0;
  heading = "codemode · Preparing";
  title = "codemode · Preparing"; theme?: any; tone = "syntaxVariable";
  content = new CodeContent();
  private rows: string[] = []; private iterator?: Iterator<string>; private done = false; private width = 0;
  private lastWidth = 0; private lastHeight = 0; private lastBodyHeight = 0; private lastMore = false;
  private startedAt?: number; private endedAt?: number; private interval?: ReturnType<typeof setInterval>;
  private themeKey = "";
  private partial = false; private isError = false; private durationMs?: number;
  private revision = -1;
  paintedRows = 0;
  constructor(private height: () => number) {}
  get duration() { return this.durationMs; }
  get clock() { return { startedAt: this.startedAt, endedAt: this.endedAt }; }
  adoptClock(clock: { startedAt?: number; endedAt?: number }) { this.startedAt ??= clock.startedAt; this.endedAt ??= clock.endedAt; }
  suspend() { if (this.interval !== undefined) clearInterval(this.interval); this.interval = undefined; }
  dispose() { this.suspend(); this.rows = []; this.iterator = undefined; }
  collapse() { this.open = false; this.focused = false; this.offset = 0; this.reset(); }
  private reset() { this.rows = []; this.iterator = undefined; this.done = false; this.width = 0; }
  setTheme(theme: any) {
    const tokens = ["text", "toolTitle", "toolOutput", "mdCodeBlock", "muted", "dim", "warning", "error", "success", "syntaxKeyword", "syntaxString", "syntaxComment", "syntaxNumber", "syntaxFunction", "syntaxOperator", "syntaxPunctuation", "syntaxType", "syntaxVariable", "toolDiffAdded", "toolDiffRemoved"];
    const key = tokens.map(token => theme?.fg(token, "x") ?? "x").join("") + (theme?.bg("selectedBg", "x") ?? "x") + (theme?.bold("x") ?? "x");
    const changed = key !== this.themeKey;
    if (changed) { this.themeKey = key; this.reset(); }
    this.theme = theme;
    return changed;
  }
  update(args: any, result: any, revision: number, context: any) {
    this.content.update(args, result, revision);
    if (revision !== this.revision) { this.revision = revision; this.reset(); }
    if (context.executionStarted) this.startedAt ??= Date.now();
    if (this.durationMs !== context.durationMs || this.isError !== context.isError) this.reset();
    this.partial = context.isPartial; this.isError = context.isError; this.durationMs = context.durationMs;
    if (result && (!this.partial || this.isError)) { this.endedAt ??= Date.now(); this.suspend(); }
    else if (result && this.partial && this.startedAt !== undefined && !this.interval) this.interval = setInterval(() => context.invalidate(), 1000);
    return this.content.supported;
  }
  handle(data: string): boolean {
    if (matchesKey(data, "enter")) { this.open = !this.open; this.offset = 0; return true; }
    if (matchesKey(data, "home")) { this.open = true; this.offset = 0; return true; }
    if (["up", "down", "pageUp", "pageDown"].some(key => matchesKey(data, key as any))) {
      const down = matchesKey(data, "down") || matchesKey(data, "pageDown");
      const distance = matchesKey(data, "pageUp") || matchesKey(data, "pageDown") ? Math.max(1, this.height() - 2) : 1;
      this.open = true; this.offset = Math.max(0, this.offset + (down ? distance : -distance)); return true;
    }
    return false;
  }
  *contentRows(width: number, theme = this.theme, grouped = false): Generator<string> {
    if (grouped && this.durationMs !== undefined && !this.content.hasScriptHeader) {
      const timing = `Took ${(this.durationMs / 1000).toFixed(2)}s`;
      yield theme ? theme.fg("muted", timing) : timing;
    }
    yield* this.content.rows(width, theme, this.isError, !grouped && (this.durationMs !== undefined || this.startedAt !== undefined));
  }
  render(width: number): string[] {
    this.lastWidth = width;
    const contentWidth = cardContentWidth(width);
    const title = `${this.open ? "▾" : "▸"} ${this.title}${this.focused ? " · focused" : ""}`;
    // Keep category identity separate from secondary counts/timing. Failures override both.
    const label = `${this.open ? "▾" : "▸"} ${this.heading}`;
    const metadata = title.slice(label.length);
    const styled = this.theme
      ? activityHeading(label, this.theme, this.tone === "error" ? "error" : "syntaxVariable") +
        metadata.split(/( · \d+ nested (?:errors?|cancelled|unresolved))/).map(part =>
          this.theme.fg(this.tone === "error" ? "error" : this.tone === "warning" && /^ · \d+ nested (?:errors?|cancelled|unresolved)$/.test(part) ? "warning" : "muted", part)).join("")
      : title;
    const header = activityRow(styled, width, this.theme, this.focused);
    if (!this.open) { this.lastHeight = 1; this.lastBodyHeight = 0; this.lastMore = false; return [header]; }
    const indent = contentWidth >= 4 ? "  " : "";
    const nativeWidth = Math.max(1, contentWidth - indent.length);
    if (this.width !== nativeWidth) { this.reset(); this.width = nativeWidth; this.offset = 0; }
    this.iterator ??= this.contentRows(nativeWidth);
    const bodyHeight = Math.max(1, Math.min(20, this.height()) - 2);
    this.offset = Math.min(this.offset, this.rows.length);
    while (!this.done && this.rows.length <= this.offset + bodyHeight) {
      const row = this.iterator.next();
      if (row.done) this.done = true;
      else { this.rows.push(truncateToWidth(row.value, nativeWidth, "")); this.paintedRows++; }
    }
    if (this.done) this.offset = Math.min(this.offset, Math.max(0, this.rows.length - bodyHeight));
    const body = this.rows.slice(this.offset, this.offset + bodyHeight).map(row => activityRow(indent + row, width, this.theme));
    const more = !this.done || this.offset + bodyHeight < this.rows.length;
    const duration = (ms: number) => {
      const seconds = ms / 1000;
      if (seconds < 60) return `${seconds.toFixed(1)}s`;
      const total = Math.floor(seconds), minutes = Math.floor(total / 60), remainder = total % 60;
      return minutes < 60 ? `${minutes}m ${remainder}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m ${remainder}s`;
    };
    let timer = "";
    // Avoid repeating the heading's duration, but retain it below a clipped
    // heading so a narrow terminal does not lose the timing information.
    if (!this.partial && this.durationMs !== undefined && visibleWidth(title) > contentWidth) timer = `Took ${duration(this.durationMs)}`;
    else if (this.durationMs === undefined && this.startedAt !== undefined) timer = `${this.partial ? "Elapsed" : "Took"} ${duration((this.endedAt ?? Date.now()) - this.startedAt)}`;
    const footer = [more ? "more ↓" : this.offset > 0 ? "more ↑" : "", timer, this.focused ? "Enter collapse · ↑/↓ scroll · Home start · Esc release" : ""].filter(Boolean).join(" · ");
    const visible = [header, ...body, ...(footer ? [activityRow(this.theme ? this.theme.fg("muted", truncateToWidth(footer, contentWidth)) : truncateToWidth(footer, contentWidth), width, this.theme)] : [])];
    this.lastBodyHeight = body.length; this.lastMore = more;
    this.lastHeight = visible.length; return visible;
  }
  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.x < 0 || event.x >= this.lastWidth || event.y < 0 || event.y >= this.lastHeight) return undefined;
    if (event.type === "wheel" && this.open && Number.isFinite(event.wheelDelta) && event.wheelDelta) { this.offset = Math.max(0, this.offset + Math.max(-20, Math.min(20, Math.trunc(event.wheelDelta)))); return { handled: true }; }
    if (event.type !== "click" || event.button !== "left") return undefined;
    if (event.shift || event.alt || event.ctrl) return { handled: true, render: false };
    if (event.y === 0) { this.open = !this.open; this.offset = 0; return { handled: true }; }
    if (this.open && (this.lastMore || this.offset > 0) && event.y === this.lastHeight - 1) { this.offset = Math.max(0, this.offset + (this.lastMore ? 1 : -1) * Math.max(1, this.lastBodyHeight)); return { handled: true }; }
    return { handled: true, render: false };
  }
  invalidate() { this.reset(); }
}
