import assert from 'node:assert/strict';
import { loadSource, stripAnsi, tui } from './test-runtime.mjs';

const { compactToolRows, compactToolTarget, wrapOmpToolRenderer, registerOmpToolRows, toolRunFor } = await loadSource('omp-tool-rows.ts');
const theme = { fg: (_token, text) => text, bold: text => text };
const plain = rows => rows.map(stripAnsi);
const lines = count => Array.from({ length: count }, (_, index) => `line ${index + 1}`).join('\n');

// The row names the tool by the argument a reader recognizes, and keeps one line.
assert.equal(compactToolTarget({ command: '  git   status  ' }), 'git status');
assert.equal(compactToolTarget({ path: '/tmp/notes.md' }), '/tmp/notes.md');
assert.equal(compactToolTarget({}), '');
{
  const rows = plain(compactToolRows('bash', { command: 'seq 3' }, undefined, true, theme, 40));
  assert.equal(rows.length, 1, 'a call before its result is one row');
  assert.match(rows[0], /bash · seq 3/);
  assert.match(rows[0], /preparing/);
}

// The live window keeps its height and shows the newest lines, not the first ones.
for (const [count, expected] of [[0, []], [1, ['line 1']], [10, ['line 8', 'line 9', 'line 10']]]) {
  const rows = plain(compactToolRows('bash', { command: 'seq 10' }, { content: [{ type: 'text', text: lines(count) }] }, true, theme, 40));
  assert.equal(rows.length, 4, `live window is heading plus three rows for ${count} lines`);
  assert.match(rows[0], /▾ bash · seq 10 · running/);
  const tail = rows.slice(1).map(row => row.trim()).filter(Boolean);
  assert.deepEqual(tail, expected);
  for (const row of rows) assert.ok(tui.visibleWidth(row) <= 40, 'rows stay inside the width');
}

// A settled action collapses to one row with its outcome.
{
  const ok = plain(compactToolRows('read', { path: 'src/a.ts' }, { content: [{ type: 'text', text: 'body' }] }, false, theme, 40));
  assert.equal(ok.length, 1);
  assert.match(ok[0], /^ ✓ read · src\/a\.ts$/);
  const failed = plain(compactToolRows('bash', { command: 'false' }, { content: [], details: { exitCode: 2 } }, false, theme, 40));
  assert.match(failed[0], /✗ bash · false · failed/);
  const error = plain(compactToolRows('grep', { pattern: 'x' }, { content: [], isError: true }, false, theme, 40));
  assert.match(error[0], /✗ grep · x · failed/);
  const truncated = plain(compactToolRows('bash', { command: 'seq' }, { content: [], details: { truncation: { truncated: true } } }, false, theme, 40));
  assert.match(truncated[0], /· output truncated/);
}

// Tool output is untrusted: control sequences must not escape the one-row window, and tabs must not
// break its width. The tail keeps block order and only scans the end of a large result.
{
  const tabs = plain(compactToolRows('bash', { command: 'printf' }, { content: [{ type: 'text', text: 'a\tb' }] }, true, theme, 40));
  assert.ok(tabs.every(row => !row.includes('\t')), 'tabs are expanded');
  assert.match(tabs[1], /a    b/);
  const controls = plain(compactToolRows('read', { path: 'a\x1b[2Jb' }, { content: [{ type: 'text', text: 'x\x1b[2Jy\x1b[31mred\x1b[0m' }] }, true, theme, 40));
  assert.ok(controls.every(row => !row.includes('\x1b')), 'control sequences are stripped');
  assert.match(controls[0], /read · ab/);
  assert.match(controls[1], /xyred/);
  const blocks = plain(compactToolRows('bash', { command: 'two blocks' }, { content: [{ type: 'text', text: 'head\na\nb' }, { type: 'text', text: 'c\nd\ne' }] }, true, theme, 40));
  assert.deepEqual(blocks.slice(1).map(row => row.trim()).filter(Boolean), ['c', 'd', 'e'], 'blocks keep their order');
  const large = plain(compactToolRows('bash', { command: 'seq' }, { content: [{ type: 'text', text: `${lines(50000)}\nlast` }] }, true, theme, 40));
  assert.deepEqual(large.slice(1).map(row => row.trim()).filter(Boolean), ['line 49999', 'line 50000', 'last']);
}

// Consecutive settled rows of the same tool collapse into one action block; a different tool,
// turn segment, expanded row, or running row breaks the run.
{
  const row = (name = 'bash', segment = 0, settled = true, expanded = false) => ({ name, segment, settled, expanded });
  const run = [row(), row(), row()];
  assert.equal(toolRunFor(run, run[1]).length, 3);
  const split = [row(), row('read')];
  assert.equal(toolRunFor(split, split[0]).length, 1, 'different tools stay apart');
  const prose = [row(), row('bash', 1)];
  assert.equal(toolRunFor(prose, prose[1]).length, 1, 'prose splits runs');
  const expanded = [row(), row('bash', 0, true, true), row()];
  assert.equal(toolRunFor(expanded, expanded[1]).length, 1, 'expanded item never absorbs collapsed neighbors');
  const running = [row(), row('bash', 0, false)];
  assert.equal(toolRunFor(running, running[0]).length, 1, 'running rows stay alone');
  const failure = [row(), { ...row(), successful: false }, row()];
  assert.equal(toolRunFor(failure, failure[0]).length, 1, 'failures never become hidden followers');
  assert.equal(toolRunFor(failure, failure[1]).length, 1, 'failure cannot absorb successful neighbors');
}

// Expanded, folding off, and image results keep the native card.
{
  const stock = {
    mergeCallAndResult: true,
    renderCall: () => ({ render: () => ['STOCK CALL'] }),
    renderResult: () => ({ render: () => ['STOCK RESULT'] }),
  };
  const on = { isEnabled: () => true };
  assert.deepEqual(plain(wrapOmpToolRenderer('bash', stock, on).renderCall({}, { expanded: true }, theme).render(40)), ['STOCK CALL']);
  assert.deepEqual(plain(wrapOmpToolRenderer('bash', stock, on).renderResult({ content: [] }, { expanded: true }, theme, {}).render(40)), ['STOCK RESULT']);
  assert.deepEqual(plain(wrapOmpToolRenderer('bash', stock, on).renderResult({ content: [{ type: 'image' }] }, {}, theme, {}).render(40)), ['STOCK RESULT']);
  const off = { isEnabled: () => false };
  assert.deepEqual(plain(wrapOmpToolRenderer('bash', stock, off).renderCall({}, {}, theme).render(40)), ['STOCK CALL']);
  assert.match(plain(wrapOmpToolRenderer('bash', stock, on).renderCall({}, {}, theme).render(40))[0], /preparing/);
}

// Pi hosts keep their own renderers.
assert.equal(await registerOmpToolRows({ registerToolRenderer() {} }, { isEnabled: () => true }), undefined);

console.log('OMP tool rows: target, live window height/tail, settled outcomes, and native fallbacks passed');
