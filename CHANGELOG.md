# Release notes

## pi-fold-live 1.0.0 — fork of @notrico/pi-fold 3.1.0

- Final replies render natively: no `toolPendingBg` fill, no added padding rows, no gutter change. The work strip still projects the reply row and still folds its leading thinking.
- New `/fold follow on|off` (default on). A tool call that is still running keeps its own card open, the action it replaced folds back to one row, and a finished action folds into the work group. A manual open, a header click, or Pi's Ctrl+O expansion outranks it.
- Follow shows thinking as one row whose label streams the newest recorded line. A thinking phase no longer folds and reopens between segments; it folds only when the next action starts.
- Fix the two upstream checks that only passed on POSIX hosts, so `npm test` runs on Windows too.

Everything below is the upstream changelog, unchanged.


## 3.1.0

- Enable features by available Pi interfaces instead of an exact version list.
- Report full, partial, or unavailable support through `/fold status`; preserve native rendering when an adapter is unavailable.
- Keep tool results visible when subagent grouping or image adapters are unavailable.
- Check Pi 1.3.0 and the latest stable release in CI, including actual CLI extension startup.

## 3.0.5 — Pi 1.4 compatibility

- Enable the verified renderer adapters on Pi 1.4.0. Retain Pi 1.3.0 support and checks for unfamiliar component layouts.
- Report unsupported Pi versions at startup and in `/fold` instead of showing “on” while native rendering remains active.
- Run the native preview against the selected core package, including installations separate from the extension dependency snapshot.

## 3.0.4 — Fullscreen overlays

- Temporarily hide inline Kitty images while an overlay is visible in Pi 1.3.0 fullscreen mode. This keeps panel borders and text readable. Restore the images when the last overlay closes or hides, including with folding off.
- Remove padded shell prompt markers from fullscreen display output so they cannot erase overlay rows. Preserve the original transcript and prompt-navigation metadata.

## 3.0.3 — Approval layout

- Match approval dialogs to the quieter prompt layout: add spacing around the content and choices, mute keyboard hints, and fill only the selected choice. Keep approval decisions and Details controls unchanged.

## 3.0.2 — Mixed action groups

- Group successful completed codemode calls with adjacent bash and file actions. Count each outer call once and retain nested source, calls, and output on expansion.
- Keep running calls, failures, nested warnings, images, and unsupported records separate. Preserve visible conversation boundaries and native display when folding is disabled.

## 3.0.1 — Inspection paging and final thinking

- Make `more ↓` advance expanded tool, codemode, workflow, and thinking panes by one visible page. Preserve prompt typing after mouse inspection.
- Keep the overflow footer in place at the end as `more ↑`, so upward scrolling stays inside the pane. Clicking it pages backward.
- Keep leading thinking on a final answer with the preceding thinking rounds. Preserve visible-reply, error, and question boundaries.
- Preserve compact thinking while painting the final answer background and padding.

## 3.0.0 — Pi Fold

- Rename the public interface to Pi Fold and combine display mode, collapse/expand, and shortcut controls under `/fold`.
- Remove `/compact-rendering` and `/work` without aliases. Use `/fold on|off|toggle|status`, `/fold collapse|expand`, and `/fold shortcut on|off`. `/inspect` and Ctrl+Alt+W remain available.
- Rename the npm package to `@notrico/pi-fold` and the repository to `pi-fold`. Remove the old package installation before installing the new name.
- Make Ctrl+Alt+W toggle completed work: collapse if any section is expanded, otherwise expand. Active and waiting sections stay unchanged.
- Refresh public documentation and remove private deployment history.
- Keep thinking, DDD, and tool expansion equally compact. Omit an exactly repeated opening title only when the full summary remains visible; preserve source text and paragraph spacing.
- Explicit collapse resets nested actions, Details, thinking, workflows, codemode, and retained attention panes in completed or historical work. Automatic folding preserves manual pane state.

## 2.5.3 — Stable live alignment and clearer source layout

- Keep live work commentary indented until the turn settles; place confirmed final replies at the main margin.
- Separate runtime modules, tests, scripts, and documentation. Keep the root Pi entry point and update preview, benchmark, and package paths.

## 2.5.2 — Less work on redraw

