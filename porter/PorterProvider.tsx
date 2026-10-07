// React glue: boots the runtime, runs the comms stream while foregrounded,
// (re)subscribes to paired machines, and exposes state + actions.
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AppState } from "react-native";
import * as Notifications from "expo-notifications";
import { useToken } from "../tokenContext";
import { getRuntime, handlePorterPush, type Runtime } from "./runtime";
import { setupPorterChannels } from "./notify";
import { registerPorterPushTask } from "./pushTask";
import type { ConnectionState } from "../comms/node";
import type { PorterSnapshot } from "./store";

interface PorterContextValue {
  rt: Runtime | null;
  bootError: string | null;
  connection: ConnectionState;
  connectionError: string;
  /** Bumped when node config (peers, broker) changes so screens re-read it. */
  version: number;
  refreshNode: () => void;
  resubscribe: () => Promise<void>;
}

const Ctx = createContext<PorterContextValue>({
  rt: null,
  bootError: null,
  connection: "idle",
  connectionError: "",
  version: 0,
  refreshNode: () => {},
  resubscribe: async () => {},
});

export const usePorter = () => useContext(Ctx);

const EMPTY: PorterSnapshot = { machines: {}, inbox: [], prefs: { muted: {}, blocked: {} } };
const noopSub = () => () => {};

export function usePorterState(): PorterSnapshot {
  const { rt } = usePorter();
  return useSyncExternalStore(rt ? rt.store.subscribe : noopSub, rt ? rt.store.getSnapshot : () => EMPTY);
}

/** Re-render every `ms` (live timers). */
export function useTick(ms = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const RESUBSCRIBE_AFTER_MS = 10 * 60_000;

export function PorterProvider({ children }: { children: ReactNode }) {
  const { token } = useToken();
  const [rt, setRt] = useState<Runtime | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("idle");
  const [connectionError, setConnectionError] = useState("");
  const [version, setVersion] = useState(0);
  const lastSubscribe = useRef<{ at: number; token: string | null }>({ at: 0, token: null });

  useEffect(() => {
    setupPorterChannels().catch(() => undefined);
    registerPorterPushTask().catch(() => undefined);
    getRuntime()
      .then((r) => {
        setRt(r);
        r.node.onConnection((c) => {
          setConnection(c);
          setConnectionError(r.node.lastError);
        });
      })
      .catch((e) => setBootError(String(e)));
    // Foreground: data-only pushes may also reach the received listener.
    const sub = Notifications.addNotificationReceivedListener((n) => {
      void handlePorterPush(n).catch(() => undefined);
    });
    return () => sub.remove();
  }, []);

  const resubscribe = useCallback(async () => {
    if (!rt || !rt.node.configured) return;
    lastSubscribe.current = { at: Date.now(), token };
    await rt.porter.subscribeAll(token);
  }, [rt, token]);

  // Foreground lifecycle: stream while active, close in background.
  useEffect(() => {
    if (!rt) return;
    const activate = async () => {
      await rt.store.reload();
      if (!rt.node.configured) return;
      rt.node.start();
      const last = lastSubscribe.current;
      if (last.token !== token || Date.now() - last.at > RESUBSCRIBE_AFTER_MS) {
        await resubscribe().catch(() => undefined);
      }
    };
    if (AppState.currentState === "active") void activate();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void activate();
      else if (state === "background") void rt.node.stop();
    });
    return () => sub.remove();
  }, [rt, token, version, resubscribe]);

  const refreshNode = useCallback(() => setVersion((v) => v + 1), []);

  return (
    <Ctx.Provider value={{ rt, bootError, connection, connectionError, version, refreshNode, resubscribe }}>
      {children}
    </Ctx.Provider>
  );
}
