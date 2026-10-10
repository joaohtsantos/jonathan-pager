// Small AsyncStorage-backed state for local UI preferences (machine order,
// zone colors…). Instances using the same key stay in sync.
import { useCallback, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const listeners = new Map<string, Set<(v: unknown) => void>>();
const cache = new Map<string, unknown>();

export function usePersisted<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => (cache.has(key) ? (cache.get(key) as T) : initial));
  useEffect(() => {
    let alive = true;
    const l = (v: unknown) => setValue(v as T);
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key)!.add(l);
    if (!cache.has(key)) {
      AsyncStorage.getItem(key)
        .then((raw) => {
          if (raw != null && alive && !cache.has(key)) {
            const v = JSON.parse(raw) as T;
            cache.set(key, v);
            listeners.get(key)?.forEach((f) => f(v));
          }
        })
        .catch(() => undefined);
    }
    return () => {
      alive = false;
      listeners.get(key)?.delete(l);
    };
  }, [key]);
  const set = useCallback(
    (v: T) => {
      cache.set(key, v);
      listeners.get(key)?.forEach((f) => f(v));
      AsyncStorage.setItem(key, JSON.stringify(v)).catch(() => undefined);
    },
    [key]
  );
  return [value, set];
}
