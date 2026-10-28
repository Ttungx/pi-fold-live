# Pi Fold implementation

Pi Fold changes transcript presentation. It does not replace tool executors, change permissions, rewrite recorded messages, or make model calls. See the [reference](renderer-reference.md) for display behavior and the [performance report](performance.md) for measured overhead.

## Entry point and lifecycle

`index.ts` creates one display mode and registers the tool, thinking, prompt, skill, workflow, permission, subagent, work-strip, and inspection modules. Registrations return cleanup functions. Disposal runs them in reverse order and clears the shared display cache.

Before loading a feature, Fold checks its required exports and prototype methods. It also checks session and viewport interfaces when they become available. Pi version numbers are diagnostic metadata, not enablement gates. Adapters retain their per-instance shape guards. Unsupported shapes retain native presentation. Mode changes, session switches, reloads, and shutdown release inspection focus and timers. Registration ownership prevents duplicate adapters after reload.

## Transcript projection

`src/work-strip.ts` projects native chat children during rendering and preserves the canonical child list. Native lifecycle hooks attach message identity and distinguish replay from live input. Live commentary stays indented until a terminal reply is confirmed. Only that final reply receives the neutral padded surface at the main margin.

`src/work-strip-subagents.ts` tracks prompt-owned root runs and descendants through read-only status events. Dispatch completion is not child completion. Unknown or omitted child status remains unresolved. `src/work-strip-view.ts` validates display-only completion entries against the current branch and owns each strip's disclosure state.

Completion requires a terminal assistant message with visible text and settled background work. Empty terminal responses do not promote earlier commentary to a final reply. Older turns without completion evidence show Work details without an invented duration. Manual expansion and scrollback take precedence over automatic folding.

Ctrl+Alt+W toggles eligible completed and historical sections together. If any is expanded, it collapses them; otherwise it expands them. Working and waiting sections stay unchanged. Explicit `/fold collapse` and `/fold expand` remain separate controls. Native shortcut dispatch preserves dialog and editor input ownership.

Native top-level spacers belong to the next canonical content block. Projection retains them with visible blocks and discards them with hidden blocks. Components that own internal spacing retain it. Expanded work children share an indentation level; final replies and user prompts share the main gutter.

## Bounded rendering

Tool panes retain original source and result references. Ordinary source formatting is bounded to 2,048 characters per call; codemode formats visited text in chunks of at most 1,024 characters. Painting advances through a bounded viewport instead of formatting all output. Long multiline syntax and Markdown structure can differ across chunk boundaries.

Codemode validates result shapes and computes scalar call/count/cost aggregates once per update revision. This pass is proportional to block and nested-call counts, separate from viewport painting. Repaint and unchanged invalidation reuse aggregates and row caches; width, theme, and result changes invalidate the affected views. Shared cache accounting and retention limits are described in the performance report.

Known errors, warnings, and truncation indicators remain visible. Exact arguments, acknowledgements, diagnostics, and raw output remain inspectable. Unsupported result shapes use native presentation. Image previews use native capability detection and show a text fallback when the terminal cannot display images.

## Input ownership

Only explicit inspection acquires keyboard focus. Escape or unhandled editing input releases inspection before forwarding to the native editor. Mouse expansion does not capture editor input. `/inspect` uses the native picker and reveals the selected block through the existing scroll view.

Permission presentation preserves the original decision and policy. Its Details view uses Left/Right paging because native fullscreen handling can intercept PageUp/PageDown before extension input. Ordinary transcript panes use their own advertised navigation keys.

## Compatibility identifiers

The package and public name are `@notrico/pi-fold` and Pi Fold. Existing `compact-renderer:*` event names, global symbols, and saved completion-entry identifiers remain stable. They are integration and persistence contracts, not display labels. Renaming them would disconnect companion extensions, lose saved display evidence, or prevent an older registration from being disposed during reload.

The `compact-renderer:work-strip:v1` and query events let a footer temporarily omit duplicate execution state and timing. Disposal releases ownership without changing saved footer preferences. The benchmark report schema and inspection widget keys also remain stable for existing consumers and cleanup.

## Verification

`tests/` exercises native components and isolated fixtures, including lifecycle changes, native fallback, input focus, mixed work states, spacing, ANSI surfaces, Unicode, narrow widths, images, and bounded large-output inspection. `scripts/preview-work-strip.mjs` runs an isolated native TUI with recorded examples and synthetic lifecycle playback. It does not run models, tools, shell commands, or network requests.

Automated checks do not replace terminal appearance review. Stage the packed candidate and review keyboard interaction, expansion, final replies, and editor restoration before publishing UI changes.
