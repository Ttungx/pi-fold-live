import * as Pi from '@earendil-works/pi-coding-agent';
import * as Tui from '@earendil-works/pi-tui';
import { chainNativeMethod } from "./native-method-chain.ts";

const { AssistantMessageComponent, VERSION } = Pi;
const { Markdown, MouseRegion, Spacer, Text } = Tui;

const thinkingComponentsSupported = [Markdown, MouseRegion, Spacer, Text].every(value => typeof value === 'function');

/** Private Pi 1.3.0 seam: only pure hidden-thinking assistant containers qualify.
 * Native Ctrl+T/per-run expansion and unknown component shapes always win. */
export function hiddenThinkingShape(component: any, message: any): boolean {
  if (!thinkingComponentsSupported || component.lastMessage !== message || component.hideThinkingBlock !== true || !(component.thinkingVisibilityOverrides instanceof Map)) return false;
  if ([...component.thinkingVisibilityOverrides.values()].some(value => value === false)) return false;
  const children = component.contentContainer?.children;
  let expected = 0, inRun = false, nonempty = false;
  for (const block of message?.content || []) {
    if (block.type !== "thinking") { inRun = false; nonempty = false; continue; }
    if (!inRun) { inRun = true; nonempty = false; }
    if (!nonempty && typeof block.thinking === "string" && block.thinking.trim()) { expected++; nonempty = true; }
  }
  return Array.isArray(children) && children.filter((c: any) => c instanceof MouseRegion).length === expected && children.every((c: any) => c instanceof Spacer || c instanceof MouseRegion && c.child instanceof Text);
}
/** One hidden run beside native reply text. Validate the exact native sequence;
 * interleaved runs and unfamiliar/error layouts retain their native rendering. */
export function mixedThinkingRegion(component: any, message: any): any | undefined {
  if (!thinkingComponentsSupported || component.lastMessage !== message || component.hideThinkingBlock !== true || !(component.thinkingVisibilityOverrides instanceof Map)
    || [...component.thinkingVisibilityOverrides.values()].some(value => value === false)
    || ["error", "aborted", "length"].includes(message?.stopReason)) return;
  const expected: string[] = [], visible: string[] = [];
  let inRun = false, nonempty = false;
  for (const block of message?.content || []) {
    if (block.type === "thinking") {
      if (!inRun) { inRun = true; nonempty = false; }
      if (!nonempty && typeof block.thinking === "string" && block.thinking.trim()) { visible.push("thinking"); nonempty = true; }
    } else {
      inRun = false;
      if (block.type === "text" && block.text?.trim()) visible.push("text");
      else if (block.type !== "text" && block.type !== "toolCall") return;
    }
  }
  if (visible.filter(kind => kind === "thinking").length !== 1 || !visible.includes("text")) return;
  expected.push("space");
  visible.forEach((kind, index) => { expected.push(kind); if (kind === "thinking" && index < visible.length - 1) expected.push("space"); });
  const children = component.contentContainer?.children;
  if (!Array.isArray(children) || children.length !== expected.length || !children.every((child: any, index: number) =>
    expected[index] === "space" ? child instanceof Spacer : expected[index] === "text" ? child instanceof Markdown : child instanceof MouseRegion && child.child instanceof Text)) return;
  return children.find((child: any) => child instanceof MouseRegion);
}
export function installModernThinkingAdapter(hooks: {
  associate(component: any, message: any): void;
  render(component: any, width: number): string[] | undefined;
  mouse(component: any, event: any): any;
  clear(): void;
}, _version = VERSION): (() => void) | undefined {
  const proto = AssistantMessageComponent?.prototype as any;
  if (!thinkingComponentsSupported || !proto || !["updateContent", "render", "setHideThinkingBlock"].every(key => typeof proto[key] === "function")) return;
  const owner = Symbol.for("compact-renderer:thinking-adapter:v1");
  proto[owner]?.();
  let disposed = false;
  const regions = new Map<any, () => void>();
  const detachUpdate = chainNativeMethod(proto, "updateContent", function(this: any, update, ...args: any[]) {
    regions.get(this)?.(); regions.delete(this);
    const value = update.apply(this, args);
    if (!disposed) {
      hooks.associate(this, args[0]);
      const region = mixedThinkingRegion(this, args[0]);
      if (region) {
        const component = this, render = region.render, mouse = region.handleMouse;
        region.render = (width: number) => hooks.render(component, width)?.slice(1) ?? render.call(region, width);
        region.handleMouse = (event: any) => hooks.mouse(component, { ...event, y: event.y + 1 }) || mouse?.call(region, event);
        regions.set(this, () => { region.render = render; region.handleMouse = mouse; });
      }
    }
    return value;
  });
  const detachRender = chainNativeMethod(proto, "render", function(this: any, render, width: number) { return !disposed && hiddenThinkingShape(this, this.lastMessage) && hooks.render(this, width) || render.call(this, width); });
  const detachMouse = chainNativeMethod(proto, "handleMouse", function(this: any, mouse, event: any) { const result = !disposed && hiddenThinkingShape(this, this.lastMessage) && hooks.mouse(this, event); return result || mouse?.call(this, event); });
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const restore of regions.values()) restore();
    regions.clear();
    detachMouse(); detachRender(); detachUpdate();
    if (proto[owner] === dispose) delete proto[owner];
    hooks.clear();
  };
  proto[owner] = dispose;
  return dispose;
}
