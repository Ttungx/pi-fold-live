#!/usr/bin/env node
// Recorded mixed action groups in an isolated Pi session. No tools or model run.
import { createWorkStripPreview } from './preview-work-strip.mjs';
const preview = await createWorkStripPreview({ actionGroups: true });
let ui;
try {
  ui = new preview.core.InteractiveMode(preview.runtime, { tuiMode: 'fullscreen' });
  await ui.run();
} finally { ui?.stop(); await preview.cleanup(); }
