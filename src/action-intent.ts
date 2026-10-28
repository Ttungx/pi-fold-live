type Action = { name: string; args: unknown };
const limit = 8192;
// Read recorded data without invoking accessors. Never include source values in a phrase.
function field(value: unknown, key: string): any {
  if (!value || typeof value !== "object") return undefined;
  try { return Object.getOwnPropertyDescriptor(value, key)?.value; } catch { return undefined; }
}
function argumentsObject(args: unknown): unknown {
  if (typeof args !== "string") return args;
  if (args.length > limit) return undefined;
  try { return JSON.parse(args); } catch { return undefined; }
}
function combine(intents: string[], more = false): string {
  const unique = [...new Set(intents)];
  const first = unique[0] || "Run tool actions";
  return first + (unique[1] ? ` and ${unique[1][0].toLowerCase()}${unique[1].slice(1)}` : "") +
    (more || unique.length > 2 ? "; and other actions" : "");
}

/** A small shell lexer, not a shell interpreter. Quoted arguments cannot become commands.
 * Reject substitutions, redirection, and unclosed quotes rather than interpreting scripts. */
function shellIntents(command: unknown): string[] {
  if (typeof command !== "string" || command.length > limit || !command.trim()) return ["Run shell commands"];
  const commands: string[][] = []; let words: string[] = [], word = "", quote = "", started = false;
  const pushWord = () => { if (started) words.push(word); word = ""; started = false; };
  const pushCommand = () => { pushWord(); if (words.length) commands.push(words); words = []; };
  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (char === "`" || char === "$" && command[i + 1] === "(" || !quote && /[<>()[\]{}]/.test(char)) return ["Run shell commands"];
    if (char === "\\" && quote !== "'") { if (++i >= command.length) return ["Run shell commands"]; word += command[i]; started = true; continue; }
    if (quote) { if (char === quote) quote = ""; else word += char; continue; }
    if (char === "'" || char === '"') { quote = char; started = true; continue; }
    if (char === "#" && !started) return ["Run shell commands"];
    if (/[;|&\n]/.test(char)) pushCommand();
    else if (/\s/.test(char)) pushWord();
    else { word += char; started = true; }
    if (commands.length > 32 || words.length > 128) return ["Run shell commands"];
  }
  if (quote) return ["Run shell commands"];
  pushCommand();
  const intents = commands.map(words => {
    // Environment assignments and cd establish context; they do not supply an intent.
    while (/^[A-Za-z_]\w*=/.test(words[0] || "")) words.shift();
    const executable = (words[0] || "").split("/").at(-1), operation = words[1];
    if (executable === "cd") return "";
    if (executable === "git" && ["status", "diff", "log", "show", "ls-files", "rev-parse"].includes(operation)) return "Check Git changes";
    if (executable === "gh" && ["pr", "checks"].includes(operation) && ["list", "view", "status", "checks", "diff", undefined].includes(words[2])) return "Check pull requests";
    if (executable === "jq") return "Inspect JSON records";
    if (["cat", "head", "tail"].includes(executable || "")) return "Read files";
    if (["rg", "grep"].includes(executable || "")) return "Search files";
    if (["ls", "pwd"].includes(executable || "") || executable === "find" && !words.some(word => ["-delete", "-exec", "-execdir", "-ok", "-okdir", "-fprint", "-fprint0", "-fprintf"].includes(word))) return "Inspect files";
    if (["npm", "pnpm", "yarn", "bun"].includes(executable || "") &&
        (["test", "check", "lint", "typecheck"].includes(operation) || operation === "run" && ["test", "check", "lint", "typecheck"].includes(words[2]))) return "Run checks";
    if (["pytest", "vitest", "jest", "tsc"].includes(executable || "") || executable === "node" && (operation === "--test" || /\.(?:test|spec)\.[cm]?js$/.test(operation || ""))) return "Run checks";
    return "Run shell commands";
  }).filter(Boolean);
  return intents.length ? intents : ["Run shell commands"];
}

/** Describe recorded operations, without inferring a business goal or exposing arguments. */
function actionIntents(name: string, args: unknown): string[] {
  if (typeof name !== "string" || name.length > 256) return ["Run tool actions"];
  const short = name.split("__").at(-1)?.toLowerCase();
  if (["bash", "powershell", "exec_command"].includes(short || "")) {
    const value = argumentsObject(args);
    return shellIntents(field(value, "command") ?? field(value, "cmd"));
  }
  if (["read", "read_file"].includes(short || "")) return ["Read files"];
  if (["write", "write_file", "edit", "apply_patch"].includes(short || "")) return ["Edit files"];
  if (["grep", "rg", "search", "glob", "find"].includes(short || "")) return ["Search files"];
  if (["ls", "list_directory"].includes(short || "")) return ["Inspect files"];
  if (short === "ask_user_question") return ["Ask a question"];
  return [short === "codemode" ? "Run code" : "Run tool actions"];
}

export function actionIntent(name: string, args: unknown): string {
  return combine(actionIntents(name, args));
}

export function groupIntent(actions: Action[]): string {
  if (!Array.isArray(actions)) return "Run tool actions";
  const intents: string[] = [];
  for (let i = 0; i < Math.min(actions.length, 64); i++) {
    const action = field(actions, String(i));
    intents.push(...actionIntents(field(action, "name"), field(action, "args")));
  }
  return combine(intents, actions.length > 64);
}

/** Recorded nested calls are evidence. Arbitrary JavaScript is not parsed or evaluated. */
export function codeIntent(_args: unknown, calls: Action[]): string {
  return Array.isArray(calls) && calls.length ? groupIntent(calls) : "Run code";
}
