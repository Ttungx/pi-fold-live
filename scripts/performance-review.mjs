#!/usr/bin/env node
// Synthetic layout benchmark for the native Pi 1.3.0 tool renderer and Pi Fold.
// It never runs an agent, model, tool, shell command, or network request.
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { loadAgent, loadSharedSource as loadSource, core, runtime, themeModule, tui } from '../tests/test-runtime.mjs';

const { ToolExecutionComponent } = await loadAgent('modes/interactive/components/tool-execution.js');
const { createShellRenderers } = await loadAgent('core/tools/renderers/bash.js');
const { readRenderers } = await loadAgent('core/tools/renderers/read.js');
const { codemodeRenderers } = await loadAgent('extensions/codemode/renderer.js');
const { registerModernTools } = await loadSource('./modern-tools.ts');
const { clearDisplayLineCache } = await loadSource('./display-card.ts');
const { createDisplayMode } = await loadSource('./display-mode.ts');
const { registerWorkStrip } = await loadSource('./work-strip.ts');
const { registerFoldCommand } = await loadSource('./fold-command.ts');
const { WorkStripHeader, WorkChild, workEvidenceType, projectedChildren } = await loadSource('./work-strip-view.ts');
const { VERSION } = core;

function options(argv) {
  const result = { samples: 5, warm: 8, scales: [8, 48, 160], longChars: 50000, nestedCalls: 500, width: 100 };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const value = argv[++i];
    if (key === '--samples') result.samples = Number(value);
    else if (key === '--warm') result.warm = Number(value);
    else if (key === '--scales') result.scales = value.split(',').map(Number);
    else if (key === '--long-chars') result.longChars = Number(value);
    else if (key === '--nested-calls') result.nestedCalls = Number(value);
    else if (key === '--width') result.width = Number(value);
    else if (key === '--help') {
      console.log('Usage: node scripts/performance-review.mjs [--samples N] [--warm N] [--scales 8,48,160] [--long-chars N] [--nested-calls N] [--width N]');
      process.exit(0);
    } else throw new Error(`Unknown option: ${key}`);
  }
  for (const key of ['samples', 'warm', 'longChars', 'nestedCalls', 'width']) if (!Number.isSafeInteger(result[key]) || result[key] < 1) throw new Error(`--${key} must be a positive integer`);
  if (!result.scales.length || result.scales.some(n => !Number.isSafeInteger(n) || n < 1)) throw new Error('--scales must be comma-separated positive integers');
  return result;
}
const config = options(process.argv.slice(2));
if (VERSION !== '1.3.0') throw new Error(`Expected native Pi 1.3.0, found ${VERSION}; set PI_RUNTIME to the pinned runtime.`);

