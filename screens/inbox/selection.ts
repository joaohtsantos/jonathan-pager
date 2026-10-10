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
    case "exit":
      return initialSel;
  }
}

export const allSelected = (s: SelState, keys: SelKey[]) => keys.length > 0 && keys.every((k) => s.selected.includes(k));

export interface DismissPlan {
  /** Keys hidden locally (porter items + pushes; requests only once rejected). */
  local: SelKey[];
  /** pager-api request ids to reject. */
  requests: string[];
  /** Porter questions kept: they must be answered. */
  kept: SelKey[];
}

export function planDismiss(selected: SelKey[], isQuestion: (k: SelKey) => boolean): DismissPlan {
  const plan: DismissPlan = { local: [], requests: [], kept: [] };
  for (const k of selected) {
    const kind = keyKind(k);
    if (kind === "request") plan.requests.push(k.slice(2));
    else if (kind === "porter" && isQuestion(k)) plan.kept.push(k);
    else plan.local.push(k);
  }
  return plan;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Confirm copy, or null when no confirm is needed (no requests in the selection). */
export function dismissConfirm(plan: DismissPlan): { title: string; body: string } | null {
  if (!plan.requests.length) return null;
  const n = plan.local.length + plan.requests.length;
  const parts = [`This rejects ${plural(plan.requests.length, "pending request")}.`];
  if (plan.kept.length) parts.push(`${plural(plan.kept.length, "question")} waiting on you ${plan.kept.length === 1 ? "is" : "are"} kept.`);
  return { title: `Dismiss ${plural(n, "item")}?`, body: parts.join(" ") };
}

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
