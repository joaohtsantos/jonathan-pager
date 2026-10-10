// Key fingerprint shown when pairing / naming the phone. The Go side has no
// fingerprint helper yet; format (for the CLI to match): first 8 groups of 4
// hex chars of SHA-256(raw 32-byte public key), e.g. "3f1a 9c0b … 77d2".
import { sha256 } from "@noble/hashes/sha256";
import { fromBase64 } from "../comms/bytes";

export function keyFingerprint(publicKeyB64: string): string {
  const hex = Array.from(sha256(fromBase64(publicKeyB64)), (b) => b.toString(16).padStart(2, "0")).join("");
  return hex.slice(0, 32).replace(/(.{4})(?!$)/g, "$1 ");
}
