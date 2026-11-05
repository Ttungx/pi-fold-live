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

`omp` 18.x resolves `@earendil-works/*` through its Pi compatibility loader. `src/omp-tool-rows.ts` handles ANSI rows/individual action links and native TSP tool previews/toggles; `src/omp-thinking.ts` projects one moving thinking row while preserving native bodies and final replies. Both must pass `src/runtime-compatibility.ts` probes and restore stock rendering with `/fold off` and disposal. Keep OMP-only dynamic imports literal: variable specifiers can pass source playback but fail in the compiled loader.

For OMP changes, run `bun scripts/omp-runtime-smoke.mjs <installed @oh-my-pi/pi-coding-agent directory>`; it covers real ANSI/TSP components and bundled-CLI registration. Herdr click/Shift+wheel acceptance is separate. Preserve the user's mouse/link-renderer settings; plain-terminal clicks need both host opt-ins, while native TSP toggles use native routing.

OMP removed the Pi prompt/skill/subagent/work-strip seams. Those features and `ask`/`task`/`todo`/`wait` stay OMP-native; port additional private seams only on explicit request.
