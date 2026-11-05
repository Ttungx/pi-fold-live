#!/usr/bin/env bun
// Real OMP playback and bundled-CLI startup; no prompts, tool execution, or user-setting changes.
// OMP_INSTALL_ROOT=/path/to/@oh-my-pi/pi-coding-agent bun scripts/omp-runtime-smoke.mjs
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

const checkout = fileURLToPath(new URL('..', import.meta.url));
const agentRoot = process.env.OMP_INSTALL_ROOT || process.argv[2];
if (!agentRoot) throw new Error('Set OMP_INSTALL_ROOT to the installed @oh-my-pi/pi-coding-agent directory. Run with Bun.');
const agent = path.resolve(agentRoot);
const tuiRoot = path.resolve(agent, '../pi-tui');
const hostImport = file => import(pathToFileURL(file).href);
const legacy = await hostImport(path.join(agent, 'src/extensibility/plugins/legacy-pi-compat.ts'));
legacy.installLegacyPiSpecifierShim();
const load = file => legacy.loadLegacyPiModule(path.join(checkout, file), { reload: false });
const tui = await hostImport(path.join(tuiRoot, 'src/index.ts'));
const { ToolExecutionComponent, stopSharedSpinnerTicker } = await hostImport(path.join(tuiRoot, 'src/chat/tool-execution.ts'));
const { AssistantMessageComponent } = await hostImport(path.join(tuiRoot, 'src/chat/assistant-message.ts'));
const links = await hostImport(path.join(tuiRoot, 'src/render/extension-links.ts'));
const { initThemeSync } = await hostImport(path.join(tuiRoot, 'src/theme/index.ts'));
initThemeSync();
const tools = await load('src/omp-tool-rows.ts');
const { createDisplayMode } = await load('src/display-mode.ts');
const mode = createDisplayMode();
const handlers = new Map();
const host = {
  registerLinkScheme() {},
  on(event, handler) {
    const set = handlers.get(event) || new Set();
    set.add(handler); handlers.set(event, set);
    return () => set.delete(handler);
  },
};
let repaints = 0;
const context = { ui: { setWidget: () => { repaints++; }, setToolsExpanded: () => { throw new Error('A row must not toggle every tool'); } } };
const emit = (event, payload) => { for (const handler of handlers.get(event) || []) handler(payload, context); };
const ui = { requestRender() {}, requestComponentRender() {}, resetDisplay() {} };
const components = [];
const make = (name, args) => {
  const component = new ToolExecutionComponent(name, args, {}, undefined, ui);
  components.push(component);
  component.setArgsComplete();
  component.setExecutionStarted();
  return component;
};
const frame = (text, isError = false) => ({ content: [{ type: 'text', text }], isError });
const plain = rows => rows.map(row => tui.stripTerminalSequences(row)).filter(row => row.trim());
const nativeContext = { cols: 100, supports: () => true };
const urlFor = component => component.render(100).flatMap(row => links.extensionLinkLabels(row)).at(0)?.url;
const restore = await tools.registerOmpToolRows(host, mode);
assert.equal(typeof restore, 'function', 'actual OMP component probes must accept the installed runtime');
links.setExtensionLinks(['pi-fold']);
try {
  emit('session_start', {});
  const first = make('bash', { command: 'fixture-a' });
  const second = make('bash', { command: 'fixture-b' });
  const read = make('read', { path: 'fixture.txt' });
  const failed = make('bash', { command: 'fixture-failure' });
  first.updateResult(frame('alpha details'));
  second.updateResult(frame('beta details'));
  read.updateResult(frame('read details'));
  failed.updateResult(frame('failure details', true));
  for (const component of components) component.render(100);
  assert.match(plain(first.render(100)).join('\n'), /2 actions/);
  assert.deepEqual(second.render(100), []);
  assert.match(plain(failed.render(100)).join('\n'), /failed/);
  const firstUrl = urlFor(first);
  const readUrl = urlFor(read);
  assert.ok(firstUrl && readUrl && firstUrl !== readUrl, 'each disclosure has a separate identity');
  emit('link_activate', { url: firstUrl });
  assert.match(plain(first.render(100)).join('\n'), /alpha details/);
  assert.match(plain(second.render(100)).join('\n'), /beta details/);
  assert.doesNotMatch(plain(read.render(100)).join('\n'), /read details/);
  emit('link_activate', { url: firstUrl });
  assert.match(plain(first.render(100)).join('\n'), /2 actions/);
  assert.deepEqual(second.render(100), []);
  const paintsBeforeUnknown = repaints;
  emit('link_activate', { url: 'pi-fold:action/invalid' });
  assert.equal(repaints, paintsBeforeUnknown);

  const compactNative = first.describe(nativeContext);
  assert.equal(compactNative.k, 'tool');
  assert.equal(compactNative.p.frame, 'inline');
  assert.equal(compactNative.p.preview, 'none');
  assert.match(compactNative.p.title, /2 actions/);
  assert.deepEqual(second.describe(nativeContext), { k: 'col', c: [] });
  const legacyNative = { cols: 100, supports: () => false };
  assert.equal(second.describe(legacyNative).k, 'card', 'terminals without tool nodes must retain every stock card');
  second.handleNativeEvent({ type: 'toggle', key: '', collapsed: false });
  assert.equal(first.describe(legacyNative).p.collapsed, true, 'stock fallback toggles affect only their own card');
  assert.equal(second.describe(legacyNative).p.collapsed, false);
  second.setExpanded(false);
  first.describe(nativeContext);
  second.describe(nativeContext);
  first.handleNativeEvent({ type: 'toggle', key: '', collapsed: false });
  assert.equal(first.describe(nativeContext).p.collapsed, false);
  assert.equal(second.describe(nativeContext).p.collapsed, false);
  first.handleNativeEvent({ type: 'toggle', key: '', collapsed: true });
  assert.equal(first.describe(nativeContext).p.preview, 'none');

  const live = make('bash', { command: 'fixture-stream' });
  live.updateResult(frame('one\ntwo\nthree\nfour'), true);
  assert.deepEqual(plain(live.render(100)).slice(-3).map(row => row.trim()), ['two', 'three', 'four']);
  assert.deepEqual(live.describe(nativeContext).p.preview, { tail: 3 });
  live.updateResult(frame('one\ntwo\nthree\nfour'));
  assert.doesNotMatch(plain(live.render(100)).join('\n'), /four/);

  mode.setEnabled(false);
  assert.ok(first.render(100).every(row => !row.includes('id=omp-extension-link')));
  assert.match(plain(first.render(100)).join('\n'), /alpha details/);
  assert.notEqual(first.describe(nativeContext).p.frame, 'inline');
  const paintsBeforeOffClick = repaints;
  emit('link_activate', { url: readUrl });
  assert.equal(repaints, paintsBeforeOffClick);
  mode.setEnabled(true);
  assert.match(plain(first.render(100)).join('\n'), /2 actions/);
  read.dispose();
  const paintsBeforeStale = repaints;
  emit('link_activate', { url: readUrl });
  assert.equal(repaints, paintsBeforeStale, 'disposed rows cannot be activated');

  console.log('OMP ANSI compact playback:');
  for (const component of [first, second, failed, live]) console.log(plain(component.render(100)).join('\n'));
  console.log('OMP tool behavior passed: per-action/run links, invalid/stale links, native TSP toggles, streaming tail, errors, native-off, disposal.');
} finally {
  for (const component of components) component.dispose();
  restore();
  mode.dispose();
  stopSharedSpinnerTicker();
}
const thinking = await load('src/omp-thinking.ts');
const { assertOmpThinkingBehavior } = await import('../tests/omp-thinking.test.mjs');
assertOmpThinkingBehavior({ AssistantMessageComponent, Markdown: tui.Markdown, Spacer: tui.Spacer, Text: tui.Text }, thinking.installOmpThinkingAdapter);
console.log('OMP thinking behavior passed: hidden/visible streaming, finalization, native sections, mixed replies, native-off and restoration.');

