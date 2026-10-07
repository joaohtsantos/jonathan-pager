// Storage seams so the comms core runs under Node tests and in React Native.

export interface KV {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** Holds the private key and the broker service key. */
export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export class MemoryKV implements KV, SecretStore {
  data = new Map<string, string>();
  async getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  async setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  async removeItem(k: string) {
    this.data.delete(k);
  }
  get = this.getItem;
  set = this.setItem;
  remove = this.removeItem;
}

export async function readJSON<T>(kv: KV, key: string, fallback: T): Promise<T> {
  try {
    const raw = await kv.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export async function writeJSON(kv: KV, key: string, value: unknown): Promise<void> {
  await kv.setItem(key, JSON.stringify(value));
}

/** Serializes async read-modify-write sections within one JS runtime. */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn);
    this.tail = next.catch(() => undefined);
    return next;
  }
}
