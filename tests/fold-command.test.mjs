import assert from 'node:assert/strict';
import { loadSource, loadSharedSource } from './test-runtime.mjs';

const { registerFoldCommand } = await loadSource('./fold-command.ts');
const { createDisplayMode } = await loadSource('./display-mode.ts');

function fixture(hasUI = true) {
  const commands = new Map(), notices = [], menus = [], expansions = [], shortcutChanges = [], modeChanges = [];
  const mode = createDisplayMode();
  mode.onChange(() => modeChanges.push(mode.isEnabled()));
  let shortcut = true, selection = () => undefined, available = hasUI;
  const work = {
    dispose() {},
    setExpanded(open) { expansions.push(open); return available; },
    isShortcutEnabled: () => shortcut,
    setShortcutEnabled(enabled) { shortcut = enabled; shortcutChanges.push(enabled); },
  };
  const dispose = registerFoldCommand({ registerCommand: (name, command) => commands.set(name, command) }, mode, work);
  const ctx = { hasUI, ui: {
    notify: (message, tone) => notices.push({ message, tone }),
    select(title, choices) { menus.push({ title, choices }); return selection(title, choices); },
  } };
  return {
    mode, commands, notices, menus, expansions, shortcutChanges, modeChanges, dispose,
    run: args => commands.get('fold').handler(args, ctx),
    choose: fn => { selection = fn; },
    unavailable: () => { available = false; },
    shortcut: () => shortcut,
    lastNotice: () => notices.at(-1)?.message,
  };
}

{
  const f = fixture();
  assert.deepEqual([...f.commands.keys()], ['fold'], 'only the unified command is registered');
  await f.run('status'); assert.equal(f.lastNotice(), 'Pi Fold on');
  await f.run('OFF'); assert.equal(f.mode.isEnabled(), false); assert.equal(f.lastNotice(), 'Pi Fold off');
  await f.run('status'); assert.equal(f.lastNotice(), 'Pi Fold off');
  for (const command of ['collapse', 'expand']) {
    await f.run(command);
    assert.match(f.lastNotice(), /^Turn Pi Fold on with \/fold on/);
  }
  assert.deepEqual(f.expansions, [], 'work commands cannot enable or change an off display');
  assert.equal(f.mode.isEnabled(), false);
  await f.run(' toggle '); assert.equal(f.mode.isEnabled(), true);
  await f.run('collapse'); await f.run('expand');
  assert.deepEqual(f.expansions, [false, true], 'collapse and expand route to work controls');
  await f.run('on'); assert.deepEqual(f.modeChanges, [false, true], 'setting current mode does not toggle it');
  await f.run('shortcut off'); assert.equal(f.shortcut(), false); assert.equal(f.lastNotice(), 'Toggle work shortcut: off');
  await f.run('shortcut\tON'); assert.equal(f.shortcut(), true); assert.equal(f.lastNotice(), 'Toggle work shortcut: on');
  assert.deepEqual(f.shortcutChanges, [false, true]);
  f.unavailable(); await f.run('expand'); assert.match(f.lastNotice(), /unavailable/);
  f.dispose(); f.mode.dispose();
}

{
  const f = fixture();
  await f.run('');
  assert.match(f.menus[0].title, /Pi Fold.*this session/);
  assert.match(f.menus[0].choices[0], /^on \(current\)/);
  assert.deepEqual(f.modeChanges, []); assert.deepEqual(f.notices, [], 'menu cancellation is silent');
  f.choose((_title, choices) => choices[0]);
  await f.run(''); assert.deepEqual(f.modeChanges, [], 'choosing the current mode changes nothing');
  f.choose((_title, choices) => choices.find(choice => choice.startsWith('off')));
  await f.run(''); assert.equal(f.lastNotice(), 'Pi Fold off');
  f.choose((_title, choices) => { assert.match(choices[1], /^off \(current\)/); return choices[0]; });
  await f.run(''); assert.equal(f.mode.isEnabled(), true);
  for (const command of ['collapse', 'expand']) {
    f.choose((_title, choices) => choices.find(choice => choice.startsWith(command)));
    await f.run('');
  }
  assert.deepEqual(f.expansions, [false, true], 'menu work actions use the typed command route');
  f.choose((title, choices) => title.startsWith('Pi Fold') ? choices[4] : undefined);
  const noticesBefore = f.notices.length;
  await f.run('');
  assert.equal(f.notices.length, noticesBefore, 'canceling the nested shortcut menu changes nothing');
  assert.deepEqual(f.shortcutChanges, []);
  f.choose((title, choices) => title.startsWith('Pi Fold') ? choices[4] : choices[1]);
  await f.run(''); assert.equal(f.shortcut(), false); assert.equal(f.lastNotice(), 'Toggle work shortcut: off');
  f.choose((_title, choices) => choices[1]);
  await f.run('shortcut'); assert.deepEqual(f.shortcutChanges, [false], 'choosing the current shortcut changes nothing');
  f.choose((_title, choices) => choices[0]);
  await f.run('shortcut'); assert.equal(f.shortcut(), true);
  f.dispose(); f.mode.dispose();
}

