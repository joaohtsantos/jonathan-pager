// React glue: boots the runtime, runs the comms stream while foregrounded,
// (re)subscribes to paired machines, and exposes state + actions.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { useToken } from "../tokenContext";
import { getRuntime, handlePorterPush, type Runtime } from "./runtime";
import { setupPorterChannels } from "./notify";
import { registerPorterPushTask } from "./pushTask";
import type { ConnectionState } from "../comms/node";
import { PorterStore, type InboxItem, type PorterSnapshot } from "./store";
import { MemoryKV } from "../comms/storage";
import { mockPresence, mockSnapshot } from "./mock";
import type { Presence } from "./selectors";

/** UI actions; in dev mock mode they only change the in-memory mock store. */
export interface PorterActions {
  answer: (item: InboxItem, choice: string, text?: string) => Promise<void>;
  /** Local-only: a question the phone chose not to answer. */
  dismiss: (item: InboxItem) => Promise<void>;
  setSpecial: (machineId: string, agentId: string, special: boolean) => Promise<void>;
  revokeTrust: (machineId: string, trustId: string) => Promise<void>;
  setPush: (machineId: string, on: boolean) => Promise<void>;
  resign: (machineId: string) => Promise<void>;
}

interface PorterContextValue {
  rt: Runtime | null;
  bootError: string | null;
  connection: ConnectionState;
  connectionError: string;
  /** Bumped when node config (peers, broker) changes so screens re-read it. */
  version: number;
  refreshNode: () => void;
  resubscribe: () => Promise<void>;
  /** The store screens read: the real one, or the mock one in dev mock mode. */
  store: PorterStore | null;
  mock: boolean;
  setMock: (on: boolean) => void;
  /** machine id → online from the broker directory; null until known. */
  presence: Presence | null;
  actions: PorterActions;
}

const noAction = async () => {};
const NO_ACTIONS: PorterActions = { answer: noAction, dismiss: noAction, setSpecial: noAction, revokeTrust: noAction, setPush: noAction, resign: noAction };
const MOCK_KEY = "dev.mock.v1";

const Ctx = createContext<PorterContextValue>({
  rt: null,
  bootError: null,
  connection: "idle",
  connectionError: "",
  version: 0,
  refreshNode: () => {},
  resubscribe: async () => {},
  store: null,
  mock: false,
  setMock: () => {},
  presence: null,
  actions: NO_ACTIONS,
});

export const usePorter = () => useContext(Ctx);

const EMPTY: PorterSnapshot = { machines: {}, inbox: [], prefs: { muted: {}, blocked: {} } };
const noopSub = () => () => {};

export function usePorterState(): PorterSnapshot {
  const { store } = usePorter();
  return useSyncExternalStore(store ? store.subscribe : noopSub, store ? store.getSnapshot : () => EMPTY);
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

  // ---- dev mock mode -------------------------------------------------------
  const [mock, setMockState] = useState(false);
  const [mockStore, setMockStore] = useState<PorterStore | null>(null);
  useEffect(() => {
    if (!__DEV__) return;
    AsyncStorage.getItem(MOCK_KEY)
      .then((v) => setMockState(v === "1"))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!mock) {
      setMockStore(null);
      return;
    }
    const st = new PorterStore(new MemoryKV());
    void st.replaceAll(mockSnapshot()).then(() => setMockStore(st));
  }, [mock]);
  const setMock = useCallback((on: boolean) => {
    if (!__DEV__) return;
    setMockState(on);
    AsyncStorage.setItem(MOCK_KEY, on ? "1" : "0").catch(() => undefined);
  }, []);

  // ---- presence (broker directory), polled while foregrounded --------------
  const [presence, setPresence] = useState<Presence | null>(null);
  useEffect(() => {
    if (!rt || mock) return;
    let alive = true;
    const poll = async () => {
      if (!rt.node.configured || AppState.currentState !== "active") return;
      try {
        const list = await rt.node.who();
        const out: Presence = {};
        for (const p of rt.node.peers()) out[p.machine_id] = false;
        // A machine is online when its porter (else any agent) is online.
        for (const p of list) if (p.online && (p.alias === "porter" || out[p.machine_id] === false)) out[p.machine_id] = true;
        if (alive) setPresence(out);
      } catch {
        if (alive) setPresence(null);
      }
    };
    void poll();
    const t = setInterval(poll, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [rt, mock, version, connection]);

  const actions = useMemo<PorterActions>(() => {
    if (mock && mockStore) {
      const st = mockStore;
      return {
        answer: async (item, choice, text) => {
          await st.updateInbox(item.id, item.fromMachine, (i) => ({ ...i, read: true, answer: { choice, at: Date.now(), state: "sent", ...(text !== undefined ? { text } : {}) } }));
          const session = item.notify.context?.session;
          if (session)
            await st.updateMachine(item.fromMachine, (m) => {
              const a = m.agents[session];
              if (a && a.status === "needs_you")
                m.agents[session] = { ...a, status: "running", needs: undefined, status_since: new Date().toISOString(), last_decision: { choice, via: "phone", at: new Date().toISOString(), text: a.needs?.text?.replace(/^Bash:\s*/, "") } };
            });
        },
        dismiss: (item) => st.updateInbox(item.id, item.fromMachine, (i) => ({ ...i, read: true, cancelled: { resolution: "dismissed", at: Date.now() } })),
        setSpecial: (machineId, agentId, special) => st.updateMachine(machineId, (m) => void (m.agents[agentId] && (m.agents[agentId] = { ...m.agents[agentId], special }))),
        revokeTrust: (machineId, trustId) => st.updateMachine(machineId, (m) => void delete m.trusts[trustId]),
        setPush: (machineId, on) => st.updateMachine(machineId, (m) => void ((m.pushOff = !on), m.subscribed && (m.subscribed = { ...m.subscribed, push: on }))),
        resign: (machineId) => st.updateMachine(machineId, (m) => void (m.subscribed && (m.subscribed = { ...m.subscribed, approver: false }))),
      };
    }
    if (!rt) return NO_ACTIONS;
    return {
      answer: (item, choice, text) => rt.porter.answer(item, choice, text),
      dismiss: (item) => rt.store.updateInbox(item.id, item.fromMachine, (i) => ({ ...i, read: true, cancelled: { resolution: "dismissed", at: Date.now() } })),
      setSpecial: (machineId, agentId, special) => rt.porter.setSpecial(machineId, agentId, special),
      revokeTrust: (machineId, trustId) => rt.porter.revokeTrust(machineId, trustId),
      setPush: (machineId, on) => rt.porter.setPush(machineId, on, token),
      resign: (machineId) => rt.porter.resign(machineId),
    };
  }, [mock, mockStore, rt, token]);

  const store = mock ? mockStore : rt?.store ?? null;
  const mockPres = useMemo(() => mockPresence(), []);
  const shownPresence = mock ? mockPres : presence;

  return (
    <Ctx.Provider
      value={{ rt, bootError, connection, connectionError, version, refreshNode, resubscribe, store, mock, setMock, presence: shownPresence, actions }}
    >
      {children}
    </Ctx.Provider>
  );
}
