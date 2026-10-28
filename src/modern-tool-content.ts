import type { PaneContent } from "./modern-tool-pane.ts";

const scalar = (value: any) => value === undefined ? "undefined" : typeof value === "bigint" ? `${value}n` : JSON.stringify(value) ?? String(value);

/** Local field names keep structure readable without constructing a serialized payload.
 * Strings remain separate, lazy chunks; no traversal of later fields occurs before painting them. */
export function* recordedValues(value: any, indent = 0, ancestors = new Set<object>(), languages: Record<string, string | undefined> = {}, language?: string): Generator<PaneContent> {
  if (typeof value === "string") { yield { text: value.length ? value : '""', indent, ...(language ? { format: "code" as const, language } : {}) }; return; }
  if (value === null || typeof value !== "object") { yield { text: scalar(value), indent, format: "code", language: "json" }; return; }
  if (ancestors.has(value)) { yield { text: "[circular reference]", indent }; return; }
  ancestors.add(value);
  let count = 0;
  for (const key in value) if (Object.prototype.hasOwnProperty.call(value, key)) {
    count++;
    const field = value[key];
    const label = Array.isArray(value) ? `[${key}]` : key;
    if (field === null || typeof field !== "object" && typeof field !== "string") yield { text: `${label}: ${scalar(field)}`, indent, kind: "field", format: "code", language: "json" };
    else if (typeof field === "string" && !languages[key] && field.length <= 160 && !/[\r\n\p{Cc}\p{Cf}]/u.test(field)) {
      yield { text: `${label}: ${JSON.stringify(field)}`, indent, kind: "field", format: "code", language: "json" };
    }
    else {
      yield { text: `${label}:`, indent, kind: "field" };
      yield* recordedValues(field, indent + 2, ancestors, languages, languages[key]);
    }
  }
  if (!count) yield { text: Array.isArray(value) ? "[]" : "{}", indent };
  ancestors.delete(value);
}
