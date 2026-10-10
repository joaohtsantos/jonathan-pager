// Inbox bulk actions: selection state + pure planning helpers (no RN imports,
// unit-tested in screens/inbox/__tests__/selection.test.ts).
//
// Keys: `p:<machine>/<id>` porter item, `g:<id>` pager-api push, `r:<id>` pager-api request.

export type SelKey = string;
export const porterKey = (machine: string, id: string): SelKey => `p:${machine}/${id}`;
export const pushKey = (id: string): SelKey => `g:${id}`;
export const requestKey = (id: string): SelKey => `r:${id}`;
export const keyKind = (k: SelKey) => (k[0] === "p" ? "porter" : k[0] === "g" ? "push" : "request");

export interface SelState {
  active: boolean;
  selected: SelKey[];
}

export type SelAction =
  | { type: "enter"; key?: SelKey }
  | { type: "toggle"; key: SelKey }
  /** Select all of `keys`, or clear when all of them are already selected. */
  | { type: "toggleAll"; keys: SelKey[] }
  /** Drop selected keys that are no longer visible (answered, filtered out, dismissed). */
  | { type: "prune"; visible: SelKey[] }
  /** Drop handled keys; leaves selection mode once nothing is left. */
  | { type: "deselect"; keys: SelKey[] }
  | { type: "exit" };

export const initialSel: SelState = { active: false, selected: [] };

export function selReducer(s: SelState, a: SelAction): SelState {
  switch (a.type) {
    case "enter":
      return { active: true, selected: a.key && !s.selected.includes(a.key) ? [...s.selected, a.key] : s.selected };
    case "toggle":
      if (!s.active) return s;
      return { ...s, selected: s.selected.includes(a.key) ? s.selected.filter((k) => k !== a.key) : [...s.selected, a.key] };
    case "toggleAll": {
      if (!s.active) return s;
      return { ...s, selected: allSelected(s, a.keys) ? s.selected.filter((k) => !a.keys.includes(k)) : Array.from(new Set([...s.selected, ...a.keys])) };
    }
    case "prune": {
      const vis = new Set(a.visible);
      const next = s.selected.filter((k) => vis.has(k));
      return next.length === s.selected.length ? s : { ...s, selected: next };
    }
    case "deselect": {
      const drop = new Set(a.keys);
      const next = s.selected.filter((k) => !drop.has(k));
      return next.length ? { ...s, selected: next } : initialSel;
    }
    case "exit":
      return initialSel;
  }
}

export const allSelected = (s: SelState, keys: SelKey[]) => keys.length > 0 && keys.every((k) => s.selected.includes(k));

// ---- what a selection contains / which actions fit -------------------------

/** "message": porter notify or pager push · "request": pager-api request · "question": porter question (non permission/trust). */
export type SelCat = "message" | "request" | "question";

/** Porter permission/trust asks are answered one at a time, never bulk-handled. */
export const bulkLocked = (kind?: string) => kind === "permission" || kind === "trust";

export interface SelSummary {
  messages: SelKey[];
  requests: SelKey[];
  questions: SelKey[];
}

export function summarize(selected: SelKey[], catOf: (k: SelKey) => SelCat | undefined): SelSummary {
  const out: SelSummary = { messages: [], requests: [], questions: [] };
  for (const k of selected) {
    const c = catOf(k);
    if (c === "message") out.messages.push(k);
    else if (c === "request") out.requests.push(k);
    else if (c === "question") out.questions.push(k);
  }
  return out;
}

export type BulkActionId = "seen" | "dismiss" | "reject";
export interface BulkAction {
  id: BulkActionId;
  label: string;
  /** Exactly the selected keys this action applies to. */
  keys: SelKey[];
  danger?: boolean;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Bottom-bar actions for the selection. Dismiss only ever touches messages and
 * Reject only pager-api requests, so a mixed selection never rejects silently.
 */
export function barActions(sum: SelSummary): { actions: BulkAction[]; note?: string } {
  const { messages, requests, questions } = sum;
  const asks = [...requests, ...questions];
  const all = [...messages, ...asks];
  if (!asks.length) return { actions: [{ id: "seen", label: "Mark seen", keys: messages }, { id: "dismiss", label: "Dismiss", keys: messages }] };
  if (!messages.length) {
    const seen: BulkAction = { id: "seen", label: "Mark seen", keys: asks };
    return { actions: requests.length ? [{ id: "reject", label: "Reject", keys: requests, danger: true }, seen] : [seen] };
  }
  const note = [plural(messages.length, "message"), requests.length ? plural(requests.length, "request") : "", questions.length ? plural(questions.length, "question") : ""].filter(Boolean).join(" · ");
  const actions: BulkAction[] = [
    { id: "seen", label: `Mark ${all.length} seen`, keys: all },
    { id: "dismiss", label: `Dismiss ${plural(messages.length, "message")}`, keys: messages },
  ];
  if (requests.length) actions.push({ id: "reject", label: `Reject ${plural(requests.length, "request")}`, keys: requests, danger: true });
  return { actions, note };
}

export const rejectConfirm = (n: number) => ({ title: `Reject ${plural(n, "request")}?`, body: "They are rejected on pager-api. This can't be undone." });

/** Per-section header toggle. */
export const sectionToggleLabel = (s: SelState, keys: SelKey[]) => (allSelected(s, keys) ? "None" : "Select all");

/** Run `fn` over `items` with at most `limit` in flight; never throws. */
export async function runBatched<I>(
  items: I[],
  fn: (item: I) => Promise<void>,
  limit = 5,
  onProgress?: (done: number, total: number) => void
): Promise<{ ok: I[]; failed: I[] }> {
  const ok: I[] = [];
  const failed: I[] = [];
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      try {
        await fn(item);
        ok.push(item);
      } catch {
        failed.push(item);
      }
      onProgress?.(++done, items.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return { ok, failed };
}

/** Keep the persisted dismissed set bounded (newest last). */
export function addDismissed(prev: SelKey[], add: SelKey[], cap = 1000): SelKey[] {
  const merged = Array.from(new Set([...prev, ...add]));
  return merged.length > cap ? merged.slice(merged.length - cap) : merged;
}
