# Pi compatibility checks

The GitHub Actions workflow runs the native regression suite against Pi core 1.3.0, the oldest supported release, and the `latest` dist-tag resolved from npm at run time. Each matrix job installs Pi core, `pi-subagents` 0.79.2, `pi-prompt-jump` 0.1.0, and `pi-questions` into a fresh temporary directory. It verifies the installed core version, then sets `PI_RUNTIME` and `PI_INSTALL_ROOT` for the existing suite. It then starts the actual bundled CLI in an isolated RPC session and checks that `/fold` and `/inspect` register. No prompt is submitted. This keeps the selected core version explicit and prevents an unrelated peer dependency from silently choosing the test runtime.

The workflow runs on pushes, pull requests, manual dispatch, and weekly on Monday. It reads package metadata from the public npm registry. It does not publish packages, use credentials, call models, or invoke tools outside the test process. The regression suite uses local fixtures; no authentication or model configuration is needed. A failed install, version mismatch, or suite failure fails that matrix job.

Run one target locally with `node scripts/compatibility-check.mjs --pi oldest` or `--pi latest`. The runner needs Node.js 22.19.0 or newer, npm, and network access to npm. Each invocation removes its temporary runtime directory on exit.

## Runtime behavior

`/fold status` reports full, partial, or unavailable support and lists missing interfaces. Fold checks exports and prototype methods before loading each feature, then checks session and viewport interfaces when they attach. It keeps existing per-message shape checks. A different Pi version number alone never disables Fold.

Missing image adapters leave image-bearing tools native. Missing subagent message adapters disable cross-type grouping so tool results cannot become hidden followers of an unavailable group. Other supported features continue to work.

These checks reduce version coupling; they cannot prove that an unchanged method name still behaves the same. CI exercises real Pi behavior, but terminal appearance still needs visual review after UI changes. If Pi changes a private rendering contract, that adapter may still need an update. Public extension APIs are preferred; current thinking, work-strip, and overlay features still need guarded native interfaces.

Configuration validators can request the current report through `pi-fold:compatibility:v1` with `{ reply(report) {} }`. Fold replies synchronously with `{ version: 1, state, description }`. The report describes detected capability, not a promise about untested releases.

## OMP

OMP 18.x loads the package through `package.json#omp.extensions`. The OMP adapters separately probe the exported renderer registry and component interfaces; they never enable the incompatible Pi-only adapters. `/fold status` lists active OMP tool/thinking adapters as well as missing Pi-only seams. The automatic startup compatibility notice is limited to Pi hosts: on OMP the Pi-only gaps are expected, so only `/fold status` reports them.

`src/omp-tool-rows.ts` covers ANSI compact rows and native TSP tool descriptions. Successful same-tool runs fold together; failures and images remain separate. Plain-terminal disclosure URLs identify a particular live component/group, and the click handler changes only those components. Native TSP keeps the original tool body and native toggle events. Ctrl+O and `/fold off` preserve stock rendering. `src/omp-thinking.ts` projects compact thinking without changing recorded messages or the user's visibility preference; native thinking bodies/toggles remain available. Unknown/image-containing ANSI thinking layouts stay native.

Native terminals without the `tool` vocabulary retain every stock fallback card and its individual toggle routing; they are not grouped through a partially supported projection.

Prompts, skills, subagent groups, work sections, inspection scrolling, overlay protection, and interactive `ask`, `task`, `todo`, and `wait` cards stay OMP-native.

Run the installed-runtime playback with Bun (OMP is not a new package dependency):

```sh
bun scripts/omp-runtime-smoke.mjs /path/to/@oh-my-pi/pi-coding-agent
```

It loads actual OMP classes through OMP's legacy extension loader, renders synthetic recorded results, activates row/group links, sends native TSP toggle events, checks streaming tails, and verifies native-off/disposal/reload and thinking/reply ordering. No tools or models execute. It was exercised against OMP 18.15.0. Pi's existing suites still run with `npm test`; the OMP thinking assertions are invoked by the Bun playback, not silently counted as a Pi suite.

The same runner also checks bundled-CLI startup in an isolated headless RPC process with `--no-extensions -e <checkout>`, mouse capture off, and assistant-text renderers off; both OMP adapters must register. Use explicit extension paths when testing: otherwise an installed old copy may load alongside the checkout.

A separate actual OMP 18.15 TUI playback resumed a synthetic session and showed a compact thinking row, two Bash calls folded into one action group, and an unchanged final reply. Ctrl+O opened both recorded outputs; `/fold off` restored stock rendering. This used a plain PTY, not Herdr.

These checks do not establish Herdr mouse delivery or Shift+wheel behavior. Native TSP uses its own toggles; plain-terminal links require `extensionRenderers.assistantText`, and mouse clicks also require `tui.mouse`. Pi Fold changes neither setting. Keep the reported Herdr wheel conflict as a terminal acceptance item, not a passing headless test.