const hooks = new Map(), bus = new Map();
let resolveRenderer;
const pi = {
  registerToolRenderer(fn) { resolveRenderer = fn; },
  on(name, fn) { const set = hooks.get(name) || new Set(); set.add(fn); hooks.set(name, set); return () => set.delete(fn); },
  events: { on(name, fn) { const set = bus.get(name) || new Set(); set.add(fn); bus.set(name, set); return () => set.delete(fn); }, emit(name, value) { for (const fn of bus.get(name) || []) fn(value); } },
};
const mode = createDisplayMode(true);
const disposeRenderer = registerModernTools(pi, mode);
const ctx = { hasUI: true, sessionManager: { getBranch: () => [] }, ui: { onTerminalInput() { return () => {}; } } };
const emit = (name, event = {}) => { for (const fn of hooks.get(name) || []) fn(event, ctx); };
const native = new Map([
  ['bash', createShellRenderers('$')],
  ['read', readRenderers],
  ['codemode', codemodeRenderers],
]);
const ui = { requestRender() {} };
const width = config.width;
const resultText = value => ({ content: [{ type: 'text', text: value }], details: {} });
let idSequence = 0;
function makeTool(name, args, result) {
  const id = `perf-${++idSequence}`;
  const stock = native.get(name);
  const definition = resolveRenderer(name, () => stock);
  const component = new ToolExecutionComponent(name, id, args, { showImages: false, outputPad: 0 }, definition, ui, os.tmpdir());
  component.setArgsComplete();
  component.markExecutionStarted();
  component.updateResult(result);
  return component;
}
function beginGroupedCalls(count) {
  const ids = Array.from({ length: count }, () => `perf-${++idSequence}`);
  emit('message_end', { message: { role: 'assistant', content: ids.map(id => ({ type: 'toolCall', id, name: 'read', arguments: { path: `/fixture/sample-${id}.txt` } })) } });
  return ids;
}
function makeGrouped(count, output = 'Synthetic recorded output.') {
  const ids = beginGroupedCalls(count), components = [];
  for (const id of ids) {
    const definition = resolveRenderer('read', () => readRenderers);
    const component = new ToolExecutionComponent('read', id, { path: `/fixture/sample-${id}.txt` }, { showImages: false, outputPad: 0 }, definition, ui, os.tmpdir());
    component.setArgsComplete(); component.markExecutionStarted(); component.updateResult(resultText(output)); components.push(component);
  }
  return components;
}
function paintAll(components) { let rows = 0; for (const component of components) rows += component.render(width).length; return rows; }
function reset() { emit('session_start'); }
function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = p => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
  return { p50: percentile(0.5), p95: percentile(0.95), min: sorted[0], max: sorted.at(-1) };
}
function measure(label, scenario, operation, samples = config.samples) {
  const wallMs = [], cpuUserMs = [], cpuSystemMs = [], heapDelta = [], rssDelta = [], externalDelta = [];
  for (let i = 0; i < samples; i++) {
    globalThis.gc?.();
    const before = process.memoryUsage(), cpuBefore = process.cpuUsage(), start = performance.now();
    operation();
    wallMs.push(performance.now() - start);
    const cpu = process.cpuUsage(cpuBefore), after = process.memoryUsage();
    cpuUserMs.push(cpu.user / 1000); cpuSystemMs.push(cpu.system / 1000);
    heapDelta.push(after.heapUsed - before.heapUsed); rssDelta.push(after.rss - before.rss); externalDelta.push(after.external - before.external);
  }
  return { label, scenario, samples, wallMs: summarize(wallMs), cpuUserMs: summarize(cpuUserMs), cpuSystemMs: summarize(cpuSystemMs), memoryDeltaBytes: { heapUsed: summarize(heapDelta), rss: summarize(rssDelta), external: summarize(externalDelta) } };
}
function measurePrepared(label, scenario, prepare, operation, samples = config.samples) {
  const wallMs = [], cpuUserMs = [], cpuSystemMs = [], heapDelta = [], rssDelta = [], externalDelta = [];
  for (let i = 0; i < samples; i++) {
    globalThis.gc?.();
    const fixture = prepare();
    const before = process.memoryUsage(), cpuBefore = process.cpuUsage(), start = performance.now();
    try { operation(fixture); }
    finally {
      wallMs.push(performance.now() - start);
      const cpu = process.cpuUsage(cpuBefore), after = process.memoryUsage();
      cpuUserMs.push(cpu.user / 1000); cpuSystemMs.push(cpu.system / 1000);
      heapDelta.push(after.heapUsed - before.heapUsed); rssDelta.push(after.rss - before.rss); externalDelta.push(after.external - before.external);
      fixture.dispose();
    }
  }
  return { label, scenario, samples, wallMs: summarize(wallMs), cpuUserMs: summarize(cpuUserMs), cpuSystemMs: summarize(cpuSystemMs), memoryDeltaBytes: { heapUsed: summarize(heapDelta), rss: summarize(rssDelta), external: summarize(externalDelta) } };
}
function scenarioForMode(modeName, enabled, scale) {
  mode.setEnabled(enabled);
  const cold = measure('cold-mount-and-first-paint', `${modeName}/transcript-${scale}`, () => {
    reset(); const components = makeGrouped(scale); paintAll(components);
  });
  reset(); const components = makeGrouped(scale); paintAll(components);
  const warm = measure(`warm-redraw-${config.warm}-iterations`, `${modeName}/transcript-${scale}`, () => {
    for (let i = 0; i < config.warm; i++) paintAll(components);
  });
  const header = new WorkStripHeader();
  header.state = 'completed'; header.summary = 'Synthetic recorded work completed.'; header.elapsedMs = 42000; header.open = false;
  const children = components.map(component => new WorkChild(component));
  const paintFold = () => { let rows = header.render(width).length; if (header.open) for (const child of children) rows += child.render(width).length; return rows; };
  const workHeader = measure('synthetic-work-header-child-expand-collapse', `${modeName}/transcript-${scale}`, () => {
    if (enabled) { header.toggle(); paintFold(); header.toggle(); paintFold(); }
    else { paintAll(components); paintAll(components); }
  });
  const expanded = measure('tool-group-expand-collapse-and-paint', `${modeName}/transcript-${scale}`, () => {
    for (const component of components) component.setExpanded(true);
    paintAll(components);
    for (const component of components) component.setExpanded(false);
    paintAll(components);
  });
  reset();
  return [cold, warm, workHeader, expanded];
}

