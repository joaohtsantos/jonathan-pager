// The phone as a plain comms node: one persistent global agent (alias "app"),
// pinned peers, outbound grants, encrypted send/receive through the broker.
// Mirrors the parts of internal/comms (node.go, broker_client.go, store.go)
// a single-agent mobile node needs.
import { fromBase64, toBase64 } from "./bytes";
import { generateKeyPair, keyPairFromSecret, newID, validPublicKey, type KeyPair } from "./crypto";
import {
  CommsError,
  decrypt,
  encrypt,
  fromWire,
  MAX_BODY,
  MESSAGE_TTL_MS,
  receiptID,
  validWireID,
  type Envelope,
  type Payload,
  type Receipt,
} from "./envelope";
import { BrokerClient, normalizeBrokerURL, type Presence, type StreamEvent } from "./broker";
import { Mutex, readJSON, writeJSON, type KV, type SecretStore } from "./storage";
import { utf8Encode } from "./bytes";
import type { StreamHandle, StreamOpener } from "./stream";

export const APP_ALIAS = "app";
const ALIAS = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

const K = {
  state: "comms.state.v1",
  seen: "comms.seen.v1",
  outbox: "comms.outbox.v1",
  sent: "comms.sent.v1",
  secret: "comms_secret_key",
  serviceKey: "comms_service_key",
};

/** `comms export` bundle: {"machine_id","public_key","alias"} (public key base64). */
export interface IdentityBundle {
  machine_id: string;
  public_key: string;
  alias: string;
}

export interface PeerRecord extends IdentityBundle {
  paired_at: number;
  /** agent IDs by alias, learned from /v1/who (persistent globals keep their IDs). */
  agents?: Record<string, string>;
}

export interface GrantRecord {
  allow_messages: boolean;
  revision: number;
}

interface NodeState {
  machine_id: string;
  public_key: string;
  agent_id: string;
  alias: string;
  created_at: number;
  broker_url: string;
  presence_revision: number;
  peers: Record<string, PeerRecord>;
  grants: Record<string, GrantRecord>;
}

export interface InboundMessage {
  id: string;
  fromMachine: string;
  fromAgent: string;
  peerAlias: string;
  body: string;
  createdAt: number;
}

export type SentState = "queued" | "forwarded" | Receipt["status"] | "failed";

interface OutboxItem {
  key: string;
  env: { routing: Omit<Envelope, "nonce" | "ciphertext">; nonce: string; ciphertext: string };
  tries: number;
}

export type ConnectionState = "idle" | "connecting" | "online" | "offline" | "error";

/** Go node cadence (types.go): presence every Heartbeat, broker lease 60 s. */
export const HEARTBEAT_MS = 15_000;
/** Stream must deliver headers this fast, else it is recycled. */
const OPEN_TIMEOUT_MS = 20_000;
/** Broker writes a heartbeat every 15 s; three missed means a dead stream. */
const SILENT_MS = 45_000;

/** Snapshot for the on-device debug line (Settings › Developer). Times are epoch ms, 0 = never. */
export interface NodeDebug {
  authOkAt: number;
  authError: string;
  presenceAt: number;
  presenceOnline: boolean;
  presenceError: string;
  stream: "closed" | "connecting" | "open";
  streamOpenedAt: number;
  lastEventAt: number;
  lastEventType: string;
  envelopes: number;
  checkAt: number;
  checkNote: string;
}

export interface NodeDeps {
  kv: KV;
  secrets: SecretStore;
  fetch?: typeof fetch;
  openStream?: StreamOpener;
  now?: () => number;
}

