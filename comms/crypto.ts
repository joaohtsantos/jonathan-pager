// NaCl primitives used by comms: X25519 identities, authenticated box, and
// anonymous sealed-box opening (libsodium crypto_box_seal_open / Go
// box.OpenAnonymous). tweetnacl supplies box; blake2b derives the sealed-box nonce.
import nacl from "tweetnacl";
import { blake2b } from "@noble/hashes/blake2b";
import { concat, toHex } from "./bytes";

export interface KeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export function randomBytes(n: number): Uint8Array {
  return nacl.randomBytes(n);
}

/** Go comms.NewID: prefix + 32 hex chars of randomness. */
export function newID(prefix: string): string {
  return prefix + toHex(randomBytes(16));
}

export function generateKeyPair(): KeyPair {
  const kp = nacl.box.keyPair();
  return { publicKey: kp.publicKey, secretKey: kp.secretKey };
}

export function keyPairFromSecret(secretKey: Uint8Array): KeyPair {
  const kp = nacl.box.keyPair.fromSecretKey(secretKey);
  return { publicKey: kp.publicKey, secretKey: kp.secretKey };
}

export function boxSeal(
  plain: Uint8Array,
  nonce: Uint8Array,
  peerPublic: Uint8Array,
  ownSecret: Uint8Array
): Uint8Array {
  return nacl.box(plain, nonce, peerPublic, ownSecret);
}

export function boxOpen(
  cipher: Uint8Array,
  nonce: Uint8Array,
  peerPublic: Uint8Array,
  ownSecret: Uint8Array
): Uint8Array | null {
  return nacl.box.open(cipher, nonce, peerPublic, ownSecret);
}

/** Go box.OpenAnonymous: sealed = ephemeralPub(32) || box(msg, blake2b-24(epk||pk), epk, sk). */
export function openAnonymous(sealed: Uint8Array, own: KeyPair): Uint8Array | null {
  if (sealed.length < 32 + nacl.box.overheadLength) return null;
  const epk = sealed.subarray(0, 32);
  const nonce = blake2b(concat(epk, own.publicKey), { dkLen: 24 });
  return nacl.box.open(sealed.subarray(32), nonce, epk, own.secretKey);
}

/** base64(nonce || box) as used by porter push payloads and history queries. */
export function openNonceBox(
  sealed: Uint8Array,
  peerPublic: Uint8Array,
  ownSecret: Uint8Array
): Uint8Array | null {
  if (sealed.length < 24 + nacl.box.overheadLength) return null;
  return nacl.box.open(sealed.subarray(24), sealed.subarray(0, 24), peerPublic, ownSecret);
}

/** Reject low-order / malformed X25519 keys the same way the Go node does. */
export function validPublicKey(pub: Uint8Array): boolean {
  if (pub.length !== 32) return false;
  const probe = new Uint8Array(32);
  probe[0] = 1;
  const shared = nacl.scalarMult(probe, pub);
  return shared.some((b) => b !== 0);
}
