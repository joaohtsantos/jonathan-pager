import { describe, expect, it } from "vitest";
import { describeNeed, formatClock, lastResolution, machineLiveness, notifyLook, orderGroups, questionForAgent, senderParts, groupedAgents } from "../selectors";
import { mockSnapshot, MOCK_IDS } from "../mock";

const now = Date.parse("2026-10-09T22:00:00Z");
const snap = mockSnapshot(now);

describe("redesign selectors", () => {
  it("formats clocks", () => {
    expect(formatClock(192_000)).toBe("3:12");
    expect(formatClock(7_491_000)).toBe("2:04:51");
  });
  it("parses permission needs", () => {
    expect(describeNeed("Bash: npm install x")).toEqual({ verb: "Wants to run", text: "npm install x", mono: true });
    expect(describeNeed("Edit: a.ts", true).verb).toBe("Wanted to use Edit");
  });
  it("derives liveness from presence, else STATUS freshness", () => {
    const pi = snap.machines[MOCK_IDS.pi];
    const work = snap.machines[MOCK_IDS.work];
    expect(machineLiveness(pi, null, now).online).toBe(true);
    expect(machineLiveness(work, null, now).online).toBe(false);
    expect(machineLiveness(work, { [MOCK_IDS.work]: true }, now).online).toBe(true);
  });
  it("links a permission notify to its agent", () => {
    const q = questionForAgent(snap.inbox, MOCK_IDS.mac, "personal-mac", "s-pager-refactor", now);
    expect(q?.id).toBe("ntf_perm");
    expect(questionForAgent(snap.inbox, MOCK_IDS.pi, "pi", "s-joana", now)).toBeUndefined();
  });
  it("prefers last_decision, else the newest resolved notify", () => {
    const mac = snap.machines[MOCK_IDS.mac];
    expect(lastResolution(snap.inbox, MOCK_IDS.mac, "personal-mac", mac.agents["s-comms-release"])?.via).toBe("phone");
    expect(lastResolution(snap.inbox, MOCK_IDS.mac, "personal-mac", mac.agents["s-pager-ui"])?.choice).toBe("Allow");
  });
  it("classifies inbox items and senders", () => {
    const look = Object.fromEntries(snap.inbox.map((i) => [i.id, notifyLook(i, now)]));
    expect(look).toMatchObject({ ntf_perm: "permission", ntf_trust: "trust", ntf_ask: "question", ntf_disk: "high", ntf_cam: "camera", ntf_done_allow: "answered", ntf_sleep: "message" });
    expect(senderParts(snap.inbox[0], "x")).toEqual({ machine: "personal-mac", agent: "pager-refactor" });
  });
  it("orders machines by saved order, floating those that need you", () => {
    const groups = groupedAgents(snap);
    const order = [MOCK_IDS.pi, MOCK_IDS.mac, MOCK_IDS.work];
    expect(orderGroups(groups, order, false).map((g) => g.machine.machineId)).toEqual(order);
    expect(orderGroups(groups, [MOCK_IDS.work, MOCK_IDS.mac, MOCK_IDS.pi], true).map((g) => g.machine.machineId)).toEqual([MOCK_IDS.work, MOCK_IDS.mac, MOCK_IDS.pi]);
  });
});
