import * as Pi from '@earendil-works/pi-coding-agent';
import * as Tui from '@earendil-works/pi-tui';
import { chainNativeMethod } from "./native-method-chain.ts";
import { activityRow, cardContentWidth, cardPadding } from "./display-card.ts";

const { ToolExecutionComponent, VERSION } = Pi;
const { getCapabilities, Image, imageFallback, truncateToWidth } = Tui;

export const compactToolImages = Symbol.for("compact-renderer:tool-images:v1");
export type ToolImageView = { open: boolean; count: number; bodyIndent: number; source?: string; theme?: any };

/** Pi 1.3.0 appends images outside renderShell:self. Borrow those same native
 * objects during render only; never change image sources, settings or ownership. */
export function installModernToolImages(_version = VERSION): (() => void) | undefined {
  const proto = ToolExecutionComponent?.prototype as any;
  if (![Image, getCapabilities, imageFallback, truncateToWidth].every(value => typeof value === "function") || !proto || typeof proto.render !== "function" || typeof proto.updateDisplay !== "function") return;
  const owner = Symbol.for("compact-renderer:tool-image-adapter:v1");
  proto[owner]?.();
  let disposed = false;
  const detach = chainNativeMethod(proto, "render", function(this: any, nativeRender, width: number) {
    const view: ToolImageView | undefined = !disposed && this.toolDefinition?.[compactToolImages]?.(this, width);
    if (!view?.count || this.getRenderShell?.() !== "self" || !Array.isArray(this.imageComponents) ||
      !Array.isArray(this.imageSpacers) || !this.imageComponents.every((image: any) => image instanceof Image && image.options && typeof image.invalidate === "function")) return nativeRender.call(this, width);
    const images = this.imageComponents, spacers = this.imageSpacers;
    let lines: string[];
    // The host uses these arrays only to append images after its text shell.
    // Keep native children, sources and reusable decoder/transcoder state intact.
    this.imageComponents = []; this.imageSpacers = [];
    try { lines = nativeRender.call(this, width); }
    finally { this.imageComponents = images; this.imageSpacers = spacers; }
    if (!view.open || this.hideComponent) return lines;
    const indent = " ".repeat(cardPadding(width) + view.bodyIndent);
    const imageWidth = Math.max(1, width - indent.length - cardPadding(width));
    const fallback = (reason: string, mime?: string, dimensions?: any) => {
      const safeMime = mime?.slice(0, 120).replace(/[\p{Cc}\p{Cf}]/gu, " ");
      const description = safeMime ? imageFallback(safeMime, dimensions, view.source) : `${view.count} image${view.count === 1 ? "" : "s"}${view.source ? ` · ${imageFallback("image", undefined, view.source)}` : ""}`;
      const message = `Inline preview unavailable: ${reason}`;
      const text = truncateToWidth(view.source ? `${description} · ${message}` : `${message} · ${description}`, Math.max(1, cardContentWidth(width) - view.bodyIndent), "");
      return activityRow(" ".repeat(view.bodyIndent) + (view.theme?.fg("muted", text) ?? text), width, view.theme);
    };
    if (!this.showImages) return [...lines, fallback("images are disabled")];
    if (!getCapabilities().images) return [...lines, fallback("terminal has no image protocol")];
    if (!images.length) return [...lines, fallback("image data is unavailable")];
    const maxHeight = Math.max(1, Math.min(12, Math.floor((process.stdout.rows || 24) / 2)));
    for (let index = 0; index < images.length; index++) {
      const image = images[index], options = image.options;
      let preview: string[];
      image.options = { ...options, maxWidthCells: Math.min(60, options.maxWidthCells ?? 60), maxHeightCells: Math.min(maxHeight, options.maxHeightCells ?? maxHeight) };
      image.invalidate();
      try { preview = image.render(imageWidth); }
      finally { image.options = options; image.invalidate(); }
      // Image.render owns protocol encoding and conversion. Its plain fallback
      // means the format/conversion could not produce protocol output this time.
      if (preview.some(line => line.includes("\x1b_G") || line.includes("\x1b]1337;File="))) {
        // Keep image protocol bytes intact; prefix the same gutter as expanded
        // text, including iTerm2's cursor-up row and Kitty's image anchor.
        lines.push(...(spacers[index]?.render(width) ?? [""]), ...preview.map(row => indent + row));
      } else lines.push(fallback("image format was not rendered", image.mimeType, image.dimensions));
    }
    if (images.length < view.count) lines.push(fallback("some image data is unavailable"));
    return lines;
  });
  const dispose = () => { if (disposed) return; disposed = true; detach(); if (proto[owner] === dispose) delete proto[owner]; };
  proto[owner] = dispose;
  return dispose;
}