export function makeProjectionFixture(turnCount, enabled) {
  const manager = core.SessionManager.inMemory('/synthetic-work-strip-performance');
  const hooks = new Map(), bus = new Map(), commands = new Map(), inputs = new Set();
  const subscribe = (map, name, fn) => { const set = map.get(name) || new Set(); map.set(name, set); set.add(fn); return () => set.delete(fn); };
  const piProjection = {
    on: (name, fn) => subscribe(hooks, name, fn),
    events: { on: (name, fn) => subscribe(bus, name, fn), emit(name, value) { for (const fn of [...bus.get(name) || []]) fn(value); } },
    appendEntry: (kind, data) => manager.appendCustomEntry(kind, data),
    getAllTools: () => [], registerCommand: (name, definition) => commands.set(name, definition), registerShortcut() {},
  };
  const modeProjection = createDisplayMode(enabled);
  const workControls = registerWorkStrip(piProjection, modeProjection, VERSION), dispose = workControls.dispose;
  registerFoldCommand(piProjection, modeProjection, workControls);
  // This partial-registration benchmark supplies the cache boundary owned by index.ts.
  clearDisplayLineCache?.();
  const uiProjection = { isFollowingOutput: true, theme: themeModule.theme, notify() {}, requestRender() {}, onTerminalInput(fn) { inputs.add(fn); return () => inputs.delete(fn); } };
  const context = { mode: 'tui', hasUI: true, ui: uiProjection, sessionManager: manager, isIdle: () => true };
  const display = {
    chatContainer: new tui.Container(), ui: uiProjection, pendingTools: new Map(), outputPad: 0,
    toolOutputExpanded: false, hideThinkingBlock: true, sessionManager: manager,
    session: { extensionRunner: { getMessageRenderer() {} } },
    getUserMessageText: message => message.content,
    getMarkdownThemeWithSettings: () => themeModule.getMarkdownTheme(), getMarkdownTransformers: () => [],
    editor: { addToHistory() {} },
  };
  const add = message => {
    message.timestamp = 1000 + manager.getBranch().length;
    manager.appendMessage(message);
    core.InteractiveMode.prototype.addMessageToChat.call(display, message);
    return manager.getBranch().at(-1);
  };
  for (let index = 0; index < turnCount; index++) {
    const user = add({ role: 'user', content: `Synthetic task ${index + 1}: inspect the recorded fixture.` });
    add({ role: 'assistant', content: [{ type: 'text', text: `Synthetic intermediate note ${index + 1}.` }], stopReason: 'stop' });
    const tool = new core.ToolExecutionComponent('read', `work-fixture-${index}`, { path: `/fixture/turn-${index + 1}.txt` }, { outputPad: 0 }, undefined, uiProjection, '/fixture');
    tool.setArgsComplete(); tool.updateResult({ content: [{ type: 'text', text: `Synthetic hidden tool result ${index + 1}.` }], isError: false });
    display.chatContainer.addChild(tool);
    const final = add({ role: 'assistant', content: [{ type: 'text', text: `Synthetic final response ${index + 1}.` }], stopReason: 'stop' });
    manager.appendCustomEntry(workEvidenceType, { version: 1, userId: user.id, finalId: final.id, endId: final.id, startedAt: 1000 + index, endedAt: 3000 + index, outcome: 'completed' });
  }
  // Reload/resume creates completed work strips from saved evidence.
  for (const fn of hooks.get('session_start') || []) fn({}, context);
  const paint = () => display.chatContainer.render(width).length;
  const work = action => commands.get('fold').handler(action, context);
  return {
    manager, mode: modeProjection, display, paint, work,
    rows: () => display.chatContainer[projectedChildren] || display.chatContainer.children,
    dispose() { dispose(); modeProjection.dispose(); clearDisplayLineCache?.(); if (inputs.size) throw new Error('Projection fixture leaked terminal input handlers.'); },
  };
}

