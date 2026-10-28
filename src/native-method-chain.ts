const link = Symbol.for('compact-renderer:previous-native-method:v1');
type Method = (this: any, ...args: any[]) => any;
type Link = { previous: Method; descriptor?: PropertyDescriptor };

/** Cooperating native adapters can detach in either order, including when a
 * session reset replaces a wrapper underneath another active adapter. */
export function chainNativeMethod(proto: any, key: string, around: (this: any, previous: Method, ...args: any[]) => any): () => void {
  const previousLink = proto[key]?.[link] as Link | undefined;
  const descriptor = previousLink ? previousLink.descriptor : Object.getOwnPropertyDescriptor(proto, key);
  const state: Link = { previous: proto[key], descriptor };
  let disposed = false;
  const wrapped: Method = function(...args) { return disposed ? state.previous?.apply(this, args) : around.call(this, state.previous, ...args); };
  Object.defineProperty(wrapped, link, { value: state });
  proto[key] = wrapped;
  return () => {
    if (disposed) return; disposed = true;
    if (proto[key] === wrapped) {
      if (!descriptor && state.previous === Object.getPrototypeOf(proto)?.[key]) delete proto[key];
      else Object.defineProperty(proto, key, { ...(descriptor || { configurable: true, writable: true }), value: state.previous });
      return;
    }
    let method = proto[key]; const seen = new Set<Method>();
    while (typeof method === 'function' && !seen.has(method)) {
      seen.add(method);
      const parent = (method as any)[link] as Link | undefined;
      if (!parent) return;
      if (parent.previous === wrapped) { parent.previous = state.previous; return; }
      method = parent.previous;
    }
  };
}
