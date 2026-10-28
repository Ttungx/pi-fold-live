# Pi Fold reference

Detailed display behavior, keyboard controls, integration notes, and development previews. For installation and a quick introduction, see the [README](../README.md).

## Git installation

As an alternative to npm:

```sh
pi install git:github.com/Ttungx/pi-fold-live
```

Remove it with the matching source:

```sh
pi remove git:github.com/Ttungx/pi-fold-live
```

## Display

- Questions use a bold purple heading, aligned with ordinary action headings, without a background or vertical rail. Recorded answers use a green checkmark inline with the options. Ordinary action headings stay blue. The `codemode` label uses native teal (`syntaxVariable`), while counts and timing stay muted; handled nested problems retain warning color; thinking headings stay muted and failures stay red. Expanded content remains unfilled. Keyboard focus has its own selection highlight. User prompts keep their blue surface. Subagent transcript activity uses the same compact headings and inspection controls.
- Running actions remain separate. Successful completed bash, file, and codemode calls can share one action group within visible conversation boundaries. Each outer codemode call counts as one action; nested calls stay inside its inspectable content. Nested errors, cancellations, unresolved calls, images, and unsupported codemode records stay separate. Pure thinking does not split an action group; visible assistant replies and user messages do.
- Successful group headings use “4 actions”; singleton headings show only the operation. Shell interpreter scripts use labels such as “Run Node.js script,” with a literal script filename when reliably available. Inline source stays in Arguments. Known errors show a short category such as “Path too long”; exact errors stay in Output/Details. Labels describe recorded operations and do not infer a script’s purpose.
- Expanded source and diffs use Pi’s syntax colors. Recorded thinking and Markdown files use bounded Markdown rendering; shell stdout and unknown text remain literal. Formatting reads at most 2,048 source characters per block. Markdown uses one source line per block, so multiline tables, paragraphs, and cross-line inline formatting are not fully reconstructed. Very long code blocks can lose lexer context at block boundaries. The original recorded source remains unchanged.
- A single-action card opens directly to useful content without repeating a numbered action row. Successful native `write` actions show submitted content with syntax colors from the path. Only the exact standard acknowledgement is moved under Details. Reads and unknown tools keep their output visible. Known ordinary-tool OS diagnostics can show a short code/category while Details retains the exact error; unknown/custom failures keep full visible output. Status marks follow the title.
- Open a group to see tightly stacked actions without blank rows between siblings. Several actions and their inline Details can remain expanded independently in the same scrollable pane. Details contains exact arguments, secondary diagnostics, and any acknowledgement/error moved from the main content. Short scalar fields share a line; null and empty values remain explicit. Empty diagnostic objects do not add a section.
- Errors, cancellations, unanswered questions, and background notices stay separate. Expanded question cards show the full question, nonempty context, and tight option rows with descriptions inline. A checkmark, native success color, and bold text mark recorded selections; custom or unmatched answers remain visible on their own marked row. Only answered records receive answer marks. Other states appear once in the header, with meaningful diagnostics retained; the exact standard cancellation message is omitted. Question cards omit duplicate headings and raw Arguments/Details objects; stored transcripts retain the original data.
- Consecutive completed subagent guide lookups form a separate guide group, with each requested topic shown on expansion. Consecutive routine subagent calls and recognized asynchronous notices form one compact update group. Failures and pending decisions stay separate. A decision request, successful supervisor reply, and acknowledgement combine only when their explicit request identity matches within the same uninterrupted exchange. Expansion shows the question and highlights the supervisor reply; this is not attributed to the user. Visible assistant replies, user messages, unrelated decisions, errors, and other actions stop grouping. Launch acknowledgements, queued steering, decision requests, replies, and completion notices retain their recorded meanings. Decision requests use purple headings; failures use red headings. Expansion shows recorded content first; Details retains exact arguments and identifiers. Unknown notification shapes and compact mode off retain native rendering. Fleet, execution, scheduling, and steering controls remain native. A standalone codemode call has its own collapsible card. In a mixed action group, expand its action row to inspect the same recorded content. Its expanded body uses bounded chunks with native JavaScript colors, nested-call status colors, durations, and model cost in USD. Source, recorded call arguments/errors, output, and metadata remain scroll-accessible. Long multiline code can have different syntax colors across chunk boundaries. Shape validation and scalar call/count/cost aggregation run once per explicit update revision; they are separate from bounded viewport painting. Valid image results retain the compact codemode summary and bounded text inspection, with image counts. Image previews appear only when the compact block is expanded, using Pi's native image objects and terminal capability checks. See Inline images below. Unsupported shapes and compact mode off retain the stock native renderer. Standalone image reads stay separate and use one compact heading.
- Recorded thinking rounds can group across tools. Replies, questions, errors, and other visible boundaries separate groups. Each round has a short title taken from its recorded heading or first sentence and expands independently. The pane shows the full recorded text on demand; it does not generate summaries or make model calls.
- Recognized prompt templates show their command and authored description, or a bounded excerpt when no description is available. Expansion reveals the original text inline. Ordinary submitted prompts longer than eight rendered lines show a bounded opening and ending, separated by a muted “⋯ Show more” control. The opening stops at its first paragraph break; the ending uses the last paragraph. Long paragraphs use bounded excerpts. A blank row separates each excerpt from the control. Expansion preserves all recorded text and formatting and places “▴ Show less” at the bottom; short prompts stay open. Skill invocations share the blue prompt card, with click, `/inspect`, and native Ctrl+O expansion.

