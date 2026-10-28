#!/usr/bin/env node
// Load the actual bundled CLI and extension through RPC. No prompt is submitted.
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const agent = process.env.PI_INSTALL_ROOT;
if (!agent) throw new Error('PI_INSTALL_ROOT must select the tested Pi package');
const manifest = JSON.parse(readFileSync(path.join(agent, 'package.json'), 'utf8'));
const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin.pi;
const home = mkdtempSync(path.join(tmpdir(), 'pi-fold-cli-'));
try {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(agent, bin), '--mode', 'rpc', '--no-session', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-themes', '-e', path.join(root, 'index.ts')], {
      cwd: home, env: { ...process.env, HOME: home, PI_CODING_AGENT_DIR: home }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let pending = '', errors = '', passed = false;
    const timeout = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`CLI smoke timed out: ${errors}`)); }, 30000);
    child.stderr.on('data', data => { errors += data.toString(); });
    child.stdout.on('data', data => {
      pending += data.toString();
      let end;
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end); pending = pending.slice(end + 1);
        let response; try { response = JSON.parse(line); } catch { continue; }
        if (response.id !== 'fold-compat') continue;
        const names = response.data?.commands?.map(command => command.name) || [];
        if (!response.success || !names.includes('fold') || !names.includes('inspect')) {
          clearTimeout(timeout); child.kill('SIGTERM'); reject(new Error(`CLI extension did not register: ${line}\n${errors}`)); return;
        }
        passed = true; child.kill('SIGTERM');
      }
    });
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('exit', code => { clearTimeout(timeout); passed ? resolve() : reject(new Error(`CLI exited ${code}: ${errors}`)); });
    child.stdin.write(JSON.stringify({ id: 'fold-compat', type: 'get_commands' }) + '\n');
  });
  console.log(`Pi ${manifest.version}: bundled CLI registered /fold and /inspect without model calls`);
} finally { rmSync(home, { recursive: true, force: true }); }
