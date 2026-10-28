/** Remove only a complete repeated opening line from the compact presentation.
 * Recorded sources remain untouched; clipped summaries and sole content stay intact. */
export function suppressRepeatedSummary(source: string, summary: string): string {
  if (!summary || summary.endsWith("…")) return source;
  const opening = /^(?:[ \t]*\r?\n)*([^\r\n]+)\r?\n/.exec(source.slice(0, 1024));
  if (!opening) return source;
  const title = opening[1].replace(/^ {0,3}#{1,6}[ \t]+/, "").replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_match, bold, underlined) => bold || underlined).replace(/`([^`]+)`/g, "$1").trim();
  if (title !== summary) return source;
  const probe = source.slice(opening[0].length, opening[0].length + 1024);
  if (!/\S/.test(probe)) return source;
  const gap = /^(?:[ \t]*\r?\n)+/.exec(probe)?.[0].length || 0;
  return source.slice(opening[0].length + gap);
}
