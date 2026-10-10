import { describe, expect, it } from "vitest";
import { addDismissed, barActions, bulkLocked, initialSel, porterKey, pushKey, rejectConfirm, requestKey, runBatched, sectionToggleLabel, selReducer, summarize, type SelCat, type SelState } from "../selection";

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

describe("per-section select all", () => {
  it("toggles only that section's keys and leaves other sections alone", () => {
    const waiting = [r1, r2];
    const today = [p1, g1];
    let s = selReducer(initialSel, { type: "enter" });
    s = selReducer(s, { type: "toggle", key: g1 });
    expect(sectionToggleLabel(s, waiting)).toBe("Select all");
    s = selReducer(s, { type: "toggleAll", keys: waiting });
    expect(s.selected.sort()).toEqual([g1, r1, r2].sort());
    expect(sectionToggleLabel(s, waiting)).toBe("None");
    expect(sectionToggleLabel(s, today)).toBe("Select all");
    s = selReducer(s, { type: "toggleAll", keys: waiting });
    expect(s.selected).toEqual([g1]);
  });
  it("question cards toggle individually", () => {
    let s = selReducer(initialSel, { type: "enter", key: r1 });
    s = selReducer(s, { type: "toggle", key: r2 });
    s = selReducer(s, { type: "toggle", key: r1 });
    expect(s.selected).toEqual([r2]);
  });
  it("deselect drops handled keys and exits when empty", () => {
    let s = selReducer(initialSel, { type: "enter", key: p1 });
    s = selReducer(s, { type: "toggle", key: r1 });
    s = selReducer(s, { type: "deselect", keys: [p1] });
    expect(s).toEqual({ active: true, selected: [r1] });
    expect(selReducer(s, { type: "deselect", keys: [r1] })).toEqual(initialSel);
  });
});

describe("barActions", () => {
  const catOf = (k: string): SelCat => (k.startsWith("r:") ? "request" : k === q1 ? "question" : "message");
  const bar = (keys: string[]) => barActions(summarize(keys, catOf));
  const brief = (keys: string[]) => bar(keys).actions.map((a) => [a.id, a.label, a.keys]);

  it("only messages → Mark seen · Dismiss", () => {
    expect(brief([p1, g1])).toEqual([["seen", "Mark seen", [p1, g1]], ["dismiss", "Dismiss", [p1, g1]]]);
    expect(bar([p1]).note).toBeUndefined();
  });
  it("only requests → Reject · Mark seen", () => {
    expect(brief([r1, r2])).toEqual([["reject", "Reject", [r1, r2]], ["seen", "Mark seen", [r1, r2]]]);
  });
  it("porter question alone → Mark seen only (nothing to reject)", () => {
    expect(brief([q1])).toEqual([["seen", "Mark seen", [q1]]]);
  });
  it("mixed → counted actions, Dismiss never touches requests", () => {
    const b = bar([p1, g1, r1, q1]);
    expect(b.actions.map((a) => [a.id, a.label, a.keys])).toEqual([
      ["seen", "Mark 4 seen", [p1, g1, r1, q1]],
      ["dismiss", "Dismiss 2 messages", [p1, g1]],
      ["reject", "Reject 1 request", [r1]],
    ]);
    expect(b.note).toBe("2 messages · 1 request · 1 question");
  });
  it("reject confirm copy", () => {
    expect(rejectConfirm(3).title).toBe("Reject 3 requests?");
    expect(rejectConfirm(1).title).toBe("Reject 1 request?");
  });
  it("permission/trust asks are locked", () => {
    expect(bulkLocked("permission")).toBe(true);
    expect(bulkLocked("trust")).toBe(true);
    expect(bulkLocked("message")).toBe(false);
    expect(bulkLocked(undefined)).toBe(false);
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
