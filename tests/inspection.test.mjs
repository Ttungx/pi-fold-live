import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { loadSource, tui, tuiRoot, themeModule, stripAnsi } from './test-runtime.mjs';
const { revealInspection, registerInspection } = await loadSource('./inspection.ts');
const { createDisplayMode } = await loadSource('./display-mode.ts');
const { VIEWPORT_TUI } = await import(pathToFileURL(path.join(tuiRoot, 'dist/tui.js')));
const { renderLayoutFrame } = await import(pathToFileURL(path.join(tuiRoot, 'dist/layout.js')));
const document = new tui.Container();
const before = new tui.Box(1, 1); before.addChild(new tui.Text('Before\n'.repeat(70), 0, 0)); document.addChild(before);
const inner = new tui.Text('Selected block', 0, 0), target = new tui.Box(1, 1); target.addChild(inner); document.addChild(target);
document.addChild(new tui.Text('After\n'.repeat(60), 0, 0));
const scroll = new tui.ScrollView(document, { primary: true, follow: 'end' });
const root = new tui.VStack([{ component: new tui.Text('Prompt Jump strip', 0, 0), basis: 1 }, { component: scroll, grow: 1 }]);
let renders = 0;
const host = { [VIEWPORT_TUI]: true, mode: 'fullscreen', terminal: { columns: 80, rows: 24 }, getMountedRoots: () => [root], requestRender() { renders++; renderLayoutFrame(root, 80, 24, () => {}); } };
host.requestRender();
assert.equal(revealInspection(host, component => component === inner), true);
assert.equal(scroll.scrollTop, before.render(80).length, 'selected opaque native block is brought into view with its padding');
assert.equal(scroll.isFollowingEnd, false);
const frame = renderLayoutFrame(root, 80, 24, () => {});
assert.ok(frame.lines.map(stripAnsi).join('\n').includes('Selected block'));
assert.equal(revealInspection(host, component => component === inner, '9.0.0'), true);
assert.equal(revealInspection({}, () => true), false);
const previous = scroll.scrollTop;
assert.equal(revealInspection(host, () => false), false); assert.equal(scroll.scrollTop, previous);
const hooks = new Map(), bus = new Map(), commands = new Map(), statuses = new Map(), widgets = new Map();
const subscribe = (map, key, fn) => { const set = map.get(key) || new Set(); map.set(key, set); set.add(fn); return () => set.delete(fn); };
const pi = { on: (key, fn) => subscribe(hooks, key, fn), events: { on: (key, fn) => subscribe(bus, key, fn), emit: (key, data) => { for (const fn of [...bus.get(key) || []]) fn(data); } }, registerCommand: (name, command) => commands.set(name, command) };
let picked = 0, focused = 0;
const ctx = { hasUI: true, mode: 'tui', ui: {
 setWidget(name, factory) { if (!factory) widgets.delete(name); else widgets.set(name, factory(host, themeModule.theme)); },
 setStatus(name, value) { statuses.set(name, value); }, notify() {},
 async select(title, options) { assert.equal(title, 'Inspect a block'); return picked < 0 ? undefined : options[picked]; },
} };
const emit = (name, value = {}) => { for (const fn of [...hooks.get(name) || []]) fn(value, ctx); };
const mode = createDisplayMode();
const dispose = registerInspection(pi, mode);
pi.events.on('compact-renderer:inspect:v1', request => request.add({ id: 'fixture', kind: 'Tools', label: '2 actions', focus() { focused++; pi.events.emit('compact-renderer:focus:v1', { owner: 'tools', label: '2 actions', target: component => component === inner }); } }));
try {
 emit('session_start'); assert.equal(widgets.size, 1); assert.deepEqual([...widgets.values()][0].render(80), []);
 await commands.get('inspect').handler('', ctx); assert.equal(focused, 1);
 assert.match(statuses.get('compact-inspection'), /Inspecting tools · Esc or type to return/);
 picked = -1; await commands.get('inspect').handler('', ctx); assert.equal(focused, 1, 'cancel does not select');
 pi.events.emit('compact-renderer:inspection-ended:v1', {}); assert.equal(statuses.get('compact-inspection'), undefined);
 picked = 0; await commands.get('inspect').handler('', ctx); emit('ui_prompt_start'); assert.equal(statuses.get('compact-inspection'), undefined);
 mode.setEnabled(false); await commands.get('inspect').handler('', ctx); assert.equal(focused, 2, 'native mode does not inspect compact cards');
 dispose(); dispose(); assert.equal(widgets.size, 0); assert.equal(host.getMountedRoots()[0], root, 'never replaces Prompt Jump/native root');
 console.log('inspection: native picker, cancel, guarded viewport reveal, visible focus status and cleanup passed');
} finally { dispose(); }
