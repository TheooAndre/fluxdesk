/** Bounded, in-flight-deduplicated cache. Never disguises a failed refresh as success. */
export class RequestCache {
  private readonly values = new Map<string, { expires: number; value: unknown }>();
  private readonly pending = new Map<string, Promise<unknown>>();
  private readonly maxEntries: number;
  constructor(maxEntries = 600) {
    this.maxEntries = maxEntries;
  }

  async get<T>(key: string, ttl: number, work: () => Promise<T>): Promise<T> {
    const hit = this.values.get(key);
    if (hit && hit.expires > Date.now()) return hit.value as T;
    const active = this.pending.get(key);
    if (active) return active as Promise<T>;
    const task = Promise.resolve()
      .then(work)
      .then((value) => {
        this.values.delete(key);
        this.values.set(key, { value, expires: Date.now() + ttl });
        while (this.values.size > this.maxEntries) this.values.delete(this.values.keys().next().value!);
        return value;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, task);
    return task;
  }
}
