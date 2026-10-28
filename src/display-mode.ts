/** Session-local display state. No settings, messages, or model inputs are changed. */
export interface DisplayMode {
  isEnabled(): boolean;
  onChange(callback: () => void): () => void;
}

export function createDisplayMode(initial = true) {
  let enabled = initial;
  let disposed = false;
  const listeners = new Set<() => void>();
  const mode: DisplayMode & { setEnabled(value: boolean): boolean; dispose(): void } = {
    isEnabled: () => enabled && !disposed,
    onChange(callback) {
      if (disposed) return () => {};
      listeners.add(callback);
      return () => { listeners.delete(callback); };
    },
    setEnabled(value) {
      if (disposed || enabled === value) return false;
      enabled = value;
      // A native redraw may synchronously unregister and register itself again.
      // Snapshot first so one redraw cannot extend this iteration indefinitely.
      const errors: unknown[] = [];
      for (const callback of [...listeners]) {
        try { callback(); } catch (error) { errors.push(error); }
      }
      if (errors.length) throw new AggregateError(errors, 'Pi Fold display refresh failed');
      return true;
    },
    dispose() { disposed = true; listeners.clear(); },
  };
  return mode;
}
