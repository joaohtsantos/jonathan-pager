// Porter state on the phone: per-machine topic values, the notify inbox and
// local sender preferences. Persisted to KV for offline display; observable
// for React via subscribe()/getSnapshot().
import { Mutex, readJSON, writeJSON, type KV } from "../comms/storage";
import type { Agent, MachineStatus, Notify, Subscribed, Trust } from "./types";

export interface MachineState {
  machineId: string;
  /** Display name from porter messages (`machine`), else the pairing alias. */
  name?: string;
  subscribed?: Omit<Subscribed, "type"> & { at: number };
  subscribeSentAt?: number;
  subscribeError?: string;
  agents: Record<string, Agent>;
  agentsTruncated?: boolean;
  agentsAt?: number;
  status?: MachineStatus;
  statusAt?: number;
  trusts: Record<string, Trust>;
  lastMessageAt?: number;
  /** Topics this phone asks for (chosen when pairing); default: all. */
  wantTopics?: string[];
  /** Phone turned pushes off for this machine (subscribe without a token). */
  pushOff?: boolean;
}

export interface InboxItem {
  id: string;
  fromMachine: string;
  /** comms agent id of the carrier (`<machine>:porter`), when it arrived over comms; answers go there. */
  fromAgent?: string;
  notify: Notify;
  receivedAt: number;
  via: "comms" | "push";
  read: boolean;
  answer?: { choice: string; at: number; state: "sending" | "sent" | "failed"; error?: string; text?: string };
  cancelled?: { resolution: string; at: number };
}

export interface Prefs {
  /** sender key → true. Muted: kept but silent. Blocked: dropped. */
  muted: Record<string, true>;
  blocked: Record<string, true>;
}

export interface PorterSnapshot {
  machines: Record<string, MachineState>;
  inbox: InboxItem[];
  prefs: Prefs;
}

const K = { machines: "porter.machines.v1", inbox: "porter.inbox.v1", prefs: "porter.prefs.v1", shown: "porter.shown.v1" };
const INBOX_MAX = 500;

export const machineKey = (machineId: string) => `m:${machineId}`;
export const agentKey = (machineId: string, agent: string) => `a:${machineId}/${agent}`;

/**
 * Agent-level identity of a notify's sender. Notifies are carried by
 * `<machine>:porter`, so the comms sender is porter; the originating agent is
 * `context.agent` (its comms address), else its harness session / title.
 */
export function notifySenderAgent(item: Pick<InboxItem, "notify" | "fromAgent">): string | undefined {
  const c = item.notify.context;
  return c?.agent || c?.session || c?.title || item.fromAgent;
}

export function isQuestion(item: InboxItem, now = Date.now()): boolean {
  return (
    !!item.notify.ask?.length &&
    !item.answer &&
    !item.cancelled &&
    !(item.notify.expires_at && Date.parse(item.notify.expires_at) < now)
  );
}

export class PorterStore {
  private snap: PorterSnapshot = { machines: {}, inbox: [], prefs: { muted: {}, blocked: {} } };
  private listeners = new Set<() => void>();
  private mutex = new Mutex();
  private loaded: Promise<void> | null = null;

  constructor(private kv: KV) {}

  load(): Promise<void> {
    if (!this.loaded) {
      this.loaded = (async () => {
        this.snap = {
          machines: await readJSON(this.kv, K.machines, {}),
          inbox: await readJSON(this.kv, K.inbox, []),
          prefs: await readJSON(this.kv, K.prefs, { muted: {}, blocked: {} }),
        };
        this.emit();
      })();
    }
    return this.loaded;
  }

  /** Re-read from storage (e.g. after a headless background task wrote to it). */
  async reload(): Promise<void> {
    this.loaded = null;
    await this.load();
  }

  getSnapshot = (): PorterSnapshot => this.snap;

  /** Replaces everything (dev mock mode seeds an in-memory store with it). */
  replaceAll(snap: PorterSnapshot): Promise<void> {
    return this.mutate((s) => {
      s.machines = snap.machines;
      s.inbox = snap.inbox;
      s.prefs = snap.prefs;
      return ["machines", "inbox", "prefs"];
    });
  }
  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  private emit() {
    for (const l of this.listeners) l();
  }

  private async mutate(fn: (s: PorterSnapshot) => (keyof PorterSnapshot)[]): Promise<void> {
    await this.load();
    await this.mutex.run(async () => {
      const next: PorterSnapshot = {
        machines: { ...this.snap.machines },
        inbox: [...this.snap.inbox],
        prefs: { muted: { ...this.snap.prefs.muted }, blocked: { ...this.snap.prefs.blocked } },
      };
      const dirty = fn(next);
      this.snap = next;
      if (dirty.includes("machines")) await writeJSON(this.kv, K.machines, next.machines);
      if (dirty.includes("inbox")) await writeJSON(this.kv, K.inbox, next.inbox);
      if (dirty.includes("prefs")) await writeJSON(this.kv, K.prefs, next.prefs);
      this.emit();
    });
  }

