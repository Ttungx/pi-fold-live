import * as core from '@earendil-works/pi-coding-agent';
import * as nativeTui from '@earendil-works/pi-tui';
const { TuiAltScreen } = nativeTui;
import { chainNativeMethod } from './native-method-chain.ts';

const promptZones = /\x1b\]133;[ABC](?:\x07|\x1b\\)/g;

/** Pi 1.3 fullscreen output retains prompt markers after layout padding and
 * skips overlay composition on image anchors. Strip display-only zone markers;
 * suppress Kitty anchors while an overlay is visible so native placement cleanup
 * and restoration work. Keep source rows, layout metadata, and settings intact.
 */
export function supportsOverlayHost(tui: any): boolean {
  if (!['regular', 'fullscreen'].includes(tui?.mode) || typeof tui.compositeOverlays !== 'function'
    || typeof tui.hasOverlay !== 'function' || !tui.terminal) return false;
  if (tui.mode === 'fullscreen' && typeof tui.prepareKittyScreen !== 'function') return false;
  const proto = tui.mode === 'regular' ? TuiAltScreen?.prototype : Object.getPrototypeOf(tui);
  return typeof proto?.compositeOverlays === 'function' && typeof proto?.prepareKittyScreen === 'function';
}
export function installFullscreenOverlayGuard(tui: any, version = core.VERSION): () => void {
  if (!supportsOverlayHost(tui)) return () => {};
  // UI handles are proxies. Patch the prototype only for this terminal.
  const proto = tui.mode === 'regular' ? TuiAltScreen.prototype as any : Object.getPrototypeOf(tui), terminal = tui.terminal;
  const detach = chainNativeMethod(proto, 'compositeOverlays', function(this: any, native, lines: string[], ...args: any[]) {
    if (this.terminal !== terminal || this.mode !== 'fullscreen') return native.call(this, lines, ...args);
    // ponytail: Pi 1.3 fullscreen only; remove when native composition is fixed.
    const hideImages = this.imageProtocol === 'kitty' && this.hasOverlay();
    const base = lines.map(line => hideImages && line.includes('\x1b_G') ? '' : line.replace(promptZones, ''));
    return native.call(this, base, ...args);
  });
  return () => { detach(); tui.requestRender?.(); };
}
