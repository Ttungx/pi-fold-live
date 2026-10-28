import * as nativeTui from "@earendil-works/pi-tui";
const { truncateToWidth, visibleWidth } = nativeTui;
import { DisplayLineCache } from "./display-line-cache.ts";

const lines = new DisplayLineCache();
export const clearDisplayLineCache = () => lines.clear();
// Final reply projections retain native Markdown rather than workflow controls.
export const finalReplyRendering = Symbol.for("compact-renderer:final-reply-rendering:v1");
// Key the actual styling bytes, not theme identity: themes can change in place.
const memoLine = (kind: string, line: string, width: number, style: string, render: () => string) =>
  line.length > 4096 ? render() : lines.get(JSON.stringify([kind, width, style, line]), render);

export const cardPadding = (width: number) => width >= 4 ? 1 : 0;
export const cardContentWidth = (width: number) => Math.max(1, width - cardPadding(width) * 2);

/** Routine headings keep only their category colored; recorded intent is secondary. */
export function activityHeading(line: string, theme: any, tone = "mdLink"): string {
  if (!theme) return line;
  if (tone !== "mdLink" && tone !== "syntaxVariable") return theme.fg(tone, theme.bold(line));
  const separator = line.indexOf(" · ");
  return separator < 0 ? theme.fg(tone, line) : theme.fg(tone, line.slice(0, separator)) + theme.fg("muted", line.slice(separator));
}

/** Match Pi's default Box(1, 1): one filled row above and below the content. */
export function cardBlock(rows: string[], width: number, theme: any, background: string): string[] {
  const blank = fillBackground("", width, theme, background);
  return [blank, ...rows, blank];
}

/** The legacy card fill: keep the base surface after nested ANSI resets.
 * Extended color payloads are data, not SGR reset codes. */
export function fillBackground(line: string, width: number, theme: any, background: string): string {
  const base = typeof theme?.bg === "function" ? theme.bg(background, "").replace(/\x1b\[49m$/, "") : undefined;
  return memoLine(base === undefined ? "pad" : "fill", line, width, base ?? "", () => paintBackground(line, width, base));
}

function paintBackground(line: string, width: number, base: string | undefined): string {
  const content = truncateToWidth(line, width, "");
  const padded = content + " ".repeat(Math.max(0, width - visibleWidth(content)));
  if (base === undefined) return padded;
  const restored = padded.replace(/\x1b\[([0-9;:]*)m/g, (escape, parameters: string) => {
    const codes = parameters.split(";");
    let reset = false;
    for (let i = 0; i < codes.length; i++) {
      const code = Number(codes[i].split(":")[0]);
      if (code === 0 || code === 49) reset = true;
      else if (code >= 40 && code <= 47 || code >= 100 && code <= 107 || code === 48) reset = false;
      if ((code === 38 || code === 48 || code === 58) && !codes[i].includes(":")) {
        const mode = Number(codes[++i]);
        i += mode === 2 ? 3 : mode === 5 ? 1 : 0;
      }
    }
    return escape + (reset ? base : "");
  });
  return base + restored + "\x1b[49m";
}

/** Callers lay out within cardContentWidth; fill includes both horizontal gutters. */
export function cardRow(line: string, width: number, theme: any, background: string): string {
  return fillBackground(" ".repeat(cardPadding(width)) + truncateToWidth(line, cardContentWidth(width), ""), width, theme, background);
}

/** Compact activity stays on the terminal surface; only keyboard selection is filled. */
export function activityRow(line: string, width: number, theme: any, selected = false): string {
  const row = memoLine("activity", line, width, "", () => " ".repeat(cardPadding(width)) + truncateToWidth(line, cardContentWidth(width), ""));
  return selected ? fillBackground(row, width, theme, "selectedBg") : row;
}
