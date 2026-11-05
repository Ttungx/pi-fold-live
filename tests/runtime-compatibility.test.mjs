import assert from 'node:assert/strict';
import { core, tui, loadSource } from './test-runtime.mjs';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const { inspectRuntime } = await loadSource('runtime-compatibility.ts');
const fn = () => {};
const pi = { on: fn, registerCommand: fn, events: { on: fn, emit: fn }, registerToolRenderer: fn, registerMarkdownTransformer: fn, getCommands: fn, appendEntry: fn };
for (const version of [core.VERSION, '1.5.0', '9.0.0']) {
  const report = inspectRuntime(pi, { ...core, VERSION: version }, tui);
  assert.equal(report.state, 'full', `${version} with compatible interfaces works`);
}
for (const [symbol, feature] of [['UserMessageComponent','prompts'], ['ExtensionRunner','subagents'], ['InteractiveMode','work'], ['ToolExecutionComponent','images']]) {
  const report = inspectRuntime(pi, { ...core, [symbol]: undefined }, tui);
  assert.equal(report.state, 'partial');
  assert.equal(report.available(feature), false);
  assert.equal(report.available('tools'), true, 'independent tool cards remain available');
  assert.match(report.describe(), new RegExp(symbol));
}
assert.equal(inspectRuntime(pi, { ...core, VERSION: '18.16.0' }, tui).host, 'OMP');
assert.equal(inspectRuntime(pi).host, 'Pi');
const report = inspectRuntime(pi);
report.disable('inspection', 'ui.select missing');
assert.equal(report.available('reveal'), false);
assert.equal(report.available('overlays'), false);
assert.equal(report.available('work'), true);
assert.equal(inspectRuntime(pi, {}, {}).state, 'unavailable');

// Use the native ESM loader with optional exports genuinely absent. Jiti can
// otherwise mask missing named exports. No feature module should load here.
const fixture = mkdtempSync(path.join(tmpdir(), 'fold-missing-exports-'));
try {
  mkdirSync(path.join(fixture, 'src'));
  for (const file of ['index.ts', 'src/runtime-compatibility.ts', 'src/display-mode.ts', 'src/fold-command.ts', 'src/omp-tool-rows.ts', 'src/omp-thinking.ts', 'src/native-method-chain.ts', 'src/display-card.ts', 'src/display-line-cache.ts']) copyFileSync(new URL('../' + file, import.meta.url), path.join(fixture, file));
  writeFileSync(path.join(fixture, 'package.json'), '{"type":"module"}');
  for (const name of ['pi-coding-agent', 'pi-tui']) {
    const folder = path.join(fixture, 'node_modules/@earendil-works', name); mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, 'package.json'), '{"type":"module","exports":"./index.js"}');
    writeFileSync(path.join(folder, 'index.js'), 'export const VERSION = "9.0.0";');
  }
  writeFileSync(path.join(fixture, 'check.mjs'), `import register from './index.ts';
const commands = new Map(), hooks = new Map(), notices = [];
await register({on(name,fn){hooks.set(name,fn)},events:{on(){},emit(){}},registerCommand(name,command){commands.set(name,command)}});
await commands.get('fold').handler('on',{hasUI:false,ui:{notify(message){notices.push(message)}}});
if (!notices[0]?.includes('Compatibility: unavailable') || notices[0].includes('Pi Fold on')) throw new Error(notices.join('\\n'));
hooks.get('session_start')({}, {hasUI:true,ui:{notify(message){notices.push(message)}},sessionManager:{getBranch(){},buildContextEntries(){}}});
if (notices.length !== 1) throw new Error('OMP startup must stay silent:\\n' + notices.join('\\n'));
hooks.get('session_shutdown')();
console.log('missing exports: native fallback');`);
  // transform-types keeps the native ESM loader (so absent named exports stay absent) while
  // allowing the TypeScript syntax the real feature modules use.
  const result = spawnSync(process.execPath, ['--experimental-transform-types', path.join(fixture, 'check.mjs')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr + result.stdout);
} finally { rmSync(fixture, { recursive: true, force: true }); }
console.log(`Pi ${core.VERSION}: capability probes, partial support and missing-export native startup passed`);
