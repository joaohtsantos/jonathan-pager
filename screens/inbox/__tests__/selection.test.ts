import { describe, expect, it } from "vitest";
import { addDismissed, dismissConfirm, initialSel, planDismiss, porterKey, pushKey, requestKey, runBatched, selReducer, type SelState } from "../selection";

const p1 = porterKey("m_1", "a");
const q1 = porterKey("m_1", "q");
const g1 = pushKey("7");
const r1 = requestKey("r1");
const r2 = requestKey("r2");

describe("selReducer", () => {
  it("enters with the long-pressed row and toggles", () => {
    let s: SelState = selReducer(initialSel, { type: "enter", key: p1 });
    expect(s).toEqual({ active: true, selected: [p1] });
    s = selReducer(s, { type: "toggle", key: g1 });
    s = selReducer(s, { type: "toggle", key: p1 });
    expect(s.selected).toEqual([g1]);
  });
  it("ignores toggles outside selection mode", () => {
    expect(selReducer(initialSel, { type: "toggle", key: p1 })).toBe(initialSel);
  });
  it("select all covers only the given (filtered) keys, then clears them", () => {
    let s = selReducer(initialSel, { type: "enter" });
    s = selReducer(s, { type: "toggleAll", keys: [p1, g1] });
    expect(s.selected.sort()).toEqual([g1, p1].sort());
    s = selReducer(s, { type: "toggleAll", keys: [p1, g1] });
    expect(s.selected).toEqual([]);
  });
  it("prunes keys that disappeared and exits clean", () => {
    let s = selReducer(initialSel, { type: "enter", key: p1 });
    s = selReducer(s, { type: "toggle", key: r1 });
    s = selReducer(s, { type: "prune", visible: [r1] });
    expect(s.selected).toEqual([r1]);
    expect(selReducer(s, { type: "exit" })).toEqual(initialSel);
  });
});

describe("planDismiss / dismissConfirm", () => {
  const isQ = (k: string) => k === q1;
  it("rejects requests, keeps porter questions, hides the rest", () => {
    const plan = planDismiss([p1, q1, g1, r1, r2], isQ);
    expect(plan).toEqual({ local: [p1, g1], requests: ["r1", "r2"], kept: [q1] });
    expect(dismissConfirm(plan)).toEqual({
      title: "Dismiss 4 items?",
      body: "This rejects 2 pending requests. 1 question waiting on you is kept.",
    });
  });
  it("needs no confirm without requests", () => {
    expect(dismissConfirm(planDismiss([p1, q1], isQ))).toBeNull();
  });
});

describe("runBatched", () => {
  it("caps concurrency, reports progress and collects failures", async () => {
    let inFlight = 0;
    let peak = 0;
    const progress: number[] = [];
    const res = await runBatched(
      Array.from({ length: 12 }, (_, i) => i),
      async (i) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 2));
        inFlight--;
        if (i % 4 === 0) throw new Error("x");
      },
      5,
      (d) => progress.push(d)
    );
    expect(peak).toBe(5);
    expect(res.failed.sort((a, b) => a - b)).toEqual([0, 4, 8]);
    expect(res.ok).toHaveLength(9);
    expect(progress).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  });
});

it("addDismissed dedupes and caps", () => {
  expect(addDismissed(["a", "b"], ["b", "c", "d"], 3)).toEqual(["b", "c", "d"]);
});
