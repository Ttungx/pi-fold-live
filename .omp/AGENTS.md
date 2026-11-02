# pi-fold-live

Pi TUI extension (fork of `@notrico/pi-fold` 3.1.0). `index.ts` is the Pi entry point; runtime modules live in `src/`, regression checks in `tests/`, preview and benchmark runners in `scripts/`, upstream design notes in `docs/`.

## Commands

- `npm install`, then `npm test`. The checks load Pi 1.4's own TUI classes, so `node_modules` must exist.
- Previews: `node scripts/preview.mjs`, `node scripts/preview-work-strip.mjs`.
- Row-renderer ablation: `node scripts/omp-rows-ablation.mjs` (full scan vs capped vs shipped OMP rows).
- Windows: run from Git Bash; `python` exists, `python3` does not.

## Rules

- Target the Pi 1.3/1.4 interfaces only, and keep every display feature behind the `src/runtime-compatibility.ts` probes. When an adapter is missing, native rendering must stay in place.
- Do not add options, config files, or settings. `/fold` is the only user surface.
- Keep the `finalReplyRendering` marker on the final reply row: `src/modern-workflows.ts` uses it to skip a component the work strip already wrapped.
- Do not reintroduce the "scroll stays stuck on an open pane" patch; it was removed on request.
- No new dependencies.

## OMP

`omp` (oh-my-pi 18.x) loads this package through `package.json#omp.extensions`, and its Pi compatibility layer resolves the `@earendil-works/*` imports. `src/omp-tool-rows.ts` renders the plain-text and diff built-ins through OMP's exported `toolRenderers` registry and folds consecutive same-tool rows through the component render pass; Ctrl+O and `/fold off` must keep delegating to the stock renderer. OMP removed the other hooks the Pi adapters patch (`registerToolRenderer`, `MouseRegion`, `UserMessageComponent.rebuild`, `InteractiveMode` internals), so thinking, prompts, skills, subagents, and the `ask`/`task`/`todo`/`wait` cards stay OMP-native. Do not port those onto OMP internals without an explicit request.