- Cache repeated formatted lines within entry and accounting limits; clear the shared cache at extension lifecycle boundaries.
- Avoid repeated completed-work summaries and temporary arrays during redraw. Share the display-mode contract across renderers.
- Keep the concise README and add measured layout overhead. Include the performance report and reproduction scripts in the package.
- Preserve the existing UI behavior; the live-commentary alignment change remains separate.

## 2.5.1 — Public npm package

- Add npm publication metadata and the Pi gallery discovery keyword.
- Document standalone Git installation, removal, compatibility, and quick controls.
- Keep renderer behavior identical to 2.5.0.

## 2.5.0 — Clearer conversation hierarchy

- Keep work children indented, including visible questions, decisions, failures and DDD notices. Use quieter routine headings and collapse-all controls.
- Omit work strips for replies without execution activity. Preserve elapsed labels where recorded and use Work details when duration is unavailable.
- Give settled final replies a faint neutral surface with the same vertical padding as user prompts. Preserve native content and consistent outer spacing.
- Collapse long prompts around their original opening and ending. Combine explicit skill invocation and optional user text into one blue prompt card with inspectable skill content.
- Preserve native fallback, prompt-jump anchors, editor controls, images, reload and resume. All 24 suites passed on both test machines; the user approved both terminal previews.

## 2.4.0 — Work strips

- Keep intermediate replies and compact activity visible during execution, then fold completed work under one elapsed-time strip while retaining the final reply and decision evidence.
- Derive the live step from recorded content. Wait for native settlement and the prompt's background descendants; preserve manual expansion and defer automatic folding in scrollback.
- Compact DDD notices with full inspection and conservative handling of missing severity. Retain chronological expansion, nested inspection, native-off behavior, and editor controls.
- Preserve native outside spacing with each visible block, including skill cards and summaries. Drop gaps with hidden blocks and retain internal card spacing without adding duplicate gaps.
- Store validated display-only completion records for resume/reload. Older turns without records remain open. Coordinate execution status with Pi Statusline without changing saved footer preferences.
- Add isolated native-runtime playback and regressions for settlement, descendants, replay, decisions, focus, and scrollback. All 20 suites passed on both test machines. The user approved both terminal previews on 20 October 2026.

## 2.3.3 — Single-round thinking summaries

- Give a single recorded thinking round a short extractive summary and an aligned disclosure arrow. Expand directly into bounded content without a second round heading.
- Compact one hidden thinking run beside a visible reply while preserving native reply rendering, ordering, and terminal markers. Keep native fallback for unsupported layouts, failures, and expansion overrides.
- Track shared streaming content changes and retain grouping boundaries, mouse controls, editor focus, and lifecycle cleanup. All 16 suites passed on both test machines; the user approved both terminal previews.

## 2.3.2 — Preserve compact history after reload

- Keep historical tool rows attached when Pi rebuilds chat before the new renderer receives session start. Restore compact Bash, MCP, and codemode history after `/reload`.
- Reconnect replayed rows after rebuilding groups. Retain stale-row protection for session switches and shutdown.
- Add a regression using native chat replay and tool components, with synthetic records and no tool execution.

## 2.3.1 — Expand inline images

- Keep image-bearing codemode results in the compact summary and bounded text pane, with image counts and metadata. Preserve Pi's native image components and recorded content.
- Remove the duplicate heading on standalone image reads. Preserve separate image actions and native rendering when compact mode is off.
- Show native inline images only in expanded compact blocks, with bounded preview dimensions and a readable fallback when native images are disabled or unavailable. Preserve exact native rendering when compact mode is off.
- Remove repeated image announcements, question/answer headings, and codemode timing. Keep exact image acknowledgements and metadata in Details.
- Add native-component regression cases and visible synthetic image examples for terminal review.

## 2.3.0 — Workflow folding and operation summaries

- Collapse complete assistant workflow fences without changing their execution source or surrounding prose. Expand through the existing inspection controls.
- Add short recorded-operation summaries to ordinary action groups and codemode; retain counts, error states, exact arguments, and output. No model calls are added.
- Remove the duplicate codemode heading from expanded content.

## 2.2.1 — Guide lookup grouping

