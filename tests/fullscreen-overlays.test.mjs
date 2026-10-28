import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadAgent, loadSource, tui, tuiRoot } from './test-runtime.mjs';

const { installFullscreenOverlayGuard } = await loadSource('fullscreen-overlays.ts');
const { encodeKitty, registerKittyImageMetadata, isImageLine } = await import(
  pathToFileURL(path.join(tuiRoot, 'dist/terminal-image.js')).href
);
const deletion = '\x1b_Ga=d,d=a,q=2\x1b\\';
const { createInteractiveTuiReference } = await loadAgent('modes/interactive/tui-renderer.js');
let nextImageId = 742;

function fixture() {
  const output = [];
  const terminal = { columns: 40, rows: 12, write: text => output.push(text), hideCursor() {} };
  const screen = new tui.TuiAltScreen(terminal, false);
  screen.requestRender = () => {};
  screen.altScreenActive = true;
  screen.imageProtocol = 'kitty';
  const imageId = nextImageId++;
  registerKittyImageMetadata({ imageId, columns: 28, rows: 6, widthPx: 280, heightPx: 120 });
  const image = encodeKitty('c3ludGhldGlj', { columns: 28, rows: 6, imageId, moveCursor: false });
  const lines = ['first row', 'second row', image, '', '', '', '', '', 'last row', '', '', ''];
  screen.addChild({ render: () => lines, invalidate() {} });
  const paint = () => { output.length = 0; screen.doRender(); return output.join(''); };
  const open = () => screen.showOverlay({
    render: () => Array.from({ length: 6 }, () => `│${' '.repeat(18)}│`), invalidate() {},
  }, { width: 20, row: 2, col: 5 });
  return { screen, lines, paint, open };
}

// Reproduce the native failure: the anchor row bypasses text compositing, and
// the unchanged Kitty placement remains over subsequent overlay rows.
const stock = fixture();
stock.paint(); stock.open();
assert.ok(!stock.paint().includes(deletion), 'stock does not remove the unchanged image placement');
assert.ok(isImageLine(stock.screen.getScreenLines()[2]), 'stock retains the image anchor inside the overlay');
assert.ok(!stock.screen.getScreenLines()[2].includes('│'), 'stock loses the anchor-row border');

const guarded = fixture();
guarded.paint();
const original = guarded.screen.compositeOverlays;
const initialFrame = guarded.screen.getScreenLines();
const recordedLines = guarded.lines.slice();
const cleanup = installFullscreenOverlayGuard(guarded.screen);
assert.equal(typeof cleanup, 'function', 'the supported native runtime installs a disposable guard');
try {
  assert.ok(!guarded.paint().includes(deletion), 'no visible overlay leaves image placements intact');
  assert.deepEqual(guarded.screen.getScreenLines(), initialFrame, 'no overlay preserves the native frame');
  const unrelated = fixture(); unrelated.open(); unrelated.paint();
  assert.ok(isImageLine(unrelated.screen.getScreenLines()[2]), 'another terminal keeps its native image behavior');
  const overlay = guarded.open();
  const opened = guarded.paint();
  assert.ok(opened.includes(deletion), 'opening an overlay deletes existing Kitty placements');
  assert.ok(!guarded.screen.getScreenLines().some(isImageLine), 'overlay frame contains no underlying image anchors');
  for (const line of guarded.screen.getScreenLines().slice(2, 8)) {
    assert.equal((line.match(/│/g) || []).length, 2, 'both borders survive on every covered row');
  }
  assert.deepEqual(guarded.lines, recordedLines, 'suppression does not mutate the underlying image rows');

  overlay.setHidden(true);
  const hidden = guarded.paint();
  assert.match(hidden, /\x1b_Ga=p,q=2,/, 'hiding the last overlay restores the cached image placement');
  assert.doesNotMatch(hidden, /\x1b_Ga=T,/, 'restoring a hidden overlay does not upload the image again');
  assert.ok(guarded.screen.getScreenLines().some(isImageLine));
  overlay.setHidden(false);
  assert.ok(guarded.paint().includes(deletion), 'showing the overlay removes its underlying image again');
  overlay.hide();
  const closed = guarded.paint();
  assert.match(closed, /\x1b_Ga=p,q=2,/, 'closing the last overlay restores the cached image placement');
  assert.doesNotMatch(closed, /\x1b_Ga=T,/, 'closing does not upload image data again');
  assert.deepEqual(guarded.screen.getScreenLines(), initialFrame, 'closing restores the original native frame');

  cleanup(); cleanup();
  assert.equal(guarded.screen.compositeOverlays, original, 'cleanup restores native compositing');
  guarded.open(); guarded.paint();
  assert.ok(isImageLine(guarded.screen.getScreenLines()[2]), 'cleanup returns image handling to native behavior');
} finally { cleanup(); }

