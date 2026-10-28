#!/usr/bin/env node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const selection = process.argv[process.argv.indexOf('--pi') + 1];
if (!['oldest', 'latest'].includes(selection)) throw new Error('Usage: node scripts/compatibility-check.mjs --pi oldest|latest');
const registry = 'https://registry.npmjs.org';
const packageName = '@earendil-works/pi-coding-agent';
const metadata = await fetch(`${registry}/${packageName.replace('/', '%2f')}`, { signal: AbortSignal.timeout(30000) }).then(r => {
  if (!r.ok) throw new Error(`npm registry returned ${r.status}`);
  return r.json();
});
const version = selection === 'oldest' ? '1.3.0' : metadata['dist-tags']?.latest;
if (!metadata.versions?.[version]) throw new Error(`Pi ${version} is absent from registry metadata`);
const installRoot = mkdtempSync(path.join(tmpdir(), 'pi-fold-compat-'));
try {
  const manifest = { private: true, type: 'module', dependencies: {
    [packageName]: version,
    'pi-subagents': '0.79.2',
    'pi-questions': 'latest',
    'pi-prompt-jump': '0.1.0',
  }};
  writeFileSync(path.join(installRoot, 'package.json'), JSON.stringify(manifest, null, 2));
  const install = spawnSync('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts'], { cwd: installRoot, stdio: 'inherit' });
  if (install.status !== 0) throw new Error(`npm install failed (${install.status})`);
  const actual = JSON.parse(await import('node:fs/promises').then(fs => fs.readFile(path.join(installRoot, 'node_modules', packageName, 'package.json'), 'utf8'))).version;
  if (actual !== version) throw new Error(`Installed Pi core ${actual}; requested ${version}`);
  console.log(`Compatibility target: ${packageName}@${actual} (${selection})`);
  const env = { ...process.env, PI_RUNTIME: installRoot, PI_INSTALL_ROOT: path.join(installRoot, 'node_modules', packageName) };
  const tests = spawnSync(process.execPath, [path.join(root, 'scripts/test.mjs')], { cwd: root, env, stdio: 'inherit' });
  if (tests.status !== 0) throw new Error(`Regression suite failed (${tests.status})`);
  const smoke = spawnSync(process.execPath, [path.join(root, 'scripts/compatibility-cli-smoke.mjs')], { cwd: root, env, stdio: 'inherit' });
  if (smoke.status !== 0) throw new Error(`CLI smoke failed (${smoke.status})`);
} finally {
  rmSync(installRoot, { recursive: true, force: true });
}