Thinking groups require Pi's native `hideThinkingBlock: true` preference. **Ctrl+T** still switches to Pi's full thinking display. Unsupported Pi versions or component shapes show native content instead of hiding it.

Completed action groups and `codemode` show short operation summaries derived from recorded tool names and bounded arguments. These phrases describe supported operations, such as reading files or checking Git changes; they do not infer an unrecorded business goal. Unknown scripts retain a generic label. No extra model call is made. Expanded codemode starts with its source instead of repeating the outer title.

Complete assistant `js workflow` or `javascript workflow` fences collapse into a separate **Subagent workflow** row. Surrounding prose remains visible. `/inspect` or a header click opens bounded, syntax-highlighted source; Esc or typing returns to the editor. This changes display only: the subagent runtime still receives the exact original assistant message. Unsupported or incomplete shapes retain native display.

## Work strips

A user prompt gets a work strip only when it has tool or subagent activity. Text-only and thinking-only turns have no strip. During execution, intermediate replies and compact actions remain visible in the same work gutter. The newest reply keeps this indentation until the turn and its owned background work settle; only a confirmed final reply returns to the main margin. The strip shows elapsed time and a short current-step label extracted from recorded prose or operations. After native settlement and completion of that prompt's background descendants, it folds to **Worked for …** and leaves the terminal assistant reply visible. It makes no model calls and does not infer completion from reply wording.

Questions, recorded answers, supervisor decisions, unresolved errors, and unknown notices remain visible when the section is folded. Routine DDD notices can fold only when their producer explicitly marks them `severity: notice`; current DDD records without severity remain separate compact rows. Expand a DDD row to read its recorded text. Thinking and DDD content follow their headers with the same compact spacing as tools. A complete opening title or summary line is omitted from the compact body only when it exactly repeats the full visible summary and other content remains. Recorded paragraph spacing stays intact; native mode retains the original text.

Click a strip or select Work in `/inspect` to expand its chronological contents. Work steps, questions, decisions, errors, subagent updates, and DDD notices are indented beneath the strip. Attention rows retain this indentation when the strip is collapsed; final replies stay at the transcript margin. Routine headings use quiet metadata so model replies remain easy to scan. Nested inspection opens the owning strip first. Manual expansion stays open. Automatic folding waits while you are in scrollback and resumes when you return to the latest output. Interrupted or incomplete turns stay open. Native Ctrl+T and compact-off controls remain available.

Settled final replies keep Pi's own rendering, including direct answers with no work strip: no filled surface, no added padding rows, and no gutter change. Native Markdown, paragraph spacing, graphics, and the outside block gap are byte-identical to compact-off. The strip still owns the row so it can fold the reply's leading thinking and so other renderers do not re-wrap it.

Explicit skill invocations use one blue prompt card. A muted, expandable `/skill:name` heading comes first, followed by the optional user message. Expanding reveals the recorded skill text; the prompt remains a user input boundary, including skill-only submissions. Model-initiated reads of skill files remain ordinary work activity. Compact-off restores Pi's separate native skill and prompt cards.

Completion is saved as a display-only custom entry, separate from original messages and model context. Resume and reload restore validated completion records. Older turns without this evidence remain open under **Work details**, with no invented duration. Unsupported runtimes retain native rendering.

While an action is still running, it keeps a card of its own so its output is readable as it arrives: the newest running tool call or thinking round is expanded, and the action it replaced folds back to one row. A finished action folds into the work group. This is the session-local **follow** display, on by default; `/fold follow off` restores one row per action while it runs. A manual open, a header click, or Pi's Ctrl+O expansion outranks follow for that action. Follow respects compact-off and the compatibility fallbacks, and changes no message, result, or transcript entry.