function workProjectionScenarios(turnCount, enabled) {
  const modeName = enabled ? 'compact-on' : 'native-off';
  const scenario = `${modeName}/registered-work-projection-${turnCount}-turns`;
  const first = measurePrepared('first-work-projection-paint', scenario, () => makeProjectionFixture(turnCount, enabled), fixture => {
    const rows = fixture.paint();
    if (enabled && !fixture.rows().some(row => row.constructor?.name === 'WorkStripHeader')) throw new Error('Registered work-strip projection produced no synthetic headers.');
    if (!enabled && fixture.rows().some(row => row.constructor?.name === 'WorkStripHeader')) throw new Error('Native-off mode retained work-strip headers.');
    if (rows < turnCount) throw new Error('Synthetic transcript did not render all turns.');
  });
  const warm = measurePrepared(`registered-warm-redraw-${config.warm}-iterations`, scenario, () => {
    const fixture = makeProjectionFixture(turnCount, enabled); fixture.paint(); return fixture;
  }, fixture => {
    for (let index = 0; index < config.warm; index++) fixture.paint();
  });
  const disclosure = measurePrepared('registered-work-collapse-expand-and-paint', scenario, () => {
    const fixture = makeProjectionFixture(turnCount, enabled); fixture.paint(); return fixture;
  }, fixture => {
    void fixture.work('collapse'); fixture.paint();
    void fixture.work('expand'); fixture.paint();
  });
  return [first, warm, disclosure];
}
function longResultScenario(modeName, enabled) {
  mode.setEnabled(enabled); reset();
  const longToolOutput = 'Synthetic tool output with a stable fixture marker.\n'.repeat(Math.ceil(config.longChars / 53)).slice(0, config.longChars);
  const tool = makeTool('read', { path: '/fixture/long-result.txt' }, resultText(longToolOutput));
  const longCode = 'const sample = "synthetic";\n'.repeat(Math.ceil(config.longChars / 29)).slice(0, config.longChars);
  const codeResult = { content: [{ type: 'text', text: `Script completed\nOutput:\n${longToolOutput}` }], details: { calls: Array.from({ length: config.nestedCalls }, (_, index) => ({ name: 'read', args: `/fixture/record-${index}.txt`, status: 'ok', durationMs: 1 })) }, durationMs: 1000 };
  const code = makeTool('codemode', { code: longCode }, codeResult);
  const collapsed = measure('long-tool-and-codemode-collapsed', `${modeName}/long-results`, () => { tool.setExpanded(false); code.setExpanded(false); paintAll([tool, code]); });
  const expanded = measure('long-tool-and-codemode-expanded', `${modeName}/long-results`, () => { tool.setExpanded(true); code.setExpanded(true); paintAll([tool, code]); });
  code.callRendererComponent?.owner?.code?.dispose?.();
  return [collapsed, expanded];
}

export function disposePerformanceReview() {
  mode.setEnabled(true); emit('session_shutdown'); disposeRenderer(); mode.dispose(); clearDisplayLineCache?.();
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
const results = [];
try {
  emit('session_start');
  for (const scale of config.scales) {
    results.push(...scenarioForMode('compact-on', true, scale));
    results.push(...scenarioForMode('native-off', false, scale));
    results.push(...workProjectionScenarios(scale, true));
    results.push(...workProjectionScenarios(scale, false));
  }
  results.push(...longResultScenario('compact-on', true));
  results.push(...longResultScenario('native-off', false));
  console.log(JSON.stringify({
    schema: 'compact-renderer-performance-review/v1',
    runtime: { version: VERSION, path: runtime, width, platform: process.platform, arch: process.arch, node: process.version },
    fixture: { source: 'synthetic in-memory records only', transcriptScales: config.scales, workTurnsPerProjection: config.scales, workProjectionRowsPerTurn: 'user + intermediate assistant + tool component + final assistant, plus native spacing', samples: config.samples, warmIterations: config.warm, longResultCharacters: config.longChars, nestedCalls: config.nestedCalls },
    metrics: { wallMs: 'elapsed per operation; warm scenario includes the configured redraw iteration count', cpuMs: 'process CPU consumed per operation', memoryDeltaBytes: 'process memory delta around each operation; allocator/GC noise applies' },
    results,
    limits: [
      'Measures synchronous layout and painting in the native Pi renderer component tree only.',
      'Work-strip cases use registered WorkStrip hooks, native InteractiveMode addMessageToChat and chatContainer.render projection, saved completion evidence, and the /fold collapse/expand handlers; fixture construction is outside measured intervals.',
      'The native-off work-strip arm disables those handlers and measures the unprojected native transcript redraw as its comparison.',
      'Does not measure terminal transport, terminal emulator painting, input latency, model latency, tool execution, network, or full interactive-session startup.',
      'Synthetic fixtures contain no user transcript, credentials, or business data.',
      'Memory deltas are process-wide snapshots, not per-component retained-size measurements; run with --expose-gc for optional pre-sample collection.',
    ],
  }, null, 2));
} finally {
  disposePerformanceReview();
}
}
