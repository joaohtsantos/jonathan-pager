// Round-trips against vectors produced by the Go comms code (generator:
// vectors/gen/main.go). Byte-identical ciphertext proves both the JSON encoding
// and the NaCl box match the Go node.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fromBase64, toBase64, utf8Decode } from "../bytes";
import { generateKeyPair, keyPairFromSecret, openAnonymous, openNonceBox, validPublicKey, newID } from "../crypto";
import { decrypt, encrypt, fromWire, marshalEnvelope, marshalPayload, receiptID, type Payload } from "../envelope";
import { goMarshal } from "../gojson";

const V = JSON.parse(readFileSync(join(__dirname, "vectors/go-vectors.json"), "utf8"));
const phone = { machineId: V.phone.machine_id, publicKey: fromBase64(V.phone.public_key), secretKey: fromBase64(V.phone.private_key) };
const mac = { machineId: V.mac.machine_id, publicKey: fromBase64(V.mac.public_key), secretKey: fromBase64(V.mac.private_key) };
const nonce = fromBase64(V.nonce);

describe("keys", () => {
  it("derives the same public key as Go box.GenerateKey", () => {
    expect(toBase64(keyPairFromSecret(phone.secretKey).publicKey)).toBe(V.phone.public_key);
    expect(toBase64(keyPairFromSecret(mac.secretKey).publicKey)).toBe(V.mac.public_key);
  });
  it("rejects low-order keys", () => {
    expect(validPublicKey(new Uint8Array(32))).toBe(false);
    expect(validPublicKey(generateKeyPair().publicKey)).toBe(true);
  });
  it("makes Go-shaped IDs", () => {
    expect(newID("m_")).toMatch(/^m_[0-9a-f]{32}$/);
  });
});

describe("envelope", () => {
  it("marshals payloads byte-identically to Go", () => {
    expect(marshalPayload(JSON.parse(V.message_payload))).toBe(V.message_payload);
    expect(marshalPayload(JSON.parse(V.receipt_payload))).toBe(V.receipt_payload);
    expect(marshalPayload(JSON.parse(V.incoming_payload))).toBe(V.incoming_payload);
  });

  it("encrypts a message to the exact Go envelope bytes", () => {
    const p: Payload = JSON.parse(V.message_payload);
    expect(marshalEnvelope(encrypt(phone, mac, p, nonce))).toBe(V.message_envelope);
  });

  it("encrypts a receipt to the exact Go envelope bytes", () => {
    const p: Payload = JSON.parse(V.receipt_payload);
    expect(receiptID(mac.machineId, "msg_x1", "handed_off")).toBe(V.receipt_id);
    expect(marshalEnvelope(encrypt(phone, mac, p, nonce))).toBe(V.receipt_envelope);
  });

  it("decrypts a Go comms.Encrypt envelope", () => {
    const env = fromWire(JSON.parse(V.incoming_envelope));
    const p = decrypt(phone, mac, env, V.now);
    expect(p).toEqual(JSON.parse(V.incoming_payload));
    expect(JSON.parse(p.body!).note).toBe("olá <b>");
  });

  it("rejects tampering, wrong peers and expiry", () => {
    const env = fromWire(JSON.parse(V.incoming_envelope));
    const bad = { ...env, ciphertext: env.ciphertext.slice() };
    bad.ciphertext[5] ^= 1;
    expect(() => decrypt(phone, mac, bad, V.now)).toThrow(/authentication/);
    expect(() => decrypt(phone, { ...mac, publicKey: generateKeyPair().publicKey }, env, V.now)).toThrow();
    expect(() => decrypt(phone, mac, { ...env, id: "msg_other" }, V.now)).toThrow(/routing/);
    expect(() => decrypt(phone, mac, env, env.expires_at + 1)).toThrow(/expired/);
  });

  it("round-trips TS → TS", () => {
    const p: Payload = { version: 1, id: "msg_1", sender_machine_id: mac.machineId, recipient_machine_id: phone.machineId, kind: "message", expires_at: V.now + 1000, sender_agent_id: "a_x", recipient_agent_id: "a_y", created_at: V.now, body: "hi" };
    expect(decrypt(phone, mac, encrypt(mac, phone, p), V.now)).toEqual(p);
  });
});

describe("sealed box + push", () => {
  it("opens a Go box.SealAnonymous auth challenge", () => {
    const plain = openAnonymous(fromBase64(V.challenge_sealed), phone);
    expect(plain).not.toBeNull();
    expect(utf8Decode(plain!)).toBe(V.challenge_plain);
  });
  it("opens a Go porter.PushData box", () => {
    const plain = openNonceBox(fromBase64(V.push.box), mac.publicKey, phone.secretKey);
    expect(JSON.parse(utf8Decode(plain!))).toMatchObject({ machine: "mac", status: "needs_you", needs: { kind: "permission" } });
  });
});

describe("gojson", () => {
  it("escapes like Go", () => {
    expect(goMarshal({ a: "<&> ", b: undefined, c: [1, true] })).toBe('{"a":"\\u003c\\u0026\\u003e\\u2028","c":[1,true]}');
  });
});

// Optional: when the scratch Go helper is built, have the real comms.Decrypt
// open a freshly TS-encrypted envelope. Set COMMS_VECTORS_BIN to its path.
const bin = process.env.COMMS_VECTORS_BIN;
describe.skipIf(!bin || !existsSync(bin))("Go comms.Decrypt opens TS envelopes", () => {
  it("accepts a message and a receipt", () => {
    for (const kind of ["message", "receipt"] as const) {
      const now = Date.now();
      const p: Payload = {
        version: 1, id: kind === "message" ? newID("msg_") : receiptID(mac.machineId, "msg_q", "handed_off"),
        sender_machine_id: phone.machineId, recipient_machine_id: mac.machineId, kind,
        expires_at: now + 3600_000, sender_agent_id: "a_11111111111111111111111111111111",
        recipient_agent_id: "a_22222222222222222222222222222222", created_at: now,
        ...(kind === "message" ? { body: '{"type":"porter.answer","v":1,"id":"ntf_1","choice":"Allow ✓ <ok>"}' } : { receipt: { original_id: "msg_q", status: "handed_off" as const, at: now } }),
      };
      const env = JSON.parse(marshalEnvelope(encrypt(phone, mac, p)));
      const out = execFileSync(bin!, ["verify"], {
        input: JSON.stringify({ recipient_private_key: V.mac.private_key, recipient_public_key: V.mac.public_key, recipient_machine_id: mac.machineId, sender_public_key: V.phone.public_key, sender_machine_id: phone.machineId, envelope: env }),
      }).toString();
      const res = JSON.parse(out);
      expect(res.ok, out).toBe(true);
      expect(res.payload.id).toBe(p.id);
    }
  });
});
