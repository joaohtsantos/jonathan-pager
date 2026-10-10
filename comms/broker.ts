// Broker HTTP client — port of internal/comms/broker_client.go (auth, presence,
// grants, who, messages, receipts, acks, stream). See docs/BROKER-CONTRACT.md.
import { fromBase64, toBase64, utf8Decode, equalBytes } from "./bytes";
import { openAnonymous, type KeyPair } from "./crypto";
import { CommsError, marshalEnvelope, type Envelope, type WireEnvelope } from "./envelope";
import { defaultStreamOpener, HTTPStatusError, type StreamHandle, type StreamOpener } from "./stream";

export const SERVICE_KEY_HEADER = "X-Comms-Service-Key";

export interface Presence {
  machine_id: string;
  peer_alias?: string;
  agent_id: string;
  alias: string;
  persistent: boolean;
  online: boolean;
  lease_expires_at: number;
}

export interface Grant {
  grantee_machine_id: string;
  allow_messages: boolean;
  allow_history: boolean;
  revision: number;
}

export type StreamEvent =
  | { type: "envelope"; envelope: WireEnvelope }
  | { type: "heartbeat" }
  | { type: "history_query"; query: unknown };

export interface BrokerOptions {
  url: string;
  serviceKey?: string;
  machineId: string;
  keys: KeyPair;
  fetch?: typeof fetch;
  openStream?: StreamOpener;
  userAgent?: string;
  /** Observes every challenge-auth outcome (debug status line). */
  onAuth?: (ok: boolean, error?: string) => void;
}

/**
 * Accept header for GET /v1/stream. It must START with text/event-stream:
 * the Expo dev-client injects an OkHttp network interceptor
 * (ExpoNetworkInspectOkHttpNetworkInterceptor) that peeks up to 1 MiB of every
 * response body before handing the response on, and it only skips that for
 * text/event-stream (by Content-Type or request Accept) or a chunked
 * Transfer-Encoding. Over HTTP/2 (Cloudflare) there is no chunked header, so
 * the NDJSON stream's headers never reach the XHR: no events, no presence.
 * The broker ignores Accept, so this is purely a client-side opt-out.
 */
export const STREAM_ACCEPT = "text/event-stream, application/x-ndjson";