export function parseBundle(text: string): IdentityBundle {
  let b: Partial<IdentityBundle>;
  try {
    b = JSON.parse(text.trim());
  } catch {
    throw new CommsError("bad_bundle", "pairing bundle must be JSON {machine_id, public_key, alias}");
  }
  if (!b || !validWireID(b.machine_id) || typeof b.public_key !== "string") {
    throw new CommsError("bad_bundle", "pairing bundle needs machine_id and public_key");
  }
  let pub: Uint8Array;
  try {
    pub = fromBase64(b.public_key);
  } catch {
    throw new CommsError("bad_bundle", "public_key is not base64");
  }
  if (!validPublicKey(pub)) throw new CommsError("bad_key", "invalid X25519 public key");
  const alias = typeof b.alias === "string" && ALIAS.test(b.alias) ? b.alias : b.machine_id.slice(0, 12);
  return { machine_id: b.machine_id, public_key: toBase64(pub), alias };
}

type Listener<T> = (v: T) => void;

export class CommsNode {
  private state!: NodeState;
  private keys!: KeyPair;
  private serviceKey = "";
  private broker: BrokerClient | null = null;
  private mutex = new Mutex();
  private inbound = new Mutex();
  private handlers: ((m: InboundMessage) => Promise<void> | void)[] = [];
  private receiptHandlers: ((peer: string, r: Receipt) => void)[] = [];
  private connListeners: Listener<ConnectionState>[] = [];
  private stream: StreamHandle | null = null;
  private running = false;
  private loopPromise: Promise<void> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private presenceTimer: ReturnType<typeof setInterval> | null = null;
  private wakeBackoff: (() => void) | null = null;
  private lastEventAt = 0;
  readonly debug: NodeDebug = {
    authOkAt: 0,
    authError: "",
    presenceAt: 0,
    presenceOnline: false,
    presenceError: "",
    stream: "closed",
    streamOpenedAt: 0,
    lastEventAt: 0,
    lastEventType: "",
    envelopes: 0,
    checkAt: 0,
    checkNote: "",
  };
  private lastProcessedAt = 0;
  connection: ConnectionState = "idle";
  lastError = "";

  private constructor(private deps: NodeDeps) {}

