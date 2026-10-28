import assert from 'node:assert/strict';
import { loadSource } from './test-runtime.mjs';
const { actionIntent, groupIntent, codeIntent } = await loadSource('./action-intent.ts');
const bash = command => ({ name: 'bash', args: { command } });

assert.equal(actionIntent('read', { path: '/secret/project' }), 'Read files');
assert.equal(actionIntent('mcp__filesystem__read_file', {}), 'Read files');
assert.equal(actionIntent('bash', { command: "jq '.records[] | .name' records.json" }), 'Inspect JSON records');
assert.equal(actionIntent('bash', { command: 'gh pr list --json number,title' }), 'Check pull requests');
assert.equal(actionIntent('bash', { command: 'gh pr checks 19' }), 'Check pull requests');
assert.equal(actionIntent('bash', { command: 'git status --short && git diff --stat' }), 'Check Git changes');
assert.equal(actionIntent('bash', { command: "cd /project && cat README.md && npm test" }), 'Read files and run checks');
assert.equal(actionIntent('bash', { command: 'node action-intent.test.mjs' }), 'Run checks');
assert.equal(groupIntent([bash("jq '.records' records.json"), bash('gh pr checks 19')]), 'Inspect JSON records and check pull requests');
assert.equal(groupIntent([bash('git status'), bash('git diff')]), 'Check Git changes');
assert.equal(groupIntent([bash('cat README.md'), bash('git status'), bash('npm test')]), 'Read files and check Git changes; and other actions');
assert.equal(groupIntent([bash('cat README.md && git status'), bash('git diff && npm test')]), 'Read files and check Git changes; and other actions', 'combine and deduplicate operations across shell groups');
assert.equal(groupIntent([bash('cat README.md'), { name: 'unknown-secret-tool', args: {} }]), 'Read files and run tool actions');

const nested = [{ name: 'bash', args: JSON.stringify({ command: "jq '.records' records.json" }), status: 'ok' }, { name: 'bash', args: JSON.stringify({ command: 'gh pr checks 19' }), status: 'ok' }];
assert.equal(codeIntent({ code: 'arbitrary JavaScript' }, nested), 'Inspect JSON records and check pull requests');
assert.equal(codeIntent({ code: 'text("gh pr checks");' }, []), 'Run code');
assert.equal(codeIntent({}, [{ name: 'bash', args: '{"command":"jq .records ...', status: 'ok' }]), 'Run shell commands');
assert.equal(codeIntent({}, [{ name: 'read', args: 'truncated preview...' }]), 'Read files');
assert.equal(actionIntent('bash', JSON.stringify({ command: 'npm run typecheck' })), 'Run checks');

// Argument contents, quoted commands, control characters, and source are never labels.
for (const command of ["echo 'git status'", "node -e 'gh pr checks 19'", 'echo $(git status)', 'cat <<EOF\ngit status\nEOF', "jq 'unterminated", 'echo SECRET\u001b[31m\u202e', 'x'.repeat(1000000)]) {
  assert.equal(actionIntent('bash', { command }), 'Run shell commands');
}
assert.equal(actionIntent('bash', { command: "echo 'private; gh pr checks 19'" }), 'Run shell commands');
assert.equal(actionIntent('unknown\u001b[31m\u202e', { label: 'Reveal SECRET', description: 'secret purpose' }), 'Run tool actions');
assert.equal(actionIntent('bash', { command: 'gh pr merge 19' }), 'Run shell commands', 'do not call a write operation a check');
assert.equal(actionIntent('bash', { command: 'git reset --hard' }), 'Run shell commands');
assert.equal(actionIntent('bash', { command: 'find . -delete' }), 'Run shell commands');
assert.equal(groupIntent([]), 'Run tool actions');
assert.equal(groupIntent(Array.from({ length: 65 }, () => ({ name: 'read', args: {} }))), 'Read files; and other actions');
let reads = 0;
const args = Object.defineProperty({}, 'command', { get() { reads++; throw new Error('not recorded data'); } });
assert.equal(actionIntent('bash', args), 'Run shell commands');
const calls = Object.defineProperty([], 0, { get() { reads++; throw new Error('not recorded data'); } });
assert.equal(codeIntent({}, calls), 'Run tool actions');
assert.equal(reads, 0);
console.log('Action intent checks passed');
