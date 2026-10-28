import { Markdown, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { getMarkdownTheme, highlightCode } from "@earendil-works/pi-coding-agent";

export type TextFormat = { format?: "code" | "markdown"; language?: string };
const safeText = (text: string) => text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]|\p{Cf}/gu, c => {
  const code = c.codePointAt(0)!;
  return code > 0xffff ? `\\u{${code.toString(16)}}` : `\\u${code.toString(16).padStart(4, "0")}`;
}).replace(/\t/g, "    ");

/** Format only the next bounded source block. Fenced code state survives blocks;
 * native syntax/Markdown formatting never receives the full unbounded payload. */
export function* richTextRows(text: string, width: number, options: TextFormat = {}): Generator<string> {
  let offset = 0, fence = "", language = "", heredoc = "", heredocLanguage = "";
  while (offset < text.length) {
    let end = Math.min(text.length, offset + 2048);
    const sample = text.slice(offset, end);
    const newline = sample.indexOf("\n");
    // Markdown is read one source line at a time so fences remain balanced across viewports.
    if ((options.format === "markdown" || options.language === "bash") && newline >= 0) end = offset + newline;
    else if (options.format !== "markdown" && end < text.length) {
      const last = sample.lastIndexOf("\n");
      if (last >= 0) end = offset + last;
    }
    if (end < text.length && end > offset && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    const source = safeText(text.slice(offset, end));
    const marker = options.format === "markdown" && source.match(/^ {0,3}(`{3,}|~{3,})([\w+-]*)\s*$/);
    const shellFence = options.language === "bash" && !heredoc && source.match(/^(?:\s*)(node(?:js)?|python[\d.]*|ruby|perl|bun|deno)\b[^\n]*?<<-?\s*['"]?([A-Za-z_]\w*)['"]?\s*$/);
    let rows: string[];
    if (heredoc && source === heredoc) { heredoc = ""; heredocLanguage = ""; rows = highlightCode(source, "bash"); }
    else if (heredoc) rows = highlightCode(source, heredocLanguage);
    else if (shellFence) {
      heredoc = shellFence[2];
      heredocLanguage = /^node|bun|deno/.test(shellFence[1]) ? "javascript" : /^python/.test(shellFence[1]) ? "python" : shellFence[1];
      rows = highlightCode(source, "bash");
    }
    else if (marker && (!fence || marker[1][0] === fence[0] && marker[1].length >= fence.length)) {
      if (fence) { fence = ""; language = ""; }
      else { fence = marker[1]; language = marker[2]; }
      rows = [getMarkdownTheme().codeBlockBorder(source)];
    } else if (options.format === "code" || fence) rows = highlightCode(source, fence ? language || undefined : options.language);
    else if (options.format === "markdown" && /(?:^ {0,3}(?:#{1,6} |>|[-*+] |\d+[.)] )|\*\*|__|`|\[[^\]]+\]\()/u.test(source)) {
      rows = new Markdown(source, 0, 0, getMarkdownTheme()).render(Math.max(1, width));
    } else rows = [source];
    for (const row of rows) yield* wrapTextWithAnsi(row, Math.max(1, width));
    offset = end + (text[end] === "\n" ? 1 : 0);
  }
  if (!text.length) yield "(empty)";
}
