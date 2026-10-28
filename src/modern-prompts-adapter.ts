import * as Pi from '@earendil-works/pi-coding-agent';
import * as Tui from '@earendil-works/pi-tui';

const { UserMessageComponent, VERSION } = Pi;
const { Markdown } = Tui;

export function invalidateModernPrompt(component: any) {
  for (const child of Array.isArray(component?.children) ? component.children : []) if (typeof Markdown === "function" && child instanceof Markdown && typeof child.invalidate === "function") child.invalidate();
}

/** The transformer is public. This isolated Pi 1.3.0 seam supplies per-card
 * identity, cache invalidation, and mouse expansion, which the public hook lacks. */
export function installModernPromptAdapter(hooks: {
  render(component: any, markdown: string, original: () => string[]): string[];
  mouse(component: any, event: any): any;
  fallback?(component: any): void;
}, _version = VERSION): (() => void) | undefined {
  const proto = UserMessageComponent?.prototype as any;
  if (typeof Markdown !== "function" || !proto || typeof proto.render !== "function" || typeof proto.rebuild !== "function") return;
  const owner = Symbol.for("compact-renderer:prompt-adapter:v1");
  proto[owner]?.();
  const render = proto.render, mouse = proto.handleMouse;
  const mouseDescriptor = Object.getOwnPropertyDescriptor(proto, "handleMouse");
  let disposed = false;
  const compatible = (c: any) => typeof c.text === "string" && Array.isArray(c.children) && c.children.length === 1 && c.children[0] instanceof Markdown && typeof c.children[0].invalidate === "function";
  const renderWrapper = function(this: any, width: number) {
    if (!disposed && compatible(this)) return hooks.render(this, this.text, () => render.call(this, width));
    // A previously collapsed instance can become incompatible after a host update.
    // Clear only known native Markdown caches, then let the transformer return raw.
    invalidateModernPrompt(this);
    hooks.fallback?.(this);
    return render.call(this, width);
  };
  const mouseWrapper = function(this: any, event: any) { const handled = !disposed && compatible(this) && hooks.mouse(this, event); return handled || mouse?.call(this, event); };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (proto.render === renderWrapper) proto.render = render;
    if (proto.handleMouse === mouseWrapper) { if (mouseDescriptor) Object.defineProperty(proto, "handleMouse", mouseDescriptor); else delete proto.handleMouse; }
    if (proto[owner] === dispose) delete proto[owner];
  };
  proto.render = renderWrapper; proto.handleMouse = mouseWrapper; proto[owner] = dispose;
  return dispose;
}