{
  const f = fixture();
  for (const command of ['unknown', 'off extra', 'collapse all', 'shortcut toggle', 'shortcut on extra']) {
    await f.run(command); assert.match(f.lastNotice(), /^Use \/fold /);
  }
  f.choose(() => 'unknown menu value');
  await f.run(''); await f.run('shortcut');
  assert.deepEqual(f.modeChanges, []); assert.deepEqual(f.expansions, []); assert.deepEqual(f.shortcutChanges, []);
  f.dispose(); f.mode.dispose();
}

{
  const f = fixture(false);
  f.choose(() => { throw new Error('No-UI commands must not open a menu'); });
  await f.run(''); assert.equal(f.lastNotice(), 'Pi Fold on');
  await f.run('off'); await f.run('status'); assert.equal(f.lastNotice(), 'Pi Fold off');
  await f.run('toggle'); assert.equal(f.mode.isEnabled(), true);
  await f.run('shortcut'); assert.equal(f.lastNotice(), 'Toggle work shortcut: on');
  await f.run('shortcut off'); await f.run('shortcut'); assert.equal(f.lastNotice(), 'Toggle work shortcut: off');
  await f.run('collapse'); assert.match(f.lastNotice(), /unavailable/);
  assert.deepEqual(f.menus, [], 'typed mode and shortcut settings work without a UI');
  f.dispose(); f.mode.dispose();
}

{
  const f = fixture();
  let resolve;
  f.choose(() => new Promise(done => { resolve = done; }));
  const pending = f.run('');
  f.dispose(); resolve(f.menus[0].choices[1]); await pending;
  await f.run('off'); await f.run('shortcut off');
  assert.deepEqual(f.modeChanges, []); assert.deepEqual(f.shortcutChanges, []); assert.deepEqual(f.notices, [], 'disposed commands and pending menus cannot mutate a later session');
  f.mode.dispose();
}

// Register the actual extension to detect aliases and root lifecycle wiring.
{
  const { default: register } = await loadSharedSource('../index.ts');
  const hooks = new Map(), bus = new Map(), commands = new Map(), notices = [];
  const subscribe = (map, event, fn) => {
    const set = map.get(event) || new Set(); set.add(fn); map.set(event, set);
    return () => set.delete(fn);
  };
  const pi = {
    on: (event, fn) => subscribe(hooks, event, fn),
    events: { on: (event, fn) => subscribe(bus, event, fn), emit(event, data) { for (const fn of [...bus.get(event) || []]) fn(data); } },
    registerCommand(name, command) { assert.ok(!commands.has(name), `no duplicate /${name}`); commands.set(name, command); },
    registerToolRenderer() {}, registerMarkdownTransformer() {}, registerShortcut() {}, appendEntry() {}, getCommands: () => [], getAllTools: () => [],
  };
  const ctx = { mode: 'none', hasUI: false, ui: { notify: message => notices.push(message) }, sessionManager: { getBranch: () => [], buildContextEntries: () => [] } };
  const emit = event => { for (const fn of [...hooks.get(event) || []]) fn({}, ctx); };
  try {
    await register(pi); emit('session_start');
    assert.ok(commands.has('fold'));
    assert.ok(!commands.has('work')); assert.ok(!commands.has('compact-rendering'), 'old aliases are absent from actual root registration');
    await commands.get('fold').handler('off', ctx); assert.match(notices.at(-1), /^Pi Fold off\nCompatibility: full/);
    await commands.get('fold').handler('on', ctx); assert.match(notices.at(-1), /^Pi Fold on\nCompatibility: full/);
    emit('session_shutdown'); const count = notices.length;
    await commands.get('fold').handler('toggle', ctx);
    assert.equal(notices.length, count, 'root disposal disables stale command callbacks');
  } finally { emit('session_shutdown'); }
}

console.log('Pi Fold command: mode, work routing, menus, cancellation, shortcut, no-UI and root lifecycle passed');