// A source-class probe cannot catch unresolved dynamic imports in OMP's compiled extension loader.
const home = await mkdtemp(path.join(tmpdir(), 'fold-omp-startup-'));
try {
  const manifest = JSON.parse(await readFile(path.join(agent, 'package.json'), 'utf8'));
  const binary = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin.omp;
  const probe = path.join(home, 'probe.ts');
  const config = path.join(home, 'overlay.yml');
  await writeFile(probe, `export default function(pi) { pi.on('session_start', () => pi.events.emit('pi-fold:compatibility:v1', { reply: report => console.log('FOLD_REPORT:' + JSON.stringify(report)) })); }`);
  await writeFile(config, 'hideThinkingBlock: true\ntui:\n  mouse: false\nextensionRenderers:\n  assistantText: false\n');
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(agent, binary), '--mode', 'rpc', '--no-ui', '--no-session', '--no-title', '--no-extensions', '--no-skills', '--no-rules', '--no-context-files', '-e', checkout, '-e', probe, '--model', 'anthropic/claude-sonnet-4-5', '--config', config], {
      cwd: home, env: { ...process.env, HOME: home, PI_CODING_AGENT_DIR: home, ANTHROPIC_API_KEY: 'unused-smoke-value' }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '', report, failure, finished = false;
    const stop = error => { if (finished) return; finished = true; failure = error; child.kill(); };
    const timeout = setTimeout(() => stop(new Error('OMP startup timed out\n' + output)), 45000);
    const receive = data => {
      output += data.toString();
      const match = /FOLD_REPORT:(\{[^\r\n]+\})/.exec(output);
      if (!match || finished) return;
      try {
        report = JSON.parse(match[1]);
        assert.match(report.description, /OMP adapters active: Tool rows, Thinking rows/);
        stop();
      } catch (error) { stop(error); }
    };
    child.stdout.on('data', receive);
    child.stderr.on('data', receive);
    child.on('error', error => { failure = error; });
    child.on('close', code => {
      clearTimeout(timeout);
      if (failure) reject(failure);
      else if (!report) reject(new Error(`OMP exited ${code}\n${output}`));
      else { console.log(`OMP ${manifest.version} bundled CLI: tool and thinking adapters registered, mouse and assistant-text renderers off.`); resolve(); }
    });
  });
} finally { await rm(home, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 }); }
