import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/** A raw recorded-text viewport. It only visits the rows requested so far.
 * Strings stay unchanged; unsafe terminal controls get visible representations. */
export class RecordedTextPane {
  open = false;
  top = 0;
  private width = 0;
  private sources: readonly string[] = [];
  private rows: string[] = [];
  private source = 0;
  private offset = 0;
  private finished = false;
  visitedCharacters = 0;
  setSources(sources: readonly string[]) {
    if (sources.length === this.sources.length && sources.every((s, i) => s === this.sources[i])) return;
    this.sources = sources;
    this.top = 0;
    this.reset();
  }
  private reset() { this.rows = []; this.source = 0; this.offset = 0; this.finished = false; }
  private nextRow(width: number): string | undefined {
    if (this.finished) return;
    if (this.source >= this.sources.length) { this.finished = true; return; }
    const text = this.sources[this.source];
    let row = "", cells = 0;
    // Also bound invisible combining-character input, which has zero cell width.
    let budget = Math.max(64, width * 8);
    while (this.offset < text.length && budget-- > 0) {
      const point = text.codePointAt(this.offset)!;
      const char = String.fromCodePoint(point);
      if (char === "\n") { this.offset++; this.visitedCharacters++; break; }
      if (char === "\r" && text[this.offset + 1] === "\n") { this.offset += 2; this.visitedCharacters += 2; break; }
      const safe = char === "\t" ? "   " : /[\p{Cc}\p{Cf}]/u.test(char) ? `\\u${point.toString(16).padStart(4, "0")}` : char;
      const length = visibleWidth(safe);
      if (cells && cells + length > width) break;
      row += length > width ? truncateToWidth(safe, width, "") : safe;
      cells += Math.min(length, width);
      this.offset += char.length;
      this.visitedCharacters += char.length;
      if (cells >= width) break;
    }
    if (this.offset >= text.length) { this.source++; this.offset = 0; }
    return row;
  }
  render(width: number, height: number): string[] {
    width = Math.max(1, Math.floor(width)); height = Math.max(1, Math.floor(height));
    if (width !== this.width) { this.width = width; this.top = 0; this.reset(); }
    const end = this.top + height;
    while (!this.finished && this.rows.length <= end) {
      const row = this.nextRow(width);
      if (row !== undefined) this.rows.push(row);
    }
    this.top = Math.min(this.top, Math.max(0, this.rows.length - height));
    return this.rows.slice(this.top, this.top + height);
  }
  move(direction: string, height: number) {
    if (direction === "home") this.top = 0;
    else if (direction === "up") this.top = Math.max(0, this.top - 1);
    else if (direction === "down") this.top++;
    else if (direction === "pageUp") this.top = Math.max(0, this.top - height);
    else if (direction === "pageDown") this.top += height;
  }
  get more() { return !this.finished || this.top + this.heightHint < this.rows.length; }
  private heightHint = 0;
  view(width: number, height: number) { this.heightHint = height; return this.render(width, height); }
}
export const recordedPaneHeight = (rows = process.stdout.rows) => Math.max(1, Math.min(12, Math.floor((Number.isFinite(rows) && rows > 0 ? rows : 24) * .4)));
