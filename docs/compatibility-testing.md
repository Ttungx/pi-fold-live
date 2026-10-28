# Pi compatibility checks

The GitHub Actions workflow runs the native regression suite against Pi core 1.3.0, the oldest supported release, and the `latest` dist-tag resolved from npm at run time. Each matrix job installs Pi core, `pi-subagents` 0.79.2, `pi-prompt-jump` 0.1.0, and `pi-questions` into a fresh temporary directory. It verifies the installed core version, then sets `PI_RUNTIME` and `PI_INSTALL_ROOT` for the existing suite. It then starts the actual bundled CLI in an isolated RPC session and checks that `/fold` and `/inspect` register. No prompt is submitted. This keeps the selected core version explicit and prevents an unrelated peer dependency from silently choosing the test runtime.

The workflow runs on pushes, pull requests, manual dispatch, and weekly on Monday. It reads package metadata from the public npm registry. It does not publish packages, use credentials, call models, or invoke tools outside the test process. The regression suite uses local fixtures; no authentication or model configuration is needed. A failed install, version mismatch, or suite failure fails that matrix job.

Run one target locally with `node scripts/compatibility-check.mjs --pi oldest` or `--pi latest`. The runner needs Node.js 22.19.0 or newer, npm, and network access to npm. Each invocation removes its temporary runtime directory on exit.

## Runtime behavior

`/fold status` reports full, partial, or unavailable support and lists missing interfaces. Fold checks exports and prototype methods before loading each feature, then checks session and viewport interfaces when they attach. It keeps existing per-message shape checks. A different Pi version number alone never disables Fold.

Missing image adapters leave image-bearing tools native. Missing subagent message adapters disable cross-type grouping so tool results cannot become hidden followers of an unavailable group. Other supported features continue to work.

These checks reduce version coupling; they cannot prove that an unchanged method name still behaves the same. CI exercises real Pi behavior, but terminal appearance still needs visual review after UI changes. If Pi changes a private rendering contract, that adapter may still need an update. Public extension APIs are preferred; current thinking, work-strip, and overlay features still need guarded native interfaces.

Configuration validators can request the current report through `pi-fold:compatibility:v1` with `{ reply(report) {} }`. Fold replies synchronously with `{ version: 1, state, description }`. The report describes detected capability, not a promise about untested releases.
