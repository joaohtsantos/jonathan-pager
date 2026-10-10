import { describe, expect, it } from "vitest";
import { agentTree, displayStatus, graveyard, groupedAgents, HEARTBEAT_FRESH_MS, INACTIVE_AFTER_MS, liveDurations, statusLabel, splitInbox, formatDuration } from "../selectors";
import type { MachineState, InboxItem } from "../store";
import type { Agent } from "../types";

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
    h: { id: "h", status: "done", parent: "a", status_since: iso(10) },
    i: { id: "i", status: "ended", parent: "a", ended_at: iso(5) },
    j: { id: "j", status: "done", last_active_at: iso(60_000) },
  },
};

describe("selectors", () => {
  it("nests subagents, hides ended, floats needs_you", () => {
    const tree = agentTree(m);
    expect(tree.map((n) => n.agent.id)).toEqual(["b", "a", "f", "g", "j"]);
    expect(tree[0].children.map((c) => c.id)).toEqual(["d", "c"]);
    // finished / ended subagents are dropped; the parent's list just shrinks
    expect(tree.find((n) => n.agent.id === "a")!.children).toEqual([]);
  });
  it("splits done into idle (< threshold) and inactive", () => {
    expect(displayStatus(m.agents.j, now)).toBe("idle");
    expect(displayStatus({ id: "x", status: "done", last_active_at: iso(INACTIVE_AFTER_MS + 1) }, now)).toBe("inactive");
    expect(displayStatus({ id: "x", status: "done" }, now)).toBe("inactive");
    expect(displayStatus(m.agents.a, now)).toBe("running");
  });
  it("counts away/error and floats machines with errors", () => {
    const mm: MachineState = { machineId: "m_2", name: "pi", trusts: {}, agents: { x: { id: "x", status: "error", error: { kind: "overloaded" } }, y: { id: "y", status: "away" } } };
    const [g] = groupedAgents({ machines: { m_2: mm }, inbox: [], prefs: { muted: {}, blocked: {} } }, {}, now);
    expect([g.errors, g.away, g.running]).toEqual([1, 1, 0]);
    expect(g.nodes.map((n) => n.agent.id)).toEqual(["x", "y"]);
    expect(displayStatus(mm.agents.y, now)).toBe("away");
  });
  it("hides inactive roots behind the machine line, keeps parents of live subagents", () => {
    const [g] = groupedAgents({ machines: { m_1: m }, inbox: [], prefs: { muted: {}, blocked: {} } }, {}, now);
    expect(g.nodes.map((n) => n.agent.id)).toEqual(["b", "a", "f", "j"]);
    expect(g.inactive.map((n) => n.agent.id)).toEqual(["g"]);
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

describe("kept agents (keep: true)", () => {
  const snap = (agents: MachineState["agents"]) => ({ machines: { m_pi: { machineId: "m_pi", name: "pi", trusts: {}, agents } as MachineState }, inbox: [], prefs: { muted: {}, blocked: {} } });
  const joana = (extra: Partial<Agent> = {}): Agent => ({ id: "joana", status: "done", keep: true, last_active_at: iso(6 * 3600_000), heartbeat_at: iso(30_000), ...extra });
  const online = { m_pi: true };

  it("done → idle (blue) while the heartbeat is fresh, regardless of last turn", () => {
    expect(displayStatus(joana(), now)).toBe("idle");
    expect(displayStatus(joana({ heartbeat_at: iso(HEARTBEAT_FRESH_MS - 1000) }), now)).toBe("idle");
  });
  it("done → deactivated (gray) when the heartbeat is stale/missing or paused", () => {
    expect(displayStatus(joana({ heartbeat_at: iso(HEARTBEAT_FRESH_MS + 1000) }), now)).toBe("deactivated");
    expect(displayStatus(joana({ heartbeat_at: undefined }), now)).toBe("deactivated");
    expect(displayStatus(joana({ paused: true }), now)).toBe("deactivated");
    expect(statusLabel(joana({ paused: true }), now)).toBe("Paused · spending cap");
    expect(statusLabel(joana({ heartbeat_at: undefined }), now)).toBe("Deactivated");
    expect(statusLabel(joana(), now)).toBe("idle");
  });
  it("live statuses are unchanged", () => {
    for (const status of ["running", "away", "needs_you", "error"] as const) expect(displayStatus(joana({ status }), now)).toBe(status);
  });
  it("is never folded under inactive nor in the graveyard", () => {
    const s = snap({ joana: joana({ heartbeat_at: undefined }), gone: joana({ id: "gone", status: "ended", ended_at: iso(10) }) });
    const [g] = groupedAgents(s, {}, now, online);
    expect(g.inactive).toEqual([]);
    expect(g.nodes.map((n) => n.agent.id).sort()).toEqual(["gone", "joana"]);
    expect(graveyard(s)).toEqual([]);
  });
  it("is not listed when its machine is offline", () => {
    const s = snap({ joana: joana(), x: { id: "x", status: "running" } });
    const [g] = groupedAgents(s, {}, now, { m_pi: false });
    expect(g.nodes.map((n) => n.agent.id)).toEqual(["x"]);
  });
  it("leaves non-kept agents exactly as before", () => {
    const old = { id: "o", status: "done", last_active_at: iso(INACTIVE_AFTER_MS + 1), heartbeat_at: iso(1000) } as Agent;
    const recent = { id: "r", status: "done", last_active_at: iso(1000) } as Agent;
    const dead = { id: "d", status: "ended", ended_at: iso(10) } as Agent;
    expect(displayStatus(old, now)).toBe("inactive");
    expect(displayStatus(recent, now)).toBe("idle");
    expect(statusLabel(old, now)).toBe("inactive");
    const s = snap({ o: old, r: recent, d: dead });
    for (const p of [online, { m_pi: false }, null]) {
      const [g] = groupedAgents(s, {}, now, p);
      expect(g.inactive.map((n) => n.agent.id)).toEqual(["o"]);
      expect(g.nodes.map((n) => n.agent.id)).toEqual(["r"]);
    }
    expect(graveyard(s).map((x) => x.agent.id)).toEqual(["d"]);
  });
});
