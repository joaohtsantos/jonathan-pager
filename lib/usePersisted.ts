// Small AsyncStorage-backed state for local UI preferences (machine order etc.).
import { useCallback, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export function usePersisted<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(key)
      .then((raw) => {
        if (alive && raw != null) setValue(JSON.parse(raw) as T);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [key]);
  const set = useCallback(
    (v: T) => {
      setValue(v);
      AsyncStorage.setItem(key, JSON.stringify(v)).catch(() => undefined);
    },
    [key]
  );
  return [value, set];
}
