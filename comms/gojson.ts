// JSON encoding byte-compatible with Go's encoding/json.Marshal for the shapes
// comms uses (objects in declared field order, strings, numbers, bools, arrays).
// Go escapes <, >, & and U+2028/U+2029; JSON.stringify does not. The bytes
// matter because they are what gets encrypted and hashed.

const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

function goString(s: string): string {
  return JSON.stringify(s)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .split(LS)
    .join("\\u2028")
    .split(PS)
    .join("\\u2029");
}

/**
 * Encode like Go. Object key order is insertion order, so build objects in the
 * Go struct's field order. Keys with `undefined` values are dropped (omitempty).
 */
export function goMarshal(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "string") return goString(v);
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("non-finite number");
    return JSON.stringify(v);
  }
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) return "[" + v.map(goMarshal).join(",") + "]";
  if (typeof v === "object") {
    const parts: string[] = [];
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (val === undefined) continue;
      parts.push(goString(k) + ":" + goMarshal(val));
    }
    return "{" + parts.join(",") + "}";
  }
  throw new Error(`cannot marshal ${typeof v}`);
}