  private now() {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  /** Loads the identity, generating and storing a new one on first run. */
  static async load(deps: NodeDeps): Promise<CommsNode> {
    const n = new CommsNode(deps);
    const secret = await deps.secrets.get(K.secret);
    let state = await readJSON<NodeState | null>(deps.kv, K.state, null);
    if (secret && state) {
      n.keys = keyPairFromSecret(fromBase64(secret));
      if (toBase64(n.keys.publicKey) !== state.public_key) throw new Error("stored comms identity is inconsistent");
    } else {
      n.keys = generateKeyPair();
      state = {
        machine_id: newID("m_"),
        public_key: toBase64(n.keys.publicKey),
        agent_id: newID("a_"),
        alias: APP_ALIAS,
        created_at: Date.now(),
        broker_url: "",
        presence_revision: 0,
        peers: {},
        grants: {},
      };
      await deps.secrets.set(K.secret, toBase64(n.keys.secretKey));
      await writeJSON(deps.kv, K.state, state);
    }
    n.state = state;
    n.serviceKey = (await deps.secrets.get(K.serviceKey)) ?? "";
    n.rebuildBroker();
    return n;
  }

  // ---- identity / config -------------------------------------------------

  get machineId() {
    return this.state.machine_id;
  }
  get agentId() {
    return this.state.agent_id;
  }
  get brokerURL() {
    return this.state.broker_url;
  }
  get hasServiceKey() {
    return this.serviceKey !== "";
  }
  get configured() {
    return this.state.broker_url !== "";
  }

  /** The bundle `comms pair --stdin` takes on a machine. */
  identityBundle(name = "phone"): IdentityBundle {
    return { machine_id: this.state.machine_id, public_key: this.state.public_key, alias: name };
  }

  peers(): PeerRecord[] {
    return Object.values(this.state.peers);
  }
  peer(machineId: string): PeerRecord | undefined {
    return this.state.peers[machineId];
  }
  peerPublicKey(machineId: string): Uint8Array | null {
    const p = this.state.peers[machineId];
    return p ? fromBase64(p.public_key) : null;
  }
  grant(machineId: string): GrantRecord | undefined {
    return this.state.grants[machineId];
  }
  /** Own secret key — for opening encrypted pushes. */
  secretKey(): Uint8Array {
    return this.keys.secretKey;
  }

  private async save() {
    await writeJSON(this.deps.kv, K.state, this.state);
  }

  private rebuildBroker() {
    this.broker = this.state.broker_url
      ? new BrokerClient({
          url: this.state.broker_url,
          serviceKey: this.serviceKey || undefined,
          machineId: this.state.machine_id,
          keys: this.keys,
          fetch: this.deps.fetch,
          openStream: this.deps.openStream,
          onAuth: (ok, err) => {
            if (ok) {
              this.debug.authOkAt = Date.now();
              this.debug.authError = "";
            } else this.debug.authError = err ?? "auth failed";
          },
        })
      : null;
  }

  /** Sets broker URL (and optionally service key) and proves auth works. */
  async configureBroker(url: string, serviceKey?: string): Promise<void> {
    const normalized = url ? normalizeBrokerURL(url) : "";
    const wasRunning = this.running;
    if (wasRunning) await this.stop();
    await this.mutex.run(async () => {
      if (serviceKey !== undefined) {
        this.serviceKey = serviceKey.trim();
        if (this.serviceKey) await this.deps.secrets.set(K.serviceKey, this.serviceKey);
        else await this.deps.secrets.remove(K.serviceKey);
      }
      this.state.broker_url = normalized;
      await this.save();
      this.rebuildBroker();
    });
    if (this.broker) {
      await this.broker.authenticate();
      await this.syncBroker();
    }
    if (wasRunning) this.start();
  }

  /** Pins a machine (out-of-band verified bundle) and grants it messaging. */
  async pair(bundleText: string): Promise<PeerRecord> {
    const b = parseBundle(bundleText);
    if (b.machine_id === this.state.machine_id) throw new CommsError("self_pair", "that is this phone's own bundle");
    const rec = await this.mutex.run(async () => {
      const old = this.state.peers[b.machine_id];
      if (old && old.public_key !== b.public_key) {
        throw new CommsError("key_mismatch", "machine already pinned with a different key — unpair it first");
      }
      const r: PeerRecord = { ...b, paired_at: old?.paired_at ?? Date.now(), agents: old?.agents };
      this.state.peers[b.machine_id] = r;
      await this.save();
      return r;
    });
    // The grant is stored locally first; if the broker is unreachable now it is
    // re-sent by syncBroker on the next connect.
    await this.setGrant(b.machine_id, true).catch(() => undefined);
    return rec;
  }

  async unpair(machineId: string): Promise<void> {
    await this.setGrant(machineId, false).catch(() => undefined);
    await this.mutex.run(async () => {
      delete this.state.peers[machineId];
      await this.save();
    });
  }

  /** Outbound grant: lets that machine message the phone (broker + local check). */
  async setGrant(machineId: string, allow: boolean): Promise<void> {
    const g = await this.mutex.run(async () => {
      const old = this.state.grants[machineId];
      const revision = Math.max(Date.now(), (old?.revision ?? 0) + 1);
      const next = { allow_messages: allow, revision };
      this.state.grants[machineId] = next;
      await this.save();
      return next;
    });
    if (this.broker) {
      await this.broker.putGrant({
        grantee_machine_id: machineId,
        allow_messages: g.allow_messages,
        allow_history: false,
        revision: g.revision,
      });
    }
  }

  // ---- broker sync ------------------------------------------------------

  private async nextPresenceRevision(): Promise<number> {
    return this.mutex.run(async () => {
      const rev = Math.max(Date.now(), this.state.presence_revision + 1);
      this.state.presence_revision = rev;
      await this.save();
      return rev;
    });
  }

  async putPresence(online: boolean): Promise<void> {
    if (!this.broker) return;
    const rev = await this.nextPresenceRevision();
    const me: Presence = {
      machine_id: this.state.machine_id,
      agent_id: this.state.agent_id,
      alias: APP_ALIAS,
      persistent: true,
      online,
      lease_expires_at: 0,
    };
    try {
      await this.broker.putPresence(rev, [me]);
      this.debug.presenceAt = Date.now();
      this.debug.presenceOnline = online;
      this.debug.presenceError = "";
    } catch (e) {
      this.debug.presenceError = e instanceof Error ? e.message : String(e);
      throw e;
    }
  }

  /** Pushes all grants and presence (Go syncBroker). */
  async syncBroker(online = this.connection === "online"): Promise<void> {
    if (!this.broker) return;
    for (const [peer, g] of Object.entries(this.state.grants)) {
      await this.broker.putGrant({
        grantee_machine_id: peer,
        allow_messages: g.allow_messages,
        allow_history: false,
        revision: g.revision,
      });
    }
    await this.putPresence(online);
  }

  async who(): Promise<Presence[]> {
    if (!this.broker) throw new CommsError("broker_not_configured", "configure a broker first", 503);
    const list = await this.broker.who();
    // Learn agent IDs of pinned peers so later sends work without a lookup.
    await this.mutex.run(async () => {
      let dirty = false;
      for (const p of list) {
        const peer = this.state.peers[p.machine_id];
        if (peer && peer.agents?.[p.alias] !== p.agent_id) {
          peer.agents = { ...(peer.agents ?? {}), [p.alias]: p.agent_id };
          dirty = true;
        }
      }
      if (dirty) await this.save();
    });
    return list;
  }

  /** Resolves `alias` on a pinned machine to its immutable agent ID. */
  async resolveAgent(machineId: string, aliasOrId: string, refresh = false): Promise<string> {
    if (/^a_[0-9a-f]{32}$/.test(aliasOrId)) return aliasOrId;
    const peer = this.state.peers[machineId];
    if (!peer) throw new CommsError("unpaired", "machine is not paired", 404);
    const cached = peer.agents?.[aliasOrId];
    if (cached && !refresh) return cached;
    const list = await this.who();
    const hit = list.find((p) => p.machine_id === machineId && p.alias === aliasOrId);
    if (!hit) {
      throw new CommsError(
        "unknown_agent",
        `${peer.alias}:${aliasOrId} not visible — is it running, and did the machine grant this phone?`,
        404
      );
    }
    return hit.agent_id;
  }

  // ---- sending ------------------------------------------------------------

  /** Encrypts and queues a message; returns the message ID. */
  async send(machineId: string, agentAliasOrId: string, body: string): Promise<string> {
    if (utf8Encode(body).length > MAX_BODY) throw new CommsError("message_too_large", "message body exceeds 64 KiB", 413);
    const peerKey = this.peerPublicKey(machineId);
    if (!peerKey) throw new CommsError("unpaired", "machine is not paired", 404);
    if (!this.broker) throw new CommsError("broker_not_configured", "configure a broker first", 503);
    const agent = await this.resolveAgent(machineId, agentAliasOrId);
    const now = this.now();
    const p: Payload = {
      version: 1,
      id: newID("msg_"),
      sender_machine_id: this.state.machine_id,
      recipient_machine_id: machineId,
      kind: "message",
      expires_at: now + MESSAGE_TTL_MS,
      sender_agent_id: this.state.agent_id,
      recipient_agent_id: agent,
      created_at: now,
      body,
    };
    const env = encrypt({ machineId: this.state.machine_id, secretKey: this.keys.secretKey }, { machineId, publicKey: peerKey }, p);
    await this.setSent(p.id, "queued");
    await this.forward(env);
    return p.id;
  }

  private async forward(env: Envelope): Promise<void> {
    try {
      await this.broker!.postEnvelope(env);
      if (env.kind === "message") await this.setSent(env.id, "forwarded");
    } catch (e) {
      const permanent = e instanceof CommsError && [400, 409, 413].includes(e.status);
      if (permanent || (e instanceof CommsError && e.status === 403 && e.code === "message_denied")) {
        if (env.kind === "message") await this.setSent(env.id, "failed");
        throw e;
      }
      await this.enqueueOutbox(env);
    }
  }

  private async enqueueOutbox(env: Envelope) {
    await this.mutex.run(async () => {
      const box = await readJSON<OutboxItem[]>(this.deps.kv, K.outbox, []);
      const key = `${env.kind}/${env.id}`;
      if (!box.some((b) => b.key === key)) {
        const { nonce, ciphertext, ...routing } = env;
        box.push({ key, env: { routing, nonce: toBase64(nonce), ciphertext: toBase64(ciphertext) }, tries: 0 });
        await writeJSON(this.deps.kv, K.outbox, box.slice(-500));
      }
    });
  }

  /** Retries queued envelopes; drops expired ones. */
  async flushOutbox(): Promise<void> {
    if (!this.broker) return;
    const box = await readJSON<OutboxItem[]>(this.deps.kv, K.outbox, []);
    if (!box.length) return;
    const keep: OutboxItem[] = [];
    for (const item of box) {
      if (item.env.routing.expires_at <= this.now()) continue;
      const env: Envelope = { ...item.env.routing, nonce: fromBase64(item.env.nonce), ciphertext: fromBase64(item.env.ciphertext) };
      try {
        await this.broker.postEnvelope(env);
        if (env.kind === "message") await this.setSent(env.id, "forwarded");
      } catch (e) {
        const permanent = e instanceof CommsError && [400, 403, 409, 413].includes(e.status);
        if (!permanent) keep.push({ ...item, tries: item.tries + 1 });
        else if (env.kind === "message") await this.setSent(env.id, "failed");
      }
    }
    await this.mutex.run(async () => {
      const current = await readJSON<OutboxItem[]>(this.deps.kv, K.outbox, []);
      const sentKeys = new Set(box.map((b) => b.key));
      const added = current.filter((c) => !sentKeys.has(c.key));
      await writeJSON(this.deps.kv, K.outbox, [...keep, ...added]);
    });
  }

  private async setSent(id: string, state: SentState) {
    await this.mutex.run(async () => {
      const sent = await readJSON<Record<string, { s: SentState; t: number }>>(this.deps.kv, K.sent, {});
      sent[id] = { s: state, t: this.now() };
      const entries = Object.entries(sent).sort((a, b) => b[1].t - a[1].t).slice(0, 300);
      await writeJSON(this.deps.kv, K.sent, Object.fromEntries(entries));
    });
  }

  async sentState(id: string): Promise<SentState | undefined> {
    const sent = await readJSON<Record<string, { s: SentState }>>(this.deps.kv, K.sent, {});
    return sent[id]?.s;
  }

  // ---- receiving ----------------------------------------------------------

  onMessage(h: (m: InboundMessage) => Promise<void> | void): () => void {
    this.handlers.push(h);
    return () => {
      this.handlers = this.handlers.filter((x) => x !== h);
    };
  }
  onReceipt(h: (peer: string, r: Receipt) => void): () => void {
    this.receiptHandlers.push(h);
    return () => {
      this.receiptHandlers = this.receiptHandlers.filter((x) => x !== h);
    };
  }
  onConnection(l: Listener<ConnectionState>): () => void {
    this.connListeners.push(l);
    return () => {
      this.connListeners = this.connListeners.filter((x) => x !== l);
    };
  }
  private setConnection(c: ConnectionState, err = "") {
    this.connection = c;
    if (err) this.lastError = err;
    if (c === "online") this.lastError = "";
    for (const l of this.connListeners) l(c);
  }

  private async seen(key: string): Promise<boolean> {
    const seen = await readJSON<Record<string, number>>(this.deps.kv, K.seen, {});
    return key in seen;
  }
  private async markSeen(key: string) {
    await this.mutex.run(async () => {
      const seen = await readJSON<Record<string, number>>(this.deps.kv, K.seen, {});
      seen[key] = this.now();
      const cutoff = this.now() - MESSAGE_TTL_MS - 86_400_000;
      const entries = Object.entries(seen).filter(([, t]) => t > cutoff).sort((a, b) => b[1] - a[1]).slice(0, 3000);
      await writeJSON(this.deps.kv, K.seen, Object.fromEntries(entries));
    });
  }

  private async sendReceipt(orig: Payload, status: Receipt["status"], failure = "") {
    const peerKey = this.peerPublicKey(orig.sender_machine_id);
    if (!peerKey || !this.broker) return;
    const now = this.now();
    const r: Receipt = { original_id: orig.id, status, at: now, ...(failure ? { failure_code: failure } : {}) };
    const p: Payload = {
      version: 1,
      id: receiptID(orig.sender_machine_id, orig.id, status),
      sender_machine_id: this.state.machine_id,
      recipient_machine_id: orig.sender_machine_id,
      kind: "receipt",
      expires_at: now + MESSAGE_TTL_MS,
      sender_agent_id: orig.recipient_agent_id,
      recipient_agent_id: orig.sender_agent_id,
      created_at: now,
      receipt: r,
    };
    const env = encrypt(
      { machineId: this.state.machine_id, secretKey: this.keys.secretKey },
      { machineId: orig.sender_machine_id, publicKey: peerKey },
      p
    );
    await this.forward(env).catch(() => undefined);
  }

  /** acceptEnvelope: verify, dedupe, hand to handlers, receipt, then ack. */
  async acceptEnvelope(env: Envelope): Promise<void> {
    const ack = () => this.broker!.ack(env.sender_machine_id, env.id).catch(() => undefined);
    const peerKey = this.peerPublicKey(env.sender_machine_id);
    if (!peerKey) return void (await ack()); // unpaired sender: discard
    let p: Payload;
    try {
      p = decrypt(
        { machineId: this.state.machine_id, secretKey: this.keys.secretKey },
        { machineId: env.sender_machine_id, publicKey: peerKey },
        env,
        this.now()
      );
    } catch {
      return void (await ack());
    }
    if (p.kind === "receipt") {
      const r = p.receipt!;
      const sent = await this.sentState(r.original_id);
      if (sent !== undefined && sent !== "handed_off") await this.setSent(r.original_id, r.status);
      for (const h of this.receiptHandlers) h(p.sender_machine_id, r);
      return void (await ack());
    }
    const key = `${p.sender_machine_id}/${p.id}`;
    if (p.recipient_agent_id !== this.state.agent_id) {
      await this.sendReceipt(p, "undeliverable", "agent_ended");
      return void (await ack());
    }
    if (!this.state.grants[p.sender_machine_id]?.allow_messages) {
      await this.sendReceipt(p, "undeliverable", "grant_revoked");
      return void (await ack());
    }
    if (await this.seen(key)) {
      // Replay after a lost ack: the receipt is idempotent by ID.
      await this.sendReceipt(p, "handed_off");
      return void (await ack());
    }
    const msg: InboundMessage = {
      id: p.id,
      fromMachine: p.sender_machine_id,
      fromAgent: p.sender_agent_id,
      peerAlias: this.state.peers[p.sender_machine_id]?.alias ?? p.sender_machine_id,
      body: p.body ?? "",
      createdAt: p.created_at,
    };
    for (const h of this.handlers) {
      try {
        await h(msg);
      } catch {
        // A handler failure must not wedge the queue; the message is still ours.
      }
    }
    await this.markSeen(key);
    await this.sendReceipt(p, "handed_off");
    await ack();
    this.lastProcessedAt = Date.now();
  }

  private handleEvent = (ev: StreamEvent) => {
    this.lastEventAt = Date.now();
    this.debug.lastEventAt = this.lastEventAt;
    this.debug.lastEventType = ev.type;
    if (ev.type === "envelope") this.debug.envelopes++;
    if (ev.type === "envelope" && ev.envelope) {
      let env: Envelope;
      try {
        env = fromWire(ev.envelope);
      } catch {
        return;
      }
      void this.inbound.run(() => this.acceptEnvelope(env));
    }
  };

  // ---- connection lifecycle ------------------------------------------------

  /** Keeps a receive stream open (foreground). Reconnects with backoff. */
  start(): void {
    if (this.running || !this.broker) return;
    this.running = true;
    this.loopPromise = this.loop();
  }

  private async loop() {
    let backoff = 1000;
    // Presence lease renewal runs on its own clock, like the Go brokerLoop
    // (syncBroker every Heartbeat): the broker drops a stream whose machine
    // lease (60 s) lapses, and lists the agent online only while it is fresh.
    const renew = () => void this.putPresence(this.connection === "online").catch(() => undefined);
    this.presenceTimer = setInterval(renew, HEARTBEAT_MS);
    renew();
    while (this.running && this.broker) {
      this.setConnection("connecting");
      this.debug.stream = "connecting";
      try {
        let opened = false;
        const startedAt = Date.now();
        const handle = await this.broker.openStream(this.handleEvent, () => {
          opened = true;
          this.lastEventAt = Date.now();
          this.debug.stream = "open";
          this.debug.streamOpenedAt = this.lastEventAt;
          this.setConnection("online");
          backoff = 1000;
          void this.syncBroker(true).catch(() => undefined);
          void this.flushOutbox().catch(() => undefined);
        });
        this.stream = handle;
        this.lastEventAt = Date.now();
        // Watchdog: delivery must never hinge on a stream that silently stalls
        // (headers withheld by a proxy/interceptor, half-open TCP).
        this.watchdog = setInterval(() => {
          const now = Date.now();
          this.debug.checkAt = now;
          if (!opened && now - startedAt > OPEN_TIMEOUT_MS) {
            this.debug.checkNote = "no stream headers in 20s, reconnecting";
            handle.abort();
          } else if (opened && now - this.lastEventAt > SILENT_MS) {
            this.debug.checkNote = "stream silent 45s, reconnecting";
            handle.abort();
          } else this.debug.checkNote = opened ? "ok" : "waiting for headers";
        }, Math.min(HEARTBEAT_MS, OPEN_TIMEOUT_MS / 2));
        await handle.done;
        if (this.running) this.setConnection("offline", opened ? "stream closed" : "stream never opened");
      } catch (e) {
        this.setConnection("error", e instanceof Error ? e.message : String(e));
      } finally {
        if (this.watchdog) clearInterval(this.watchdog);
        this.watchdog = null;
        this.stream = null;
        this.debug.stream = "closed";
      }
      if (!this.running) break;
      await new Promise<void>((r) => {
        const t = setTimeout(r, backoff);
        this.wakeBackoff = () => {
          clearTimeout(t);
          r();
        };
      });
      this.wakeBackoff = null;
      backoff = Math.min(backoff * 2, HEARTBEAT_MS);
    }
    if (this.presenceTimer) clearInterval(this.presenceTimer);
    this.presenceTimer = null;
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.stream?.abort();
    this.wakeBackoff?.();
    await this.loopPromise?.catch(() => undefined);
    await this.inbound.run(async () => undefined);
    this.setConnection("idle");
    await this.putPresence(false).catch(() => undefined);
  }

  get isRunning() {
    return this.running;
  }

  /**
   * Fetch what the broker queued while we were away: open the stream, let it
   * replay unacknowledged items, close once quiet (or at maxMs).
   */
  async drain(opts: { quietMs?: number; maxMs?: number } = {}): Promise<void> {
    if (!this.broker || this.running) return;
    const quiet = opts.quietMs ?? 1500;
    const max = opts.maxMs ?? 10_000;
    const started = Date.now();
    this.lastProcessedAt = started;
    let opened = false;
    const handle = await this.broker.openStream(this.handleEvent, () => {
      opened = true;
      void this.flushOutbox().catch(() => undefined);
    });
    try {
      while (Date.now() - started < max) {
        await Promise.race([handle.done, new Promise((r) => setTimeout(r, 200))]);
        const idle = Date.now() - Math.max(this.lastProcessedAt, this.lastEventAt, started);
        if (opened && idle > quiet) break;
      }
    } finally {
      handle.abort();
      await handle.done.catch(() => undefined);
      await this.inbound.run(async () => undefined);
    }
  }
}