- Collapse consecutive completed subagent guide calls into one guide-lookup group. Keep runtime updates in their own groups and preserve failures, running calls, and visible conversation boundaries.
- Show the requested guide topic in each expandable action instead of the generic Result recorded label. Exact content and arguments remain available.

## 2.2.0 — Grouped subagent history

- Group consecutive routine subagent updates and combine explicitly matched decision exchanges; keep failures and pending decisions separate. Use compact expandable rows for subagent calls and recognized asynchronous notices. Keep native Fleet and execution controls.
- Distinguish launch acknowledgements, queued steering, delivery, decisions, replies, and completion. Preserve exact recorded content and Details.
- Add native fallback, replay, lifecycle, focus, and bounded-output checks plus inert preview examples.

## 2.1.2 — Distinct codemode labels

- Use native teal for the `codemode` label, with muted nested-call counts and timing. Keep ordinary action headings blue.
- Keep failed scripts red and handled nested problems in warning color. Preserve expansion, focus, native syntax colors, and exact records.
- Retain factual count-based summaries when the recorded call has no intention metadata. No extra model calls or inferred script descriptions.

## 2.1.1 — Clear question history and output categories

- Highlight recorded answers inline with their options and tighten question spacing. Preserve custom answers and meaningful diagnostics without duplicate Answer sections.
- Use bold purple question headings aligned with other actions, without a background or vertical rail. Keep green selected answers, blue ordinary action/`codemode` headings, muted thinking, and red failures.
- Preserve distinct keyboard focus, native subagent/Fleet rendering, exact transcripts, bounded inspection, and existing controls.
- Use Pi's `codemode` spelling in current documentation and preview text.

## 2.1.0 — Content-first inspection and bounded code mode

- Show useful action content first, keep exact arguments under independently expandable Details, and remove gaps between sibling actions. Preserve readable question history.
- Render supported code-mode scripts, nested calls, errors, output, timing, and costs incrementally as the user scrolls. Retain all recorded content and metadata.
- Preserve editor return, native-off display, and fallback for unsupported result shapes. Handle streaming updates, theme changes, and timer cleanup.
- Aggregate result blocks/calls once per update; cache visited rows. Long multiline syntax colors can differ at chunk boundaries.
- Verify the combined preview in a local terminal and over mosh/tmux before publication.

## 2.0.1 — Readable inspection and concise summaries

- Show compact operation labels for embedded scripts and short failure categories. Keep exact commands and errors in expanded details.
- Label groups as `N actions` and omit redundant success labels, including code mode.
- Restore native syntax colors for expanded source, commands, and diffs. Format Markdown files and recorded thinking while keeping shell output literal.
- Keep formatting work bounded to visited content and preserve transcript data, focus controls, and separate native code-mode inspection.

## 2.0.0 — Compact activity for Pi 1.3.0

- Group consecutive successful completed calls behind neutral one-line summaries. Running calls, failures, questions, and background notices remain separate.
- Expand individual actions inline with bounded scrolling. Single actions open directly to their output; questions retain readable question, choices, answer, and status without raw object dumps.
- Give code mode a separate collapsible summary with script outcome and nested-call status. Preserve native highlighted code, results, timing, and cost inside the expanded viewport.
- Group recorded thinking into independently expandable rounds. Collapse recognized prompt templates with descriptions or excerpts; retain the original text on expansion.
- Add `/inspect` with a native picker, visible focus, and viewport reveal. Typing or Escape returns control to the editor; mouse expansion does not capture prompt submission. Keep `/compact-rendering` and retire legacy `/blocks`.
- Preserve stock pi-subagents/Fleet UI, native images, stored messages, model inputs, and execution policy.
- Add a permission presentation interface with concise summaries, exact lazy Details, and a single approval decision. Caller approval policies remain unchanged.
- Fix synchronous redraw loops, native component cache reuse, shell timer cleanup, and misleading completion labels.
- Replace Pi 1.1 adapters with guarded Pi 1.3 integration, native regression suites, and an isolated preview with no model, shell, or database execution.

Expanded code-mode content uses native formatting internally; its visible viewport is bounded. Native compatibility guards fall back to stock display on unsupported shapes.

## 1.19.3

Previous Pi 1.1 implementation. Its source and release history remain available in Git.
