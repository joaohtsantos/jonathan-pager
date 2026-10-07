import { describe, expect, it } from "vitest";
import { agentTree, graveyard, groupedAgents, liveDurations, splitInbox, formatDuration } from "../selectors";
import type { MachineState, InboxItem } from "../store";

const now = Date.parse("2026-10-07T00:00:00Z");
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
const m: MachineState = {
  machineId: "m_1", name: "mac", trusts: {},
  agents: {
    a: { id: "a", status: "running", status_since: iso(60_000), running_ms: 1000, last_active_at: iso(1000) },
    b: { id: "b", status: "done", status_since: iso(5000) },
    c: { id: "c", status: "running", parent: "b", status_since: iso(1000) },
    d: { id: "d", status: "needs_you", parent: "b", status_since: iso(2000), waiting_ms: 500 },
    e: { id: "e", status: "ended", ended_at: iso(10) },
    f: { id: "f", status: "running", parent: "zzz" },
    g: { id: "g", status: "done", special: true },
  },
};

describe("selectors", () => {
  it("nests subagents, hides ended, floats needs_you", () => {
    const tree = agentTree(m);
    expect(tree.map((n) => n.agent.id)).toEqual(["b", "a", "f", "g"]);
    expect(tree[0].children.map((c) => c.id)).toEqual(["d", "c"]);
  });
  it("adds the open period to durations", () => {
    expect(liveDurations(m.agents.a, now).runningMs).toBe(61_000);
    expect(liveDurations(m.agents.d, now).waitingMs).toBe(2500);
    expect(liveDurations(m.agents.b, now).runningMs).toBe(0);
  });
  it("groups machines and lists the graveyard", () => {
    const g = groupedAgents({ machines: { m_1: m }, inbox: [], prefs: { muted: {}, blocked: {} } });
    expect(g[0].needsYou).toBe(1);
    expect(graveyard({ machines: { m_1: m }, inbox: [], prefs: { muted: {}, blocked: {} } }).map((x) => x.agent.id)).toEqual(["e"]);
  });
  it("pins open questions", () => {
    const mk = (id: string, extra: Partial<InboxItem["notify"]> = {}, more: Partial<InboxItem> = {}): InboxItem => ({ id, fromMachine: "m_1", notify: { id, title: id, ...extra }, receivedAt: now - id.length, via: "comms", read: false, ...more });
    const { questions, rest } = splitInbox([
      mk("q1", { ask: ["A"] }),
      mk("q2", { ask: ["A"], expires_at: iso(1) }),
      mk("n1"),
      mk("q3", { ask: ["A"] }, { answer: { choice: "A", at: now, state: "sent" } }),
    ], now);
    expect(questions.map((q) => q.id)).toEqual(["q1"]);
    expect(rest.map((q) => q.id)).toEqual(["q2", "n1", "q3"]);
  });
  it("formats durations", () => {
    expect(formatDuration(59_000)).toBe("59s");
    expect(formatDuration(61_000)).toBe("1m01s");
    expect(formatDuration(3_600_000 * 25)).toBe("1d01h");
  });
});
