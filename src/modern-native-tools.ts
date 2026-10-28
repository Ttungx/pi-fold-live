import type { ToolRenderers } from '@earendil-works/pi-coding-agent';
import * as Pi from '@earendil-works/pi-coding-agent';
import type { Component } from '@earendil-works/pi-tui';
import * as Tui from '@earendil-works/pi-tui';

const { keyHint } = Pi;
const { Box, Container, Text, stripTerminalSequences } = Tui;

type Context = Parameters<NonNullable<ToolRenderers["renderCall"]>>[2];
/** Check the rendering surface once. Per-call context checks preserve stock rendering. */
export const nativeToolsSupported = [Box, Container, Text, stripTerminalSequences].every(value => typeof value === 'function') &&
  ['setBgFn', 'setPaddingX', 'clear', 'addChild', 'render'].every(key => typeof Box?.prototype?.[key] === 'function') &&
  ['clear', 'render'].every(key => typeof Container?.prototype?.[key] === 'function');
export const nativeToolContextSupported = (context: Context) => !!context && typeof context.toolCallId === "string" && typeof context.invalidate === "function" && !!context.state && typeof context.state === "object" && typeof context.cwd === "string" && typeof context.expanded === "boolean" && typeof context.executionStarted === "boolean" && typeof context.isPartial === "boolean";
export function nativeTextFallback(result: any, theme?: any, options = { expanded: true }): InstanceType<typeof Text> {
  const text = (Array.isArray(result?.content) ? result.content : []).filter((block: any) => block?.type === "text").map((block: any) => String(block.text ?? "")).join("\n");
  const output = stripTerminalSequences(text).replace(/\r/g, "");
  if (!theme) return new Text(output, 0, 0);
  const lines = output.split("\n");
  const visible = options.expanded ? lines : lines.slice(0, 10);
  let display = visible.map(line => theme.fg("toolOutput", line)).join("\n");
  const remaining = lines.length - visible.length;
  if (remaining > 0) display += `${theme.fg("muted", `\n... (${remaining} more lines,`)} ${typeof keyHint === "function" ? keyHint("app.tools.expand", "to expand") : "expand tools to view"}${theme.fg("muted", ")")}`;
  return new Text(display, 0, 0);
}
function callFallback(name: string, args: any, theme: any, expanded: boolean) {
  const title = theme.fg("toolTitle", theme.bold(name));
  if (args == null) return new Text(title, 0, 0);
  const entries = typeof args === "object" && !Array.isArray(args) ? Object.entries(args) : [["args", args]];
  if (!entries.length) return new Text(title, 0, 0);
  if (expanded) {
    const lines = entries.map(([key, value]) => `  ${key}: ${(typeof value === "string" ? value : JSON.stringify(value) ?? String(value)).replace(/\t/g, "   ").replace(/\r/g, "").split("\n").join("\n    ")}`);
    return new Text(`${title}\n${theme.fg("muted", lines.join("\n"))}`, 0, 0);
  }
  const pairs = entries.map(([key, value]) => `${key}=${JSON.stringify(value) ?? String(value)}`).join(" ");
  return new Text(`${title} ${theme.fg("muted", pairs.length > 100 ? `${pairs.slice(0, 97)}...` : pairs)}`, 0, 0);
}
export class NativeToolOwner {
  private state: Record<string, any> = {};
  private call?: Component;
  private result?: Component;
  private error?: boolean;
  private shell = new Box(1, 1);
  private empty = new Container();
  constructor(private name: string, private stock?: ToolRenderers) {}
  context(context: Context, slot: "call" | "result") {
    return { ...context, state: this.state, lastComponent: slot === "call" ? this.call : this.result };
  }
  private nativeShell(theme: any, context: Context) {
    const background = context.isPartial ? "toolPendingBg" : context.isError ? "toolErrorBg" : "toolSuccessBg";
    this.shell.setBgFn(text => theme.bg(background, text));
    this.shell.setPaddingX(context.outputPad);
    this.shell.clear();
    if (this.call) this.shell.addChild(this.call);
    if (this.result) this.shell.addChild(this.result);
    return this.shell;
  }
  renderCall(args: any, theme: any, context: Context) {
    this.call = this.stock?.renderCall?.(args, theme, this.context(context, "call")) ?? callFallback(this.name, args, theme, context.expanded);
    return this.stock?.renderShell === "self" ? this.call : this.nativeShell(theme, context);
  }
  renderResult(result: any, options: any, theme: any, context: Context) {
    // Some stock result slots switch component class on error; don't reuse across that transition.
    if (this.error !== context.isError) this.result = undefined;
    this.error = context.isError;
    this.result = this.stock?.renderResult?.(result, options, theme, this.context(context, "result")) ?? nativeTextFallback(result, theme, options);
    if (this.stock?.renderShell === "self") return this.result;
    // Both native slots share one public Box. The wrapper's call slot owns its position,
    // and its result slot updates that Box without adding a second shell or padding.
    this.nativeShell(theme, context);
    return this.empty;
  }
  renderCurrent(width: number) { return (this.stock?.renderShell === "self" ? this.call : this.shell)?.render(width) ?? []; }
  get clock() { return { startedAt: this.state.startedAt as number | undefined, endedAt: this.state.endedAt as number | undefined }; }
  adoptClock(clock: { startedAt?: number; endedAt?: number }) { this.state.startedAt ??= clock.startedAt; this.state.endedAt ??= clock.endedAt; }
  suspend() {
    // Pi 1.3.0 render-utils ToolTimerState. Only clear a handle owned by this native state.
    // Never inspect or mutate the host row's rendererState or extension execution timers.
    if (nativeToolsSupported && ["bash", "powershell", "codemode"].includes(this.name) && this.state.interval !== undefined) {
      const interval = this.state.interval;
      if (typeof interval === "number" || (interval && typeof interval === "object" && typeof interval.hasRef === "function")) clearInterval(interval);
      this.state.interval = undefined;
    }
  }
  dispose() { this.suspend(); this.call = undefined; this.result = undefined; this.shell.clear(); this.state = {}; }
}
