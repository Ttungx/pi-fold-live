#!/usr/bin/env node
// Every test runs in a fresh process: native prototype adapters cannot mask cleanup failures in other suites.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const directory = fileURLToPath(new URL('../tests/', import.meta.url));
const required = ['action-intent.test.mjs', 'modern-workflows.test.mjs', 'display-mode.test.mjs', 'modern-tools.test.mjs', 'modern-subagent-messages.test.mjs', 'subagent-spacing.test.mjs', 'modern-subagent-groups.test.mjs', 'modern-thinking.test.mjs', 'modern-prompts.test.mjs', 'permission-presentation.test.mjs', 'input-focus.test.mjs', 'inspection.test.mjs', 'codemode.test.mjs', 'preview-example.test.mjs'];
required.push('reload-lifecycle.test.mjs', 'ordinary-prompts.test.mjs', 'work-strip-hierarchy.test.mjs', 'work-strip-final-surface.test.mjs');
required.push('modern-skill-prompts.test.mjs', 'inspection-wheel.test.mjs');
required.push('display-line-cache.test.mjs');
required.push('display-cache-lifecycle.test.mjs');
required.push('fold-command.test.mjs', 'fold-shortcut.test.mjs', 'follow-display.test.mjs');
required.push('mixed-thinking.test.mjs', 'work-strip.test.mjs', 'work-strip-subagents.test.mjs', 'work-strip-preview.test.mjs', 'work-strip-spacing.test.mjs');
required.push('mixed-action-groups.test.mjs', 'action-group-preview.test.mjs');
required.push('fullscreen-overlays.test.mjs', 'runtime-compatibility.test.mjs', 'compatibility-fallbacks.test.mjs');
for (const name of required) {
  if (!fs.existsSync(path.join(directory, name))) throw new Error(`Missing required regression suite: ${name}`);
  const result = spawnSync(process.execPath, [path.join(directory, name)], { cwd: directory, env: process.env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log('Pi Fold native regression suites passed');