Run `/fold collapse` to collapse completed and historical work sections. Ctrl+Alt+W toggles these sections: if any section or retained nested pane is expanded, collapse them all; otherwise expand them all. Explicit collapse also closes nested actions, Details, thinking, codemode, workflows, and subagent/DDD attention panes, and resets their scroll positions. Reopening a work section starts with nested panes closed. Automatic folding preserves manual pane expansion. Active and waiting work stays unchanged by the shortcut. `/fold expand` opens all sections. `/fold shortcut off` disables the session shortcut; `/fold` opens these choices.

When the current turn has a supported work strip, Pi Statusline can omit duplicate execution state and elapsed time through the `compact-renderer:work-strip:v1` event. Its Execution display preference supports Automatic (follow strip ownership), Show (honor enabled execution fields even with a strip), and Hide (omit both state and elapsed time). Other footer fields and native Fleet controls remain unchanged. Compact-off and renderer disposal release this temporary ownership without changing saved preferences.

### Work-strip preview

Run `PI_RUNTIME=/path/to/runtime node scripts/preview-work-strip.mjs`. Optionally set `PI_PREVIEW_STATUSLINE=/path/to/pi-statusline/index.ts` to include the matching footer. `/fixture-work` plays ten seconds of invented progress through native display events; no model or tool executes. Check automatic folding, manual expansion, scrollback, `/inspect`, prompt navigation, and normal typing after Esc.

## Controls

`/fold` opens the Pi Fold menu for display mode, collapse/expand, follow, and shortcut settings. Typed `on`, `off`, `toggle`, `status`, `collapse`, `expand`, `follow on|off`, and `shortcut on|off` are available. Version 3 removes the old `/compact-rendering` and `/work` commands without aliases. This display mode is session-local and starts enabled.

`/inspect` opens a native picker for tool groups, subagent notices, thinking groups, and prompt cards. Selection brings the block into view, highlights its header and selected item, and shows an inspection status in the footer.

| Surface | Controls after selection |
| --- | --- |
| Tool groups | For a single action, Enter opens/closes the card. For groups, Left/Right selects an action and Enter opens/closes its content. Tab or Shift+Tab switches between the selected action and its Details; Enter toggles that target. Up/Down scroll; Home returns to the first action. |
| Thinking | Left/Right selects a round; Enter opens/closes its recorded text; Up/Down scroll; Home returns to the first round. Ctrl+T retains native visibility control. |
| Prompt cards | Enter opens/closes the original text. |
| Permission | Up/Down chooses Allow once, Deny, or Details; Enter selects; `d` toggles Details; Esc denies. Deny is selected initially. With Details open, Left/Right pages and Home/End jumps. |

Esc returns to the editor. Typing, pasting, or using an editor key also releases inspection; the next Enter submits normally. Clicking or scrolling a card changes its display without taking keyboard focus. Compact activity keeps a one-cell gutter without top/bottom padding; only keyboard selections receive a background. Expanded ordinary actions show useful content with exact arguments and secondary data under inline Details; questions use readable history only; unfocused cards omit repeated control/count footers.

Alt+G, Alt+T, and Alt+I remain optional shortcuts for tools, thinking, and prompts when the terminal sends Alt key sequences. On macOS, Option may instead type characters. Those characters remain ordinary input; use `/inspect` without changing terminal settings.

Mouse controls support tool and thinking headers, individual action and Details expansion, wheel scrolling inside open panes, and prompt headers. Short content stays above Details. For long content, Details inspection uses a bounded viewport anchor with “content above ↑”; Up, scrolling upward at that anchor, or Home returns to content. Escape or typing releases keyboard inspection and restores the content view. Tab remains native in the editor. Terminal mouse support depends on the terminal and transport. Keyboard controls remain available over mosh/tmux. Detailed keyboard hints appear on the focused pane. Arrows are captured only while a pane has focus. In fullscreen Pi, PageUp/PageDown scroll the transcript before extension controls receive them; use the arrows shown above for pane content. Opening a native question or approval releases transcript focus.

## Permission presentation seam

A caller that already decided approval is required may emit `pi:permission-presentation:v1` with `{version:1, mode:'tui', action, target, reason, details, ui, signal?, offer}`. The first synchronous `offer(() => Promise<boolean>)` wins. The caller invokes that presenter once; absent presenters use the caller's native fallback. A claimed dialog failure or cancellation denies without opening a second prompt.