// Widget factories receive the stable native Proxy rather than the renderer.
// Its method reads return fresh forwarding functions, which must not prevent cleanup.
const proxied = fixture();
proxied.paint();
const proxyOriginal = proxied.screen.compositeOverlays;
const proxyCleanup = installFullscreenOverlayGuard(createInteractiveTuiReference(() => proxied.screen));
try {
  proxied.open();
  assert.ok(proxied.paint().includes(deletion), 'the real native forwarding Proxy installs the guard on its renderer');
  assert.ok(!proxied.screen.getScreenLines().some(isImageLine));
} finally { proxyCleanup(); }
assert.equal(proxied.screen.compositeOverlays, proxyOriginal, 'Proxy cleanup restores the actual renderer method');
proxied.paint();
assert.ok(proxied.screen.getScreenLines().some(isImageLine), 'Proxy cleanup restores native image handling');

for (const protocol of [null, 'iterm2']) {
  const fallback = fixture();
  fallback.screen.imageProtocol = protocol;
  const dispose = installFullscreenOverlayGuard(fallback.screen);
  try {
    fallback.open(); fallback.paint();
    assert.ok(isImageLine(fallback.screen.getScreenLines()[2]), 'other protocols preserve native compositing');
  } finally { dispose?.(); }
}
for (const overrides of [
  { mode: 'unknown' },
  { prepareKittyScreen: undefined }, { hasOverlay: undefined }, { compositeOverlays: undefined },
]) {
  const { screen } = fixture();
  Object.assign(screen, overrides);
  const before = screen.compositeOverlays;
  const dispose = installFullscreenOverlayGuard(screen);
  assert.equal(screen.compositeOverlays, before, 'unsupported native seams are unchanged');
  dispose?.();
}
const future = fixture().screen;
const futureOriginal = future.compositeOverlays;
const futureCleanup = installFullscreenOverlayGuard(future, 'future');
assert.notEqual(future.compositeOverlays, futureOriginal, 'compatible future runtimes use the same seam');
futureCleanup();
assert.equal(future.compositeOverlays, futureOriginal);

const switched = fixture();
const regular = new tui.TuiMainScreen(switched.screen.terminal, false);
regular.requestRender = () => {};
let active = regular;
const switchProxy = createInteractiveTuiReference(() => active);
const regularOriginal = regular.compositeOverlays;
const switchedOriginal = switched.screen.compositeOverlays;
const cleanupSwitch = installFullscreenOverlayGuard(switchProxy);
try {
  const row = ['  \x1b]133;A\x07retained source'];
  assert.equal(regular.compositeOverlays, regularOriginal, 'regular-mode native rendering is unchanged');
  assert.match(switchProxy.compositeOverlays(row, 40, 12)[0], /\x1b\]133;/);
  active = switched.screen;
  assert.doesNotMatch(switchProxy.compositeOverlays(row, 40, 12)[0], /\x1b\]133;/, 'switching to fullscreen activates the guard without a widget rebuild');
  active = regular;
  assert.match(switchProxy.compositeOverlays(row, 40, 12)[0], /\x1b\]133;/, 'switching back retains regular-mode prompt markers');
} finally { cleanupSwitch(); }
assert.equal(switched.screen.compositeOverlays, switchedOriginal, 'cleanup detaches even after switching back to regular mode');

// Fullscreen Pi strips zone markers only at column zero. Layout padding leaves
// A/B/C in actual terminal writes, where they can erase complete overlay rows.
const zones = fixture();
zones.screen.imageProtocol = null;
const zoneRows = [
  '  \x1b]133;A\x07',
  '  \x1b[32m\x1b]133;B\x07\x1b]133;C\x07answer\x1b[0m',
  '  \x1b]133;A\x1b\\padding',
  '  before\x1b]133;B\x1b\\\x1b]133;C\x1b\\after',
];
zones.lines.splice(2, 4, ...zoneRows);
const zonesOverlay = zones.open();
const stockZones = zones.paint();
assert.match(stockZones, /\x1b\]133;[ABC]/, 'padded zone markers survive stock fullscreen output');
const beforeZones = zones.lines.slice();
const clearZones = installFullscreenOverlayGuard(zones.screen);
try {
  assert.doesNotMatch(zones.paint(), /\x1b\]133;[ABC]/, 'terminal writes contain no padded prompt markers');
  assert.ok(zones.screen.getScreenLines().slice(2, 6).every(line => (line.match(/│/g) || []).length === 2), 'marker rows retain both overlay borders');
  assert.deepEqual(zones.lines, beforeZones, 'source rows and native prompt-navigation markers remain intact');
  zonesOverlay.hide();
  assert.doesNotMatch(zones.paint(), /\x1b\]133;[ABC]/, 'fullscreen output also removes markers with no overlay');
  const source = ['  \x1b]133;A\x07\x1b]8;;https://example.com\x07label\x1b]8;;\x07\x1b]133;D;0\x07'];
  const nativeRow = zones.screen.compositeOverlays(source, 40, 12)[0];
  assert.match(nativeRow, /\x1b\]8;;https:\/\/example.com\x07label/, 'hyperlink controls remain intact');
  assert.match(nativeRow, /\x1b\]133;D;0\x07/, 'only the native fullscreen A/B/C marker family is removed');
} finally { clearZones(); }
assert.match(zones.paint(), /\x1b\]133;[ABC]/, 'cleanup restores native marker handling');
console.log('Fullscreen overlays: image lifecycle, prompt zones, native Proxy cleanup and fallback passed');
