# Renderer performance pass

Evaluated against renderer 2.5.0, commit `848a4a5`, with Pi 1.3.0 and Node
26.11.1 on two macOS arm64 machines, labeled A and B below. No installed configuration was changed.

## Changes

- Track the latest work turn without allocating an array of all turns.
- Search turn rows backwards without copying and reversing them.
- Do not calculate summaries for completed/history headings, which do not display
  summaries. Continue calculating live, waiting, interrupted and error summaries.
- Cache repeated activity-line truncation and background formatting by exact
  input, width and styling bytes. A theme change in place therefore changes the
  key. Native Markdown, layout, image handling and mouse coordinates still run.
- Retain strings only. Limit the shared cache to 4,096 entries and 2 MiB of
  accounting charges, including input/output strings and an entry allowance.
  This is not a hard JavaScript heap limit. Oversized lines bypass the cache.
- The top-level extension owns cache cleanup at registration, session transitions
  and disposal. Work strips no longer manage this shared resource. Evicted text
  is reformatted when needed. Original transcript content is never removed.
- Reuse the shared `DisplayMode` interface in all eight display consumers instead
  of repeating its definition.

Production changes: 77 added lines and 27 removed lines, or 50 net new lines.
The cache is 26 lines. Tests and measurement scripts are counted separately.

## Layout results

Seven samples, eight warm redraws per sample, width 100. Values below are the
median batch duration divided by eight, in milliseconds per redraw. The latest
comparison uses a shared source-module graph, matching extension singleton
ownership. Both baseline and optimized source use the same measurement scripts.

| Host | Turns | Before | After | Compact disabled, after |
| --- | ---: | ---: | ---: | ---: |
| Machine A | 48 | 1.642 | 0.479 | 0.054 |
| Machine A | 400 | 12.649 | 4.904 | 0.301 |
| Machine B | 48 | 1.093 | 0.411 | 0.031 |
| Machine B | 400 | 9.514 | 3.295 | 0.207 |

At 400 turns, added median layout time is 4.603 ms on Machine A and 3.088 ms on Machine B.
Both meet the initial 5 ms target in this fixture. The largest of seven optimized
batch samples, divided by eight, was 5.294 ms on Machine A and 3.664 ms on Machine B. These
are batch measurements, not individual-frame latency percentiles.

## Retained memory

Five fixture samples per case, explicit GC, with an event-loop yield before
measuring disposal. Compare the same harness against baseline and optimized
source. Figures include native fixture components and renderer state.

| Host | Compact fixture | Before | After | Added |
| --- | --- | ---: | ---: | ---: |
| Machine A | 48 turns | 0.736 MiB | 0.757 MiB | 0.021 MiB |
| Machine A | 400 turns | 5.663 MiB | 5.806 MiB | 0.143 MiB |
| Machine B | 48 turns | 0.736 MiB | 0.757 MiB | 0.021 MiB |
| Machine B | 400 turns | 5.663 MiB | 5.805 MiB | 0.142 MiB |

A separate warmed formatting stress case retained approximately 2.16 MiB after
10,000 distinct lines and remained approximately 2.16 MiB after another 20,000.
After clearing the cache, the measured heap delta was under 10 KiB on both hosts.
This supports bounded retention for the tested case; it is not a general leak
proof or a guarantee about V8 memory accounting.

## Verification

All 26 regression suites pass on both hosts. Coverage includes streaming work
settlement, subagents, prompt/skill disclosure, keyboard focus, native reload,
spacing, neutral final surfaces, Unicode, ANSI resets and images.

The cache tests cover reuse, entry/byte limits, eviction, oversized bypass,
clearing, changing content, terminal widths, selection and in-place theme
changes. The root lifecycle test uses actual extension registration to verify
registration cleanup, session transitions, shutdown, stale callbacks and failed
startup. It also verifies reuse of the same shared cache between redraws. Synthetic transcript output hashes match baseline exactly for both
48- and 400-turn fixtures, with compact mode enabled and disabled.

Run:

```sh
npm test
node --expose-gc scripts/performance-review.mjs --samples 7 --scales 48,400
node --expose-gc scripts/retained-memory-review.mjs
```

For baseline comparison, use the measurement scripts in `renderer/` and the root `test-runtime.mjs` from tag `v2.5.2`. Copy those files into a separate checkout of `848a4a5`; that helper matches the baseline’s flat source layout. Keep baseline production sources unchanged. The commands above run the current layout.

## Limits and deferred work

These measurements cover synthetic synchronous component layout, not terminal
transport, emulator painting, live typing latency, model calls or tool execution.
The disabled comparison still has extension registration wrappers installed.
The timing fixture registers tools and work strips, not every renderer feature.
Automated image regressions pass, but image-heavy performance was not measured.
The memory case is not a long-running interactive-session soak test.

The full-history projection scan remains. Broad grouping changes, native
compatibility-layer consolidation, image-cache changes and input scheduling are
deferred: this pass meets the initial measured target without changing those
contracts or the UI design.

## Pre-integration cleanup decisions

Implemented the two changes with clear ownership benefits and low behavior risk:

1. The extension root owns shared cache lifecycle; individual display features
   no longer clear a resource used by other features.
2. Display consumers use the existing `DisplayMode` type. This adds no runtime
   behavior and keeps the contract in one place.

Deferred adapter unification and focus routing. Those changes require separate
checks for wrapper removal order, reload, keyboard routing and dialog ownership.
No measured result requires them in this patch.

Keep separate tool/code/recorded-text panes and distinct grouping rules: their
interaction and boundary rules differ. Keep the bounded cache, native fallbacks
and subagent monitor. Combining these solely to reduce file or line counts would
move complexity into conditionals rather than remove it.
