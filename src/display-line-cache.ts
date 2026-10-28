/** Bounded formatted text only: never retain components, sessions or themes.
 * The charge includes both strings at two bytes per code unit plus an allowance
 * for each Map entry. This bounds cache contents, not the JavaScript heap. */
export class DisplayLineCache {
  private entries = new Map<string, string>();
  chargedBytes = 0;
  constructor(private budget = 2 * 1024 * 1024, private maxEntries = 4096) {}
  clear() { this.entries.clear(); this.chargedBytes = 0; }
  private charge(key: string, value: string) { return 2 * (key.length + value.length) + 128; }
  get(key: string, render: () => string): string {
    const saved = this.entries.get(key);
    if (saved !== undefined) {
      this.entries.delete(key); this.entries.set(key, saved);
      return saved;
    }
    const value = render(), charge = this.charge(key, value);
    if (charge > this.budget) return value;
    while (this.entries.size && (this.chargedBytes + charge > this.budget || this.entries.size >= this.maxEntries)) {
      const oldest = this.entries.keys().next().value!;
      this.chargedBytes -= this.charge(oldest, this.entries.get(oldest)!);
      this.entries.delete(oldest);
    }
    this.entries.set(key, value); this.chargedBytes += charge;
    return value;
  }
}
