// Encrypted porter pushes: {porter:"1", from, box}, box = base64(nonce||nacl.box)
// from the sending machine's key to the phone's. Pure functions — the RN task
// wiring lives in porter/pushTask.ts.
import { fromBase64, utf8Decode } from "../comms/bytes";
import { openNonceBox } from "../comms/crypto";
import type { PushPlain } from "./types";

export interface PorterPushData {
  porter: "1";
  from: string;
  box: string;
}

function asPorter(v: unknown): PorterPushData | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.porter === "1" && typeof o.from === "string" && typeof o.box === "string") {
    return { porter: "1", from: o.from, box: o.box };
  }
  return null;
}

function tryParse(s: unknown): unknown {
  if (typeof s !== "string") return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * Finds the porter data in whatever shape expo-notifications hands over:
 * task payload `{data: {dataString | body | ...fields}}`, a Notification
 * (`request.content.data`), or the raw data object.
 */
export function extractPorterData(input: unknown): PorterPushData | null {
  const seen = new Set<unknown>();
  const queue: unknown[] = [input];
  while (queue.length) {
    const v = queue.shift();
    if (!v || typeof v !== "object" || seen.has(v)) continue;
    seen.add(v);
    const hit = asPorter(v);
    if (hit) return hit;
    const o = v as Record<string, unknown>;
    for (const k of ["data", "dataString", "body", "notification", "request", "content", "trigger", "remoteMessage", "payload"]) {
      const child = o[k];
      if (typeof child === "string") queue.push(tryParse(child));
      else if (child && typeof child === "object") queue.push(child);
    }
  }
  return null;
}

/** Opens the box with the pinned key of `from`. Null on any failure (drop it). */
export function openPorterPush(
  data: PorterPushData,
  peerPublicKey: (machineId: string) => Uint8Array | null,
  ownSecret: Uint8Array
): PushPlain | null {
  const pub = peerPublicKey(data.from);
  if (!pub) return null;
  let sealed: Uint8Array;
  try {
    sealed = fromBase64(data.box);
  } catch {
    return null;
  }
  const plain = openNonceBox(sealed, pub, ownSecret);
  if (!plain) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(utf8Decode(plain));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  if (obj.kind === "notify" && obj.notify && typeof obj.notify === "object") return obj as PushPlain;
  if (obj.kind === "wake") return obj as PushPlain;
  // v1 "agent", or pre-v1 pushes without kind.
  if ((obj.kind === "agent" || obj.kind === undefined) && typeof obj.agent === "string" && typeof obj.status === "string") {
    return { ...(obj as object), kind: "agent" } as PushPlain;
  }
  return null;
}
