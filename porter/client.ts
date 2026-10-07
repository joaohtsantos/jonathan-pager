// Porter client: subscribes to every paired machine's porter and folds topic
// messages into the PorterStore; sends set / revoke / answer.
import type { CommsNode, InboundMessage } from "../comms/node";
import { PorterStore, type InboxItem } from "./store";
import { PORTER_ALIAS, TOPICS, type Agent, type MachineStatus, type Notify, type Trust } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseMsg = { type: string; [k: string]: any };

export interface PorterEvents {
  /** A notify arrived over comms (new). Used to present a local notification. */
  onNotify?: (item: InboxItem) => void;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export class PorterClient {
  private detach: (() => void) | null = null;

  constructor(private node: CommsNode, private store: PorterStore, private events: PorterEvents = {}) {}

  attach(): void {
    if (this.detach) return;
    this.detach = this.node.onMessage((m) => this.handle(m));
  }

  dispose(): void {
    this.detach?.();
    this.detach = null;
  }

  /** porter.subscribe to one machine. Omitting the token clears it there. */
  async subscribe(machineId: string, pushToken?: string | null): Promise<void> {
    const body = {
      type: "porter.subscribe",
      v: 1,
      topics: [...TOPICS],
      ...(pushToken ? { push: { provider: "expo", token: pushToken } } : {}),
    };
    try {
      await this.node.send(machineId, PORTER_ALIAS, JSON.stringify(body));
      await this.store.markSubscribeSent(machineId);
    } catch (e) {
      await this.store.markSubscribeSent(machineId, e instanceof Error ? e.message : String(e));
      throw e;
    }
  }

  /** Subscribe to all paired machines; failures are recorded per machine. */
  async subscribeAll(pushToken?: string | null): Promise<void> {
    await Promise.all(this.node.peers().map((p) => this.subscribe(p.machine_id, pushToken).catch(() => undefined)));
  }

  async unsubscribe(machineId: string): Promise<void> {
    await this.node.send(machineId, PORTER_ALIAS, JSON.stringify({ type: "porter.unsubscribe", v: 1 }));
  }

  async setSpecial(machineId: string, agentId: string, special: boolean): Promise<void> {
    await this.node.send(machineId, PORTER_ALIAS, JSON.stringify({ type: "porter.set", v: 1, agent: agentId, special }));
  }

  async revokeTrust(machineId: string, trustId: string): Promise<void> {
    await this.node.send(machineId, PORTER_ALIAS, JSON.stringify({ type: "porter.revoke", v: 1, trust: trustId }));
  }

  /** porter.answer to the exact `from` of the notify. */
  async answer(item: InboxItem, choice: string): Promise<void> {
    await this.store.updateInbox(item.id, item.fromMachine, (i) => ({
      ...i,
      read: true,
      answer: { choice, at: Date.now(), state: "sending" },
    }));
    try {
      // A notify seen only via push has no comms sender agent yet; porter on
      // that machine is the asker for permission/trust questions.
      const to = item.fromAgent ?? PORTER_ALIAS;
      await this.node.send(item.fromMachine, to, JSON.stringify({ type: "porter.answer", v: 1, id: item.id, choice }));
      await this.store.updateInbox(item.id, item.fromMachine, (i) => ({ ...i, answer: { ...i.answer!, state: "sent" } }));
    } catch (e) {
      await this.store.updateInbox(item.id, item.fromMachine, (i) => ({
        ...i,
        answer: { ...i.answer!, state: "failed", error: e instanceof Error ? e.message : String(e) },
      }));
      throw e;
    }
  }

  /** Dispatches one inbound comms message. Non-porter bodies are ignored. */
  async handle(m: InboundMessage): Promise<void> {
    // Untrusted JSON: every field is checked before use (shapes: PorterInbound).
    let parsed: unknown;
    try {
      parsed = JSON.parse(m.body);
    } catch {
      return;
    }
    if (!isObj(parsed) || typeof parsed.type !== "string" || !parsed.type.startsWith("porter.")) return;
    const msg = parsed as LooseMsg;
    const from = m.fromMachine; // authenticated; never trust body identity
    const name = typeof msg.machine === "string" ? msg.machine : undefined;

    switch (msg.type) {
      case "porter.subscribed":
        return this.store.updateMachine(from, (s) => {
          if (name) s.name = name;
          s.subscribeError = undefined;
          s.subscribed = {
            machine: name,
            topics: Array.isArray(msg.topics) ? msg.topics : undefined,
            refused: Array.isArray(msg.refused) ? msg.refused : undefined,
            approver: msg.approver === true,
            push: msg.push === true,
            porter_version: msg.porter_version,
            at: Date.now(),
          };
        });

      case "porter.snapshot": {
        const topic = msg.topic ?? (Array.isArray(msg.agents) ? "agents" : undefined);
        return this.store.updateMachine(from, (s) => {
          if (name) s.name = name;
          if (topic === "agents") {
            const raw: unknown[] = Array.isArray(msg.items) ? msg.items : Array.isArray(msg.agents) ? msg.agents : [];
            const items = raw.filter((a): a is Agent => isObj(a) && typeof a.id === "string");
            s.agents = Object.fromEntries(items.map((a) => [a.id, a]));
            s.agentsTruncated = msg.truncated === true;
            s.agentsAt = Date.now();
          } else if (topic === "status" && isObj(msg.value)) {
            s.status = msg.value as MachineStatus;
            s.statusAt = Date.now();
          } else if (topic === "trusts") {
            const items = (Array.isArray(msg.items) ? msg.items : []).filter((t: unknown): t is Trust => isObj(t) && typeof t.id === "string");
            s.trusts = Object.fromEntries(items.map((t) => [t.id, t]));
          }
        });
      }

      case "porter.update":
      case "porter.agent": {
        const topic = msg.type === "porter.agent" ? "agents" : msg.topic;
        const item = msg.type === "porter.agent" ? msg.agent : msg.item;
        return this.store.updateMachine(from, (s) => {
          if (name) s.name = name;
          if (topic === "agents" && isObj(item) && typeof item.id === "string") {
            s.agents[item.id as string] = item as unknown as Agent;
          } else if (topic === "status" && msg.type === "porter.update" && isObj(msg.value)) {
            s.status = msg.value as MachineStatus;
            s.statusAt = Date.now();
          } else if (topic === "trusts" && isObj(item) && typeof item.id === "string") {
            s.trusts[item.id as string] = item as unknown as Trust;
          }
        });
      }

      case "porter.remove": {
        const topic = msg.topic ?? "agents";
        if (typeof msg.id !== "string") return;
        return this.store.updateMachine(from, (s) => {
          if (topic === "agents") delete s.agents[msg.id];
          else if (topic === "trusts") delete s.trusts[msg.id];
        });
      }

      case "porter.notify": {
        const { type: _t, ...notify } = msg;
        const added = await this.store.ingestNotify(from, m.fromAgent, notify as Notify, "comms");
        if (added) {
          const item = this.store.getSnapshot().inbox.find((i) => i.id === (notify as Notify).id && i.fromMachine === from);
          if (item) this.events.onNotify?.(item);
        }
        return;
      }

      case "porter.cancel":
        if (typeof msg.id !== "string") return;
        return this.store.updateInbox(msg.id, from, (i) =>
          i.answer?.state === "sent" ? i : { ...i, cancelled: { resolution: msg.resolution ?? "answered", at: Date.now() } }
        );
    }
  }
}