export function normalizeBrokerURL(raw: string): string {
  const url = raw.trim().replace(/\/+$/, "");
  const m = /^(https?):\/\/([^/?#@]+)$/.exec(url);
  if (!m) throw new CommsError("bad_broker_url", "broker URL must be an origin like https://host[:port]");
  const host = m[2].replace(/:\d+$/, "");
  if (m[1] === "http" && !(host === "localhost" || host === "127.0.0.1" || host === "[::1]" || /^10\.|^192\.168\./.test(host))) {
    throw new CommsError("https_required", "remote brokers require HTTPS");
  }
  return url;
}

export class BrokerClient {
  readonly url: string;
  private token = "";
  private tokenExpiry = 0;
  private authing: Promise<string> | null = null;
  private fetchImpl: typeof fetch;
  private opener: StreamOpener;

  constructor(private opts: BrokerOptions) {
    this.url = normalizeBrokerURL(opts.url);
    this.fetchImpl = opts.fetch ?? ((...a) => fetch(...a));
    this.opener = opts.openStream ?? defaultStreamOpener();
  }

  private headers(token: string, json: boolean): Record<string, string> {
    const h: Record<string, string> = { Accept: "application/json" };
    if (this.opts.userAgent) h["User-Agent"] = this.opts.userAgent;
    if (this.opts.serviceKey) h[SERVICE_KEY_HEADER] = this.opts.serviceKey;
    if (json) h["Content-Type"] = "application/json";
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }

  private async raw<T>(token: string, method: string, path: string, body?: string): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.url + path, {
        method,
        headers: this.headers(token, body !== undefined),
        body,
      });
    } catch (e) {
      throw new CommsError("broker_unavailable", `broker request failed: ${String(e)}`, 503);
    }
    const text = await res.text();
    if (res.status < 200 || res.status >= 300) {
      let code = "broker_error";
      let msg = `HTTP ${res.status}`;
      try {
        const j = JSON.parse(text);
        code = j.code ?? code;
        msg = j.error ?? msg;
      } catch {}
      throw new CommsError(code, msg, res.status);
    }
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new CommsError("bad_broker_response", "invalid broker JSON response", 502);
    }
  }

  /** Challenge → open anonymous box → verify binding → complete → bearer token. */
  async authenticate(): Promise<string> {
    try {
      const token = await this.authenticateOnce();
      this.opts.onAuth?.(true);
      return token;
    } catch (e) {
      this.opts.onAuth?.(false, e instanceof Error ? e.message : String(e));
      throw e;
    }
  }

  private async authenticateOnce(): Promise<string> {
    const { machineId, keys } = this.opts;
    const start = await this.raw<{ id: string; sealed: string }>(
      "",
      "POST",
      "/v1/auth/challenges",
      JSON.stringify({ machine_id: machineId, public_key: toBase64(keys.publicKey) })
    );
    const sealed = fromBase64(start.sealed ?? "");
    if (sealed.length > 8192) throw new CommsError("bad_challenge", "challenge exceeds limit", 502);
    const plain = openAnonymous(sealed, keys);
    if (!plain) throw new CommsError("bad_challenge", "challenge authentication failed", 403);
    const c = JSON.parse(utf8Decode(plain)) as {
      purpose: string;
      id: string;
      machine_id: string;
      public_key: string;
      secret: string;
      expires_at: number;
    };
    const now = Date.now();
    if (
      c.purpose !== "comms-auth-v1" ||
      c.id !== start.id ||
      c.machine_id !== machineId ||
      !equalBytes(fromBase64(c.public_key ?? ""), keys.publicKey) ||
      !(c.expires_at > now) ||
      c.expires_at > now + 2 * 60_000 ||
      typeof c.secret !== "string" ||
      c.secret.length < 32 ||
      c.secret.length > 128
    ) {
      throw new CommsError("bad_challenge", "challenge purpose/identity/deadline mismatch", 403);
    }
    const r = await this.raw<{ token: string; expires_at: number }>(
      "",
      "POST",
      "/v1/auth/complete",
      JSON.stringify({ id: start.id, proof: c.secret })
    );
    if (!r || typeof r.token !== "string" || r.token.length < 32 || !(r.expires_at > Date.now())) {
      throw new CommsError("bad_credential", "invalid broker credential", 502);
    }
    this.token = r.token;
    this.tokenExpiry = r.expires_at;
    return r.token;
  }

  async credential(): Promise<string> {
    if (this.token && this.tokenExpiry > Date.now() + 60_000) return this.token;
    if (!this.authing) {
      this.authing = this.authenticate().finally(() => {
        this.authing = null;
      });
    }
    return this.authing;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await this.credential();
    const payload = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
    try {
      return await this.raw<T>(token, method, path, payload);
    } catch (e) {
      if (e instanceof CommsError && e.status === 401 && this.token === token) {
        this.token = "";
        this.tokenExpiry = 0;
        const fresh = await this.credential();
        return this.raw<T>(fresh, method, path, payload);
      }
      throw e;
    }
  }

  putPresence(revision: number, agents: Presence[]) {
    return this.request<{ ok: boolean; lease_expires_at: number }>("PUT", "/v1/presence", { revision, agents });
  }

  putGrant(g: Grant) {
    return this.request<Grant>("PUT", `/v1/grants/${encodeURIComponent(g.grantee_machine_id)}`, g);
  }

  who() {
    return this.request<Presence[]>("GET", "/v1/who");
  }

  /** Envelopes are sent as Go-marshalled JSON (same bytes a Go node would send). */
  postEnvelope(env: Envelope) {
    const path = env.kind === "receipt" ? "/v1/receipts" : "/v1/messages";
    return this.request<{ id: string; state: string; duplicate?: boolean }>("POST", path, marshalEnvelope(env));
  }

  ack(senderMachineId: string, id: string) {
    return this.request<unknown>("POST", "/v1/acks", { sender_machine_id: senderMachineId, id });
  }

  /** Opens the receive stream. onEvent runs for every NDJSON event. */
  async openStream(onEvent: (ev: StreamEvent) => void, onOpen?: () => void): Promise<StreamHandle> {
    const token = await this.credential();
    const handle = this.opener({
      url: this.url + "/v1/stream",
      headers: { ...this.headers(token, false), Accept: STREAM_ACCEPT },
      onOpen,
      onLine: (line) => {
        try {
          onEvent(JSON.parse(line) as StreamEvent);
        } catch {
          // malformed line: ignore, the broker replays unacked work
        }
      },
    });
    handle.done.catch((e) => {
      if (e instanceof HTTPStatusError && e.status === 401 && this.token === token) {
        this.token = "";
        this.tokenExpiry = 0;
      }
    });
    return handle;
  }
}
