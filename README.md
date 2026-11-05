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
pi install git:github.com/Ttungx/pi-fold-live@v1.1.1
pi remove git:github.com/Ttungx/pi-fold-live@v1.1.1
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
| Collapse / expand work sections | `/fold collapse` · `/fold expand` |
| Show native Pi rendering | `/fold off` |

`/fold follow` is session-local and starts **on**. With it off, every action renders as one row while it runs, which is the upstream display.

`/fold collapse` only touches completed work. The running action keeps following regardless.

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

On OMP, Pi Fold compacts the plain-text and diff built-ins (`read`, `bash`, `grep`, `glob`, `find`, `lsp`, `eval`, `web_search`, `edit`, `write`, `apply_patch`). Plain terminals show one action row and a fixed live window with the newest three output lines; settled actions become one row. Consecutive successful actions of the same tool fold into one `✓ N actions · <tool>` block. Failures and images stay separate. Native TSP terminals keep their tool bodies and per-card toggles, with borderless compact headers and a three-line tail preview while running. Ctrl+O and `/fold off` return OMP's stock cards and full diffs.

OMP settles that live window as soon as the result arrives; Pi's “keep the last action open until the next starts” follow behavior remains Pi-only. Terminals without native `tool`-node support keep their stock cards.

Thinking streams as one moving row showing the latest recorded line, then folds to a compact finished row. This works with either OMP thinking-visibility preference and does not change the stored reasoning or final reply. Native thinking sections retain their full body and expansion controls. Unfamiliar or image-containing plain-terminal layouts stay native rather than risk hiding reply content.

These adapters probe OMP's exported `toolRenderers` registry and native component interfaces before attaching. `/fold status` distinguishes active OMP adapters from unavailable Pi-only seams. Prompts, skills, subagents, work sections, and interactive cards such as `ask`, `task`, `todo`, and `wait` remain OMP-native.

Expansion depends on the terminal:

- **Native TSP:** use the tool header's native toggle. No extension-link or mouse-capture setting is needed for that routing.
- **Plain terminal:** each compact row has its own extension-link identity; selecting it opens only that action or same-tool group, and selecting its expanded header folds it again. OMP's Alt+O link hints require `extensionRenderers.assistantText: true` and work without mouse capture. Mouse clicks additionally require OMP's `tui.mouse: true`.

Pi Fold never changes `tui.mouse`, `extensionRenderers.assistantText`, or `hideThinkingBlock`. Mouse capture has a reported Shift+wheel conflict in Herdr; do not enable it just to try this plugin. Actual Herdr click/scroll acceptance remains pending; the component playback and CLI startup checks do not prove mouse delivery.

Automatic session-title language belongs to OMP, not this renderer. OMP 18.15 has no `title.language` setting, but it does discover a native `TITLE_SYSTEM.md` prompt override (project config first, then user config). Use that host facility for Chinese title instructions; Pi Fold does not generate titles or make extra model calls.

## Development

```sh
npm install
npm test
node scripts/ablation.mjs . A+both   # measure one build; see the script header for arms
node scripts/omp-rows-ablation.mjs   # full scan vs capped vs shipped OMP row renderer
bun scripts/omp-runtime-smoke.mjs /path/to/@oh-my-pi/pi-coding-agent
```

Runtime modules live in `src/`, regression checks in `tests/`, preview and benchmark runners in `scripts/`, and upstream's detailed notes in `docs/`. `index.ts` is the Pi entry point. `npm test` needs a local `node_modules` (the checks load Pi's own TUI and component classes).

## Upstream

This fork is `@notrico/pi-fold` 3.1.0 plus the changes listed at the top. Read the upstream [renderer reference](docs/renderer-reference.md) for the folding model; it applies unchanged apart from the final-reply surface and `/fold follow`.

[MIT license](LICENSE) · [Report an issue](https://github.com/Ttungx/pi-fold-live/issues)
