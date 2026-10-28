#!/usr/bin/env node
// Isolated recorded-content preview; no model or tool execution.
import { createWorkStripPreview } from './preview-work-strip.mjs';
const preview = await createWorkStripPreview({ inspection: true });
let ui;
try {
  ui = new preview.core.InteractiveMode(preview.runtime, { tuiMode: 'fullscreen' });
  await ui.run();
} finally { ui?.stop(); await preview.cleanup(); }
