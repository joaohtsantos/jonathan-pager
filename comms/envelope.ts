// Port of comms' encrypted envelope (internal/comms/crypto.go + types.go).
// Wire: Envelope = Routing fields + base64 nonce + base64 ciphertext; the
// ciphertext is nacl.box(json(Payload)) where Payload = Routing + agents +
// created_at + body|receipt. Go decodes the payload with DisallowUnknownFields,
// so the field set and order below must stay exactly as in Go.
import { sha256 } from "@noble/hashes/sha256";
import { boxOpen, boxSeal, randomBytes } from "./crypto";
import { fromBase64, toBase64, toHex, utf8Decode, utf8Encode } from "./bytes";
import { goMarshal } from "./gojson";

export const PROTOCOL_VERSION = 1;
export const MESSAGE_TTL_MS = 7 * 24 * 3600 * 1000;
export const MAX_BODY = 64 << 10;
export const MAX_WIRE = 768 << 10;

export type Kind = "message" | "receipt";

export interface Routing {
  version: number;
  id: string;
  sender_machine_id: string;
  recipient_machine_id: string;
  kind: Kind;
  expires_at: number;
}

export interface Receipt {
  original_id: string;
  status: "received" | "handed_off" | "undeliverable" | "expired" | "uncertain";
  at: number;
  failure_code?: string;
}

export interface Payload extends Routing {
  sender_agent_id: string;
  recipient_agent_id: string;
  created_at: number;
  body?: string;
  receipt?: Receipt;
}

export interface Envelope extends Routing {
  nonce: Uint8Array;
  ciphertext: Uint8Array;
}

/** JSON shape on the wire (byte slices as base64). */
export interface WireEnvelope extends Routing {
  nonce: string;
  ciphertext: string;
}

export class CommsError extends Error {
  constructor(public code: string, message: string, public status = 0) {
    super(message);
  }
}

const WIRE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
export const validWireID = (s: unknown): s is string => typeof s === "string" && WIRE_ID.test(s);

const RECEIPT_FAILURES = new Set([
  "", "agent_ended", "grant_revoked", "local_only", "expired", "receiver_output_failed",
  "receiver_disconnected", "receiver_disconnected_during_handoff", "node_restarted_during_handoff",
  "node_stopped_during_handoff", "node_stopping", "handoff_timeout", "adapter_error",
  "operator_cancelled", "operator_confirmed",
]);

function routingFields(r: Routing): Routing {
  return {
    version: r.version,
    id: r.id,
    sender_machine_id: r.sender_machine_id,
    recipient_machine_id: r.recipient_machine_id,
    kind: r.kind,
    expires_at: r.expires_at,
  };
}

/** Go json.Marshal(Payload) — field order and omitempty preserved. */
export function marshalPayload(p: Payload): string {
  const receipt = p.receipt
    ? {
        original_id: p.receipt.original_id,
        status: p.receipt.status,
        at: p.receipt.at,
        failure_code: p.receipt.failure_code ? p.receipt.failure_code : undefined,
      }
    : undefined;
  return goMarshal({
    ...routingFields(p),
    sender_agent_id: p.sender_agent_id,
    recipient_agent_id: p.recipient_agent_id,
    created_at: p.created_at,
    body: p.body ? p.body : undefined,
    receipt,
  });
}

export function marshalEnvelope(e: Envelope): string {
  return goMarshal({ ...routingFields(e), nonce: toBase64(e.nonce), ciphertext: toBase64(e.ciphertext) });
}

export function toWire(e: Envelope): WireEnvelope {
  return { ...routingFields(e), nonce: toBase64(e.nonce), ciphertext: toBase64(e.ciphertext) };
}

export function fromWire(w: WireEnvelope): Envelope {
  return { ...routingFields(w), nonce: fromBase64(w.nonce ?? ""), ciphertext: fromBase64(w.ciphertext ?? "") };
}

