import { wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { richTextRows } from "./modern-rich-text.ts";
import { codeIntent } from "./action-intent.ts";

const missing = Symbol("unsupported accessor");
const data = (object: any, key: string): any => {
  if (!object || typeof object !== "object") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  return descriptor && !("value" in descriptor) ? missing : descriptor?.value;
};
export const codeDuration = (ms: number) => ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
export const codeCost = (cost: number) => `$${cost >= .01 ? cost.toFixed(2) : cost.toPrecision(2)}`;
const scriptHeader = /^Script (completed|failed)\nWall time [\d.]+ seconds\nOutput:\n$/;

function* metadataValues(value: any, ancestors = new Set<object>()): Generator<string> {
  if (typeof value === "string") { yield value || '""'; return; }
  if (value === null || typeof value !== "object") { yield String(value); return; }
  if (ancestors.has(value)) { yield "[circular reference]"; return; }
  ancestors.add(value); let fields = 0;
  for (const key in value) if (Object.prototype.hasOwnProperty.call(value, key)) {
    fields++; yield key; yield ":";
    const field = data(value, key);
    if (field === missing) yield "[Recorded accessor; not evaluated]";
    else yield* metadataValues(field, ancestors);
  }
  if (!fields) yield Array.isArray(value) ? "[]" : "{}";
  ancestors.delete(value);
}

/** Data references only. Aggregate/shape work happens once per explicit update revision;
 * rendering visits bounded chunks and the nested calls reached by the viewport. */
export class CodeContent {
  supported = true;
  clean = true;
  hasScriptHeader = false;
  calls: any[] = [];
  content: any[] = [];
  code = "";
  intent = "Run code";
  private details: any;
  errors = 0; cancelled = 0; unresolved = 0; priced = 0; totalCost = 0; images = 0;
  private visibleContent: { block: any; index: number }[] = [];
  aggregateBlocks = 0;
  aggregateEntries = 0; sourceCharacters = 0; paintedCalls = 0;
  private revision = -1;
  update(args: any, result: any, revision: number) {
    if (revision === this.revision) return false;
    this.revision = revision; this.supported = true; this.clean = true; this.hasScriptHeader = false;
    this.errors = this.cancelled = this.unresolved = this.priced = this.totalCost = this.images = 0;
    const code = data(args, "code"), content = result ? data(result, "content") : [], details = result ? data(result, "details") : undefined;
    const calls = details == null ? [] : data(details, "calls");
    if (typeof code !== "string" || !Array.isArray(content) || details === missing || calls === missing || calls != null && !Array.isArray(calls)) { this.supported = false; return true; }
    this.code = code; this.content = content; this.calls = calls ?? []; this.details = details; this.visibleContent = [];
    const status = data(details, "status"), warning = data(details, "warning"), warnings = data(details, "warnings");
    const hasWarnings = Array.isArray(warnings) ? warnings.length > 0 : !!warnings;
    this.clean = !warning && !hasWarnings && (status === undefined || ["success", "ok", "completed"].includes(status));
    for (let i = 0; i < content.length; i++) {
      this.aggregateBlocks++;
      const block = data(content, String(i));
      const type = data(block, "type");
      if (type === "image" && typeof data(block, "mimeType") === "string" && typeof data(block, "data") === "string") {
        this.images++; this.visibleContent.push({ block, index: i });
      } else if (type === "text" && typeof data(block, "text") === "string") {
        if (i === 0) this.hasScriptHeader = data(block, "text").length < 160 && scriptHeader.test(data(block, "text"));
        if (data(block, "text").length) this.visibleContent.push({ block, index: i });
      } else { this.supported = false; return true; }
    }
    for (let i = 0; i < this.calls.length; i++) {
      this.aggregateEntries++;
      const call = data(this.calls, String(i)), status = data(call, "status"), cost = data(call, "cost"), duration = data(call, "durationMs");
      if (typeof data(call, "name") !== "string" || typeof data(call, "args") !== "string" || !["running", "ok", "error", "cancelled"].includes(status) ||
          cost !== undefined && (typeof cost !== "number" || !Number.isFinite(cost)) || duration !== undefined && (typeof duration !== "number" || !Number.isFinite(duration)) ||
          data(call, "error") !== undefined && typeof data(call, "error") !== "string") { this.supported = false; return true; }
      if (status === "error") this.errors++;
      if (status === "cancelled") this.cancelled++;
      if (status === "running") this.unresolved++;
      if (status !== "ok" || data(call, "error")) this.clean = false;
      if (cost) { this.priced++; this.totalCost += cost; }
    }
    this.intent = codeIntent(args, this.calls);
    return true;
  }
  private *text(text: string, width: number, theme: any, token?: string, code = false): Generator<string> {
    // A long line, including combining characters, never creates an unlimited formatter call.
    for (let offset = 0; offset < text.length;) {
      let end = Math.min(text.length, offset + 1024);
      if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
      const sample = text.slice(offset, end), newline = sample.lastIndexOf("\n");
      if (newline >= 0 && end < text.length) end = offset + newline + 1;
      const chunk = text.slice(offset, end);
      this.sourceCharacters += chunk.length;
      // The separator newline belongs to the source but not a second artificial blank row.
      const source = chunk.endsWith("\n") ? chunk.slice(0, -1) : chunk;
      for (const row of (source.length ? richTextRows(source, width, code ? { format: "code", language: "javascript" } : {}) : [""])) yield token && theme ? theme.fg(token, row) : row;
      offset = end;
    }
  }
  *rows(width: number, theme: any, isError: boolean, hasDuration = false): Generator<string> {
    const fg = (token: string, text: string) => theme ? theme.fg(token, text) : text;
    yield* this.text(this.code, width, theme, undefined, true);
    if (this.calls.length) yield "";
    for (let i = 0; i < this.calls.length; i++) {
      this.paintedCalls++;
      const call = this.calls[i];
      const status = { running: ["warning", "…"], ok: ["success", "✓"], error: ["error", "✗"], cancelled: ["muted", "⊘"] }[call.status] as string[];
      const duration = call.durationMs !== undefined ? fg("dim", codeDuration(call.durationMs)) : "";
      const cost = call.cost ? fg("dim", codeCost(call.cost)) : "";
      if (call.name.length + call.args.length <= 512 && !/[\r\n]/.test(call.name + call.args)) {
        const safe = (text: string) => [...richTextRows(text, 8192)].join("");
        this.sourceCharacters += call.name.length + call.args.length;
        const line = `${fg(status[0], status[1])} ${fg("toolTitle", safe(call.name))}${call.args ? ` ${fg("muted", safe(call.args))}` : ""}${duration ? ` ${duration}` : ""}${cost ? ` ${cost}` : ""}`;
        // Already-sanitized native ANSI must not pass through the raw text sanitizer again.
        yield* wrapTextWithAnsi(line, width);
      } else {
        yield fg(status[0], status[1]);
        yield* this.text(call.name, width, theme, "toolTitle");
        if (call.args) yield* this.text(call.args, width, theme, "muted");
        if (duration || cost) yield `${duration} ${cost}`.trim();
      }
      if (call.error) for (const row of this.text(call.error, Math.max(1, width - 4), theme, "error")) yield " ".repeat(Math.min(4, Math.max(0, width - 1))) + row;
    }
    if (this.priced > 1) yield fg("muted", `Model calls: ${codeCost(this.totalCost)}`);
    for (const { block, index } of this.visibleContent) {
      // The heading counts images and the image adapter displays them or their
      // fallback. Do not repeat a placeholder for each image in the text pane.
      if (block.type === "image") continue;
      const text = block.text;
      if (hasDuration && index === 0 && text.length < 160 && scriptHeader.test(text)) continue;
      if (text) { yield ""; yield* this.text(text, width, theme, isError ? "error" : "toolOutput"); }
    }
    if (this.details && typeof this.details === "object") for (const key in this.details) if (key !== "calls" && Object.prototype.hasOwnProperty.call(this.details, key)) {
      yield* this.text(key, width, theme, "muted"); yield fg("muted", ":");
      const value = data(this.details, key);
      if (value === missing) { yield fg("warning", "[Recorded accessor; native display required]"); continue; }
      for (const text of metadataValues(value)) yield* this.text(text, width, theme, "muted");
    }
  }
}
