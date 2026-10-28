import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

// Prefer the Pi installed next to this package (npm install), then the state runtime.
const localRuntime = fileURLToPath(new URL('..', import.meta.url));
const stateRuntime = path.join(homedir(), '.local/state/pi-config/current/runtime');
const defaultRuntime = existsSync(path.join(localRuntime, 'node_modules/@earendil-works/pi-coding-agent')) ? localRuntime : stateRuntime;
export const runtime = path.resolve(process.env.PI_RUNTIME || defaultRuntime);
export const agentRoot = path.resolve(process.env.PI_INSTALL_ROOT || path.join(runtime, 'node_modules/@earendil-works/pi-coding-agent'));
const require = createRequire(path.join(agentRoot, 'package.json'));
// Use Pi's own TUI dependency even when another extension installs a newer
// version at the runtime root; native component identity must match the aliases.
export const tuiRoot = path.dirname(path.dirname(require.resolve('@earendil-works/pi-tui')));
const { createJiti } = require('jiti');
const sourceOptions = { fsCache: false, alias: {
  '@earendil-works/pi-coding-agent': path.join(agentRoot, 'dist/index.js'),
  '@earendil-works/pi-tui': path.join(tuiRoot, 'dist/index.js'),
} };
export const jiti = createJiti(import.meta.url, { ...sourceOptions, moduleCache: false });
const sharedJiti = createJiti(import.meta.url, { ...sourceOptions, moduleCache: true });
// Use one module graph when testing extension-wide singleton ownership.
export const loadSharedSource = file => sharedJiti.import(new URL(file, new URL('../src/', import.meta.url)).pathname);
export const loadSource = (file) => jiti.import(new URL(file, new URL('../src/', import.meta.url)).pathname);
export const loadAgent = (file) => import(pathToFileURL(path.join(agentRoot, 'dist', file)).href);
export const tui = await import(pathToFileURL(path.join(tuiRoot, 'dist/index.js')).href);
export const core = await loadAgent('index.js');
export const themeModule = await loadAgent('modes/interactive/theme/theme.js');
themeModule.initTheme('dark', false);
export const stripAnsi = value => value.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]/g, '');

// Observe the effective surface at every printed cell, including after nested resets.
export function backgroundCells(row) {
  let background = '', end = 0;
  const cells = [];
  const append = text => { for (const char of text) for (let n = 0; n < tui.visibleWidth(char); n++) cells.push(background); };
  for (const match of row.matchAll(/\x1b\[([0-9;:]*)m/g)) {
    append(row.slice(end, match.index));
    const codes = match[1].split(';');
    for (let i = 0; i < codes.length; i++) {
      const code = Number(codes[i].split(':')[0]);
      if (code === 0 || code === 49) background = '';
      else if (code >= 40 && code <= 47 || code >= 100 && code <= 107) background = String(code);
      if ([38, 48, 58].includes(code)) {
        const start = i;
        if (!codes[i].includes(':')) { const mode = Number(codes[++i]); i += mode === 2 ? 3 : mode === 5 ? 1 : 0; }
        if (code === 48) background = codes.slice(start, i + 1).join(';');
      }
    }
    end = match.index + match[0].length;
  }
  append(row.slice(end));
  return cells;
}
export function assertCardBackground(rows, width, token, theme = themeModule.theme) {
  const expected = backgroundCells(theme.bg(token, ' '))[0];
  assert.ok(expected, `${token} has a concrete background`);
  for (const row of rows) {
    assert.equal(tui.visibleWidth(row), width, 'card fills the complete row');
    assert.deepEqual(backgroundCells(row), Array(width).fill(expected), `every cell retains ${token}`);
  }
}
