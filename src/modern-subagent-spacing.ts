import * as Pi from '@earendil-works/pi-coding-agent';
import * as Tui from '@earendil-works/pi-tui';

const { CustomMessageComponent, VERSION } = Pi;
const { Container } = Tui;

const hidden = Symbol.for('compact-renderer:subagent-hidden:v1');

/** Pi owns the spacer outside custom renderers. Suppress that spacer only for
 * our marked grouped followers; an empty unrelated renderer keeps native layout.
 * CustomEntryComponent is not exported by Pi, so this guarded inherited-method
 * seam avoids importing private modules or replacing the transcript container. */
export function installSubagentSpacingAdapter(_version = VERSION): (() => void) | undefined {
  const proto = Container?.prototype as any;
  if (typeof CustomMessageComponent !== 'function' || !proto || typeof proto.render !== 'function') return;
  const owner = Symbol.for('compact-renderer:subagent-spacing:v1');
  proto[owner]?.();
  const original = proto.render;
  let disposed = false;
  const wrapped = function(this: any, width: number) {
    const component = this.customComponent;
    const message = this instanceof CustomMessageComponent && this.message?.role === 'custom';
    const entry = this.constructor?.name === 'CustomEntryComponent' && this.entry?.type === 'custom' && typeof this.renderer === 'function';
    if (!disposed && (message || entry) && Array.isArray(this.children) && this.children.includes(component) && typeof component?.[hidden] === 'function') {
      // The marker is owned by Pi Fold, not supplied by transcript data.
      try { if (component[hidden]() === true) return []; } catch { /* Preserve native layout on incompatible state. */ }
    }
    return original.call(this, width);
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (proto.render === wrapped) proto.render = original;
    if (proto[owner] === dispose) delete proto[owner];
  };
  proto.render = wrapped; proto[owner] = dispose;
  return dispose;
}