  private static machine(s: PorterSnapshot, id: string): MachineState {
    const m = s.machines[id] ?? { machineId: id, agents: {}, trusts: {} };
    const copy = { ...m, agents: { ...m.agents }, trusts: { ...m.trusts } };
    s.machines[id] = copy;
    return copy;
  }

  updateMachine(id: string, fn: (m: MachineState) => void): Promise<void> {
    return this.mutate((s) => {
      const m = PorterStore.machine(s, id);
      fn(m);
      m.lastMessageAt = Date.now();
      return ["machines"];
    });
  }

  markSubscribeSent(id: string, error?: string): Promise<void> {
    return this.mutate((s) => {
      const m = PorterStore.machine(s, id);
      m.subscribeSentAt = Date.now();
      m.subscribeError = error;
      return ["machines"];
    });
  }

  forgetMachine(id: string): Promise<void> {
    return this.mutate((s) => {
      delete s.machines[id];
      return ["machines"];
    });
  }

  /** Partial agent update from an encrypted push (the full item arrives over comms). */
  applyAgentPush(machineId: string, p: { machine?: string; agent: string; title?: string; status: Agent["status"]; needs?: Agent["needs"]; summary?: string }) {
    return this.updateMachine(machineId, (m) => {
      if (p.machine) m.name = p.machine;
      const old = m.agents[p.agent];
      const changed = !old || old.status !== p.status;
      m.agents[p.agent] = {
        ...(old ?? { id: p.agent }),
        id: p.agent,
        title: p.title ?? old?.title,
        status: p.status,
        needs: p.status === "needs_you" ? p.needs : undefined,
        summary: p.summary ?? old?.summary,
        status_since: changed ? new Date().toISOString() : old?.status_since,
      };
    });
  }

  /** Adds or refreshes a notify. Returns false when dropped (blocked or duplicate). */
  async ingestNotify(fromMachine: string, fromAgent: string | undefined, notify: Notify, via: InboxItem["via"]): Promise<boolean> {
    if (!notify || typeof notify.id !== "string" || typeof notify.title !== "string") return false;
    let added = false;
    await this.mutate((s) => {
      const probe = { notify, fromAgent };
      const agent = notifySenderAgent(probe);
      if (s.prefs.blocked[machineKey(fromMachine)] || (agent && s.prefs.blocked[agentKey(fromMachine, agent)])) return [];
      const i = s.inbox.findIndex((x) => x.id === notify.id && x.fromMachine === fromMachine);
      if (i >= 0) {
        // Same notify via the other path: the comms copy carries the reply address.
        const old = s.inbox[i];
        s.inbox[i] = { ...old, fromAgent: old.fromAgent ?? fromAgent, notify: { ...old.notify, ...notify }, via: old.via === "comms" ? "comms" : via };
        return ["inbox"];
      }
      added = true;
      s.inbox.unshift({ id: notify.id, fromMachine, fromAgent, notify, receivedAt: Date.now(), via, read: false });
      if (s.inbox.length > INBOX_MAX) s.inbox.length = INBOX_MAX;
      return ["inbox"];
    });
    return added;
  }

  updateInbox(id: string, fromMachine: string, fn: (i: InboxItem) => InboxItem): Promise<void> {
    return this.mutate((s) => {
      const i = s.inbox.findIndex((x) => x.id === id && x.fromMachine === fromMachine);
      if (i < 0) return [];
      s.inbox[i] = fn(s.inbox[i]);
      return ["inbox"];
    });
  }

  markAllRead(): Promise<void> {
    return this.mutate((s) => {
      s.inbox = s.inbox.map((i) => (i.read ? i : { ...i, read: true }));
      return ["inbox"];
    });
  }

  setPref(kind: "muted" | "blocked", key: string, on: boolean): Promise<void> {
    return this.mutate((s) => {
      if (on) s.prefs[kind][key] = true;
      else delete s.prefs[kind][key];
      return ["prefs"];
    });
  }

  isSilenced(machineId: string, agent?: string): boolean {
    const p = this.snap.prefs;
    const keys = [machineKey(machineId), ...(agent ? [agentKey(machineId, agent)] : [])];
    return keys.some((k) => p.muted[k] || p.blocked[k]);
  }

  /** Dedupe for local notifications shown from either path. True if new. */
  async claimShown(key: string, ttlMs = 10 * 60_000): Promise<boolean> {
    return this.mutex.run(async () => {
      const now = Date.now();
      const shown = await readJSON<Record<string, number>>(this.kv, K.shown, {});
      for (const [k, until] of Object.entries(shown)) if (until < now) delete shown[k];
      if (shown[key]) return false;
      shown[key] = now + ttlMs;
      await writeJSON(this.kv, K.shown, shown);
      return true;
    });
  }
}