export function validateRouting(r: Routing, now = Date.now()): void {
  if (
    r.version !== PROTOCOL_VERSION ||
    !validWireID(r.id) ||
    r.id.length > 80 ||
    !validWireID(r.sender_machine_id) ||
    !validWireID(r.recipient_machine_id)
  ) {
    throw new CommsError("bad_envelope", "invalid routing", 400);
  }
  if (r.kind !== "message" && r.kind !== "receipt") {
    throw new CommsError("bad_kind", "only message and receipt envelopes are supported", 400);
  }
  if (typeof r.expires_at !== "number" || r.expires_at <= now) {
    throw new CommsError("expired", "envelope expired", 410);
  }
  if (r.expires_at > now + MESSAGE_TTL_MS + 60_000) {
    throw new CommsError("bad_expiry", "expiry exceeds seven days", 400);
  }
}

export interface Keys {
  machineId: string;
  secretKey: Uint8Array;
}
export interface PeerKey {
  machineId: string;
  publicKey: Uint8Array;
}

/** comms.Encrypt. `nonce` is only for deterministic tests. */
export function encrypt(own: Keys, peer: PeerKey, p: Payload, nonce?: Uint8Array): Envelope {
  if (p.sender_machine_id !== own.machineId || p.recipient_machine_id !== peer.machineId) {
    throw new CommsError("identity_mismatch", "identity mismatch");
  }
  const n = nonce ?? randomBytes(24);
  const plain = utf8Encode(marshalPayload(p));
  return { ...routingFields(p), nonce: n, ciphertext: boxSeal(plain, n, peer.publicKey, own.secretKey) };
}

const PAYLOAD_KEYS = new Set([
  "version", "id", "sender_machine_id", "recipient_machine_id", "kind", "expires_at",
  "sender_agent_id", "recipient_agent_id", "created_at", "body", "receipt",
]);
const RECEIPT_KEYS = new Set(["original_id", "status", "at", "failure_code"]);

/** comms.Decrypt with the same validation the Go node applies. */
export function decrypt(own: Keys, peer: PeerKey, env: Envelope, now = Date.now()): Payload {
  validateRouting(env, now);
  if (env.sender_machine_id !== peer.machineId || env.recipient_machine_id !== own.machineId) {
    throw new CommsError("wrong_identity", "envelope does not match pinned identities", 403);
  }
  if (env.nonce.length !== 24 || env.ciphertext.length > MAX_WIRE) {
    throw new CommsError("bad_ciphertext", "invalid ciphertext size", 400);
  }
  const plain = boxOpen(env.ciphertext, env.nonce, peer.publicKey, own.secretKey);
  if (!plain) throw new CommsError("authentication_failed", "ciphertext authentication failed", 403);
  let p: Payload;
  try {
    p = JSON.parse(utf8Decode(plain));
  } catch {
    throw new CommsError("bad_payload", "invalid encrypted payload", 400);
  }
  if (!p || typeof p !== "object" || Array.isArray(p) || Object.keys(p).some((k) => !PAYLOAD_KEYS.has(k))) {
    throw new CommsError("bad_payload", "invalid encrypted payload", 400);
  }
  if (p.receipt && Object.keys(p.receipt).some((k) => !RECEIPT_KEYS.has(k))) {
    throw new CommsError("bad_payload", "invalid encrypted payload", 400);
  }
  const r = routingFields(p);
  const e = routingFields(env);
  if ((Object.keys(e) as (keyof Routing)[]).some((k) => r[k] !== e[k])) {
    throw new CommsError("routing_tampered", "authenticated routing differs from envelope", 403);
  }
  if (
    p.kind === "message" &&
    (utf8Encode(p.body ?? "").length > MAX_BODY ||
      !validWireID(p.sender_agent_id) ||
      !validWireID(p.recipient_agent_id) ||
      p.receipt != null)
  ) {
    throw new CommsError("bad_payload", "invalid message payload", 400);
  }
  if (p.kind === "receipt" && (p.receipt == null || (p.body ?? "") !== "" || plain.length > 4096)) {
    throw new CommsError("bad_receipt", "invalid receipt payload", 400);
  }
  if (p.kind === "receipt" && !RECEIPT_FAILURES.has(p.receipt!.failure_code ?? "")) {
    throw new CommsError("bad_receipt", "receipt failure reason must be a fixed protocol code", 400);
  }
  return p;
}

/** Store.receiptTx: stable per-outcome receipt ID. */
export function receiptID(originalSender: string, originalID: string, status: string): string {
  return "r_" + toHex(sha256(utf8Encode(`${originalSender}/${originalID}/${status}`))).slice(0, 32);
}