The renderer presents the caller's action, target, reason, and exact Details. Large fields have explicit shortened summaries and lazy Details navigation. Policies stay in the safety/MCP callers. Print/RPC and incompatible UI contexts keep the caller's fallback. Ordinary read approvals are not added here.

## Verification and preview

Use Node and a Pi 1.3.0 runtime:

```sh
PI_RUNTIME=/path/to/runtime npm test
PI_RUNTIME=/path/to/runtime node scripts/preview.mjs
```

The runtime directory contains `node_modules/@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui`. The default is `~/.local/state/pi-config/current/runtime`. Tests use actual native components and isolated fixtures. Coverage includes repeated synchronous redraw, separate native component caches, shell timer cleanup, status transitions, lifecycle changes, stock subagent rendering, Unicode, narrow widths, and bounded work on large outputs. No model or database calls are needed.

The preview runs the actual Pi TUI with invented recorded messages in a temporary home. It blocks model, shell, tool, and network requests. The fixture begins with two writes, two reads, and a separate missing-file error. It also includes a long ordinary Bash/Node script singleton, a separate long-path failure, and four grouped source/diff/Markdown/script actions. codemode uses bounded native-style JavaScript highlighting, nested calls, timing, and cost display; every recorded call and price is synthetic. Ctrl+O expands codemode and skill disclosures. `/fixture-permission` opens an inert approval example. `/fixture-question` opens the installed pi-questions choice UI; `/fixture-question text` opens its free-text UI. Answers perform no operation. The question UI uses the current Pi Config package by default; set `PI_QUESTIONS_PATH=/path/to/pi-questions/index.ts` to use another source. If unavailable, the preview reports that limit and still shows recorded question cards.

The final preview examples include a codemode result with three synthetic PNGs and a long JSON output, plus a separate image read. The preview enables native images and uses a visible 640×320 cyan/purple/green test chart. It creates one image in its temporary fixture directory so the fallback path is real; cleanup removes it. No recorded tool or script executes. Check expanded images in an image-capable terminal and the text fallback over mosh/tmux, then collapse and verify normal typing after Esc.

The preview does not load host credentials or change active Pi deployments. Use Ctrl+D to exit. Set `PI_PROMPT_JUMP_PATH=/path/to/pi-prompt-jump` to include the separate navigation package and inspect its behavior with the three invented user prompts.

The adapters for thinking, prompt component identity, viewport positioning, and native shell timers are isolated and gated to Pi 1.3.0. Future versions require review; passing these tests does not certify a different runtime or every terminal. Legacy 1.x implementation and development history remain in Git rather than as a second shipped renderer.

## Inline images

In compact mode, expanding an image read or image-bearing codemode reveals the recorded images below the text pane. Collapsing the block hides them again. Images and fallback text align with the expanded content and Details column. Standard image-read acknowledgements and MIME metadata remain in Details; the main view does not repeat them. Each preview uses Pi's native image component, keeps its aspect ratio, and is limited to 60 columns and 12 rows (or half the terminal height, if smaller). Several images can therefore add more than one preview's height. The text pane remains independently bounded.

The renderer respects Pi's show-images setting and terminal capability detection. Pi 1.3.0 supports Kitty images in compatible terminals and disables image protocols under tmux. On that route, or when images are disabled, the expanded block shows a short fallback. A direct image read retains its recorded path; Pi makes absolute paths clickable only when native hyperlink support is available. Remote paths still refer to the remote host. codemode does not invent a file path for an in-memory image.

Compact mode off preserves native image display and sizing. The image adapter is gated to Pi 1.3.0 and restores the native component's options after each compact paint. It does not alter image data, terminal settings, tmux settings, or saved transcripts.

In Pi 1.3.0 fullscreen mode, visible overlays temporarily hide inline Kitty images. This works around native image placements covering overlay text and breaking borders. Images return from the native cache when the last overlay closes or hides. The compatibility fix also runs with `/fold off`; it preserves image row heights and does not change image settings or overlay packages such as BTW. Other runtimes and image protocols retain native behavior.

The fullscreen adapter also removes shell prompt-zone markers (`OSC 133 A/B/C`) from display rows after layout padding. Pi's native cleanup misses these padded markers, which can make the terminal hide overlay text and border rows. Source rows and prompt-navigation metadata retain their markers. Regular terminal mode and other Pi versions keep native behavior.

To inspect mixed bash/codemode groups in the isolated fixture, run `node scripts/preview-actions.mjs`. The final work section includes both bash-led and codemode-led groups and a separate nested-error card. No tools or model run.
