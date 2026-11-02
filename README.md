# Pi Fold Live

Follow the work, read what is running, keep the answer plain.

A fork of [`@notrico/pi-fold`](https://github.com/rrrrrrrrrricoxi/pi-fold) that keeps the upstream transcript folding and changes two things:

- **The newest action gets a small live window.** While a tool call runs, one heading plus the last three output lines stay on screen; new output scrolls inside that fixed window instead of inflating a panel. A finished action keeps its window and folds into the work group only when the next action starts. Click the window for the full output; Ctrl+O still expands everything.
- **Thinking is one row that keeps moving.** While the model is reasoning, the thinking row shows the newest recorded line and updates as the text streams. Consecutive segments do not fold and reopen; the row only folds when that thinking phase ends and the next action starts.
- **Final replies render exactly as Pi renders them.** No filled background, no added padding rows, no gutter change. Questions, decisions, and unresolved errors still stay visible when the work above them folds.

Everything else — the **Worked for …** strip, `/inspect`, thinking groups, codemode panes, subagent cards, prompt folding — is upstream behaviour.

## Install

Tested with **Pi 1.4.0** and **Node.js 22.19.0 or later**. This fork is distributed through git only; it is not published to npm.

```sh
pi install git:github.com/Ttungx/pi-fold-live
```

Pin a release with a tag, and remove it with the same pinned source:

```sh
pi install git:github.com/Ttungx/pi-fold-live@v1.0.0
pi remove git:github.com/Ttungx/pi-fold-live@v1.0.0
```

Restart Pi, or run `/reload` when the session and its background work are idle.

Install this **instead of** `@notrico/pi-fold`. Two transcript renderers in one session fight over the same rows.

## Everyday controls

| To… | Use… |
| --- | --- |
| Open the Pi Fold menu | `/fold` |
| Enable/disable folding | `/fold on` · `/fold off` · `/fold toggle` |
| Keep the running action open | `/fold follow on` · `/fold follow off` |
| Open a block | Click its arrow, or use `/inspect` |
| Return to typing | Esc |
| Toggle completed work sections | Ctrl+Alt+W |
| Collapse / expand work sections | `/fold collapse` · `/fold expand` |
| Show native Pi rendering | `/fold off` |

`/fold follow` is session-local and starts **on**. With it off, every action renders as one row while it runs, which is the upstream display.

Ctrl+Alt+W and `/fold collapse` only touch completed work. The running action keeps following regardless.

## Notes

- This changes the transcript's appearance. It preserves the original messages and does not reduce token usage or make extra model calls.
- A long live action shows its card viewport, not an unbounded dump: the pane stops at roughly one screen and scrolls inside itself. Scrolling the transcript still works.
- Image previews depend on your terminal. When images cannot display, you get a text fallback.
- Compact thinking groups need Pi's `hideThinkingBlock: true` setting.
- Upstream's Windows-only test failures were fixed, and the test suite now runs on Windows as well as macOS/Linux.

## OMP

[`omp`](https://github.com/can1357/oh-my-pi) 18.x loads this checkout through `package.json#omp.extensions`, and its Pi compatibility layer resolves the `@earendil-works/*` imports. Choose one install path.

Install from git; the plugin stays enabled across sessions:

```sh
omp plugin install github:Ttungx/pi-fold-live
omp plugin uninstall pi-fold-live   # remove
```

Link a local clone instead (development). Re-link after moving the checkout:

```sh
omp plugin link /path/to/pi-fold-live
```

Load it for one session without installing:

```sh
omp --extension /path/to/pi-fold-live
```

`--extension` accepts the package directory (OMP reads its manifest) or `index.ts` directly.

Configure it in a file instead — the user config applies to every session, a project `.omp/config.yml` only to sessions started in that checkout:

```yaml
# ~/.omp/agent/config.yml
extensions:
  - /path/to/pi-fold-live
```

On OMP, Pi Fold renders the plain-text and diff built-ins (`read`, `bash`, `grep`, `glob`, `find`, `lsp`, `eval`, `web_search`, `edit`, `write`, `apply_patch`) the way this fork does on Pi: one action row, and a fixed four-row live window showing the newest three output lines while the call runs. A settled action is one row with `✓` or `✗`; consecutive settled actions of the same tool fold into one `✓ N actions · <tool>` block. Ctrl+O and `/fold off` return OMP's native cards (including full diffs).

It uses OMP's exported name-keyed `toolRenderers` registry (`@oh-my-pi/pi-tui/tools`) — the only render-only hook OMP 18 exposes for built-ins — plus the component render pass for same-tool run folding. The rest stays OMP-native: `ask`, `task`, `todo`, `wait`, and the other interactive cards keep their own renderers, and OMP's native `Thought for 12s` / `Worked for 12s` folding is unchanged. `/fold status` lists the Pi-only interfaces OMP removed.

OMP hides the streaming reasoning body when `hideThinkingBlock: true` in its own config; only a live pulse remains. Set it to `false` to stream the CoT, which folds back to `Thought for 12s` when the thought ends. Pi Fold's compact one-line thinking row is a Pi renderer and is not available through OMP's extension API.

Clicking a compact row expands tool details, and clicking the expanded card's header folds them again. OMP routes those clicks through extension-owned links, so both settings must be on:

```yaml
tui:
  mouse: true
extensionRenderers:
  assistantText: true   # gates extension link schemes
```

`tui.mouse` also makes text selection Shift+drag and wheel scroll Shift+wheel. Ctrl+O remains the keyboard equivalent, and `/fold off` restores the untouched native transcript.

## Development

```sh
npm install
npm test
node scripts/ablation.mjs . A+both   # measure one build; see the script header for arms
node scripts/omp-rows-ablation.mjs   # full scan vs capped vs shipped OMP row renderer
```

Runtime modules live in `src/`, regression checks in `tests/`, preview and benchmark runners in `scripts/`, and upstream's detailed notes in `docs/`. `index.ts` is the Pi entry point. `npm test` needs a local `node_modules` (the checks load Pi's own TUI and component classes).

## Upstream

This fork is `@notrico/pi-fold` 3.1.0 plus the changes listed at the top. Read the upstream [renderer reference](docs/renderer-reference.md) for the folding model; it applies unchanged apart from the final-reply surface and `/fold follow`.

[MIT license](LICENSE) · [Report an issue](https://github.com/Ttungx/pi-fold-live/issues)
