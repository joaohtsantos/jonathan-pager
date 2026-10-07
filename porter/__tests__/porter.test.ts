import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import nacl from "tweetnacl";
import { fromBase64, toBase64, utf8Encode, concat } from "../../comms/bytes";
import { MemoryKV } from "../../comms/storage";
import type { CommsNode, InboundMessage } from "../../comms/node";
import { extractPorterData, openPorterPush } from "../push";
import { PorterClient } from "../client";
import { PorterStore, isQuestion, agentKey } from "../store";

const V = JSON.parse(readFileSync(join(__dirname, "../../comms/__tests__/vectors/go-vectors.json"), "utf8"));
const phoneSecret = fromBase64(V.phone.private_key);
const macPub = fromBase64(V.mac.public_key);
const keys = (id: string) => (id === V.mac.machine_id ? macPub : null);

function seal(obj: unknown) {
  const nonce = nacl.randomBytes(24);
  const box = nacl.box(utf8Encode(JSON.stringify(obj)), nonce, fromBase64(V.phone.public_key), fromBase64(V.mac.private_key));
  return { porter: "1", from: V.mac.machine_id, box: toBase64(concat(nonce, box)) };
}

describe("encrypted push", () => {
  it("opens a Go porter.PushData push (pre-v1, no kind) as kind=agent", () => {
    const p = openPorterPush(V.push, keys, phoneSecret);
    expect(p).toMatchObject({ kind: "agent", agent: "sess-1", status: "needs_you" });
  });
  it("drops unknown senders and tampered boxes", () => {
    expect(openPorterPush({ ...V.push, from: "m_unknown" }, keys, phoneSecret)).toBeNull();
    const bad = fromBase64(V.push.box);
    bad[30] ^= 1;
    expect(openPorterPush({ ...V.push, box: toBase64(bad) }, keys, phoneSecret)).toBeNull();
  });
  it("opens v1 notify and wake plaintexts", () => {
    const n = openPorterPush(seal({ kind: "notify", notify: { id: "ntf_1", title: "Deploy" } }) as never, keys, phoneSecret);
    expect(n).toMatchObject({ kind: "notify", notify: { id: "ntf_1" } });
    expect(openPorterPush(seal({ kind: "wake", id: "ntf_2" }) as never, keys, phoneSecret)).toMatchObject({ kind: "wake" });
  });
  it("extracts data from expo task payload shapes", () => {
    const d = { porter: "1", from: "m_x", box: "AAAA" };
    expect(extractPorterData({ data: { dataString: JSON.stringify(d) } })).toEqual(d);
    expect(extractPorterData({ data: { body: JSON.stringify(d) } })).toEqual(d);
    expect(extractPorterData({ data: d })).toEqual(d);
    expect(extractPorterData({ request: { content: { data: d } } })).toEqual(d);
    expect(extractPorterData({ data: { other: 1 } })).toBeNull();
  });
});

function fakeNode(sent: { machine: string; to: string; body: string }[]): CommsNode {
  return {
    onMessage: () => () => undefined,
    peers: () => [{ machine_id: "m_mac" }],
    send: async (machine: string, to: string, body: string) => {
      sent.push({ machine, to, body });
      return "msg_1";
    },
  } as unknown as CommsNode;
}
const msg = (body: unknown, fromMachine = "m_mac", fromAgent = "a_porter"): InboundMessage => ({
  id: "msg_" + Math.random(), fromMachine, fromAgent, peerAlias: "mac", body: JSON.stringify(body), createdAt: Date.now(),
});

describe("porter client", () => {
  it("folds topic messages into machine state", async () => {
    const store = new PorterStore(new MemoryKV());
    const sent: { machine: string; to: string; body: string }[] = [];
    const c = new PorterClient(fakeNode(sent), store);
    await c.subscribe("m_mac", "ExponentPushToken[abc]");
    expect(JSON.parse(sent[0].body)).toEqual({ type: "porter.subscribe", v: 1, topics: ["agents", "status", "trusts"], push: { provider: "expo", token: "ExponentPushToken[abc]" } });
    expect(sent[0].to).toBe("porter");

    await c.handle(msg({ type: "porter.subscribed", v: 1, machine: "mac", topics: ["agents", "status", "trusts"], refused: [], approver: true, push: true }));
    await c.handle(msg({ type: "porter.snapshot", v: 1, machine: "mac", topic: "agents", items: [{ id: "s1", status: "running" }, { id: "s2", status: "done", parent: "s1" }] }));
    await c.handle(msg({ type: "porter.snapshot", v: 1, machine: "mac", topic: "status", value: { host: "mac", load: 1.5 } }));
    await c.handle(msg({ type: "porter.snapshot", v: 1, machine: "mac", topic: "trusts", items: [{ id: "tr_1", receiver: "pi:joana", sender: "mac:x", scope: "always" }] }));
    await c.handle(msg({ type: "porter.update", v: 1, machine: "mac", topic: "agents", item: { id: "s1", status: "needs_you", needs: { kind: "permission", text: "Bash" } } }));
    await c.handle(msg({ type: "porter.remove", v: 1, machine: "mac", topic: "agents", id: "s2" }));
    await c.handle(msg({ type: "porter.remove", v: 1, machine: "mac", topic: "trusts", id: "tr_1" }));
    // pre-v1 shapes still work
    await c.handle(msg({ type: "porter.agent", machine: "mac", agent: { id: "s3", status: "running" } }));
    // spoofed machine name in body never changes the key
    await c.handle(msg({ type: "porter.update", v: 1, machine: "pi", topic: "status", value: { host: "evil" } }, "m_mac"));

    const m = store.getSnapshot().machines["m_mac"];
    expect(m.subscribed).toMatchObject({ approver: true, push: true });
    expect(Object.keys(m.agents).sort()).toEqual(["s1", "s3"]);
    expect(m.agents.s1.status).toBe("needs_you");
    expect(m.trusts).toEqual({});
    expect(m.status?.host).toBe("evil");
    expect(store.getSnapshot().machines["m_pi"]).toBeUndefined();

    await c.setSpecial("m_mac", "s1", true);
    await c.revokeTrust("m_mac", "tr_1");
    expect(sent.slice(1).map((s) => JSON.parse(s.body))).toEqual([
      { type: "porter.set", v: 1, agent: "s1", special: true },
      { type: "porter.revoke", v: 1, trust: "tr_1" },
    ]);
  });

  it("handles notify / answer / cancel and dedupes push+comms copies", async () => {
    const store = new PorterStore(new MemoryKV());
    const sent: { machine: string; to: string; body: string }[] = [];
    const notified: string[] = [];
    const c = new PorterClient(fakeNode(sent), store, { onNotify: (i) => notified.push(i.id) });
    const notify = { id: "ntf_1", kind: "permission", title: "Bash: npm i", ask: ["Allow", "Deny"], context: { session: "sess-9" } };
    expect(await store.ingestNotify("m_mac", undefined, notify, "push")).toBe(true);
    await c.handle(msg({ type: "porter.notify", v: 1, ...notify }, "m_mac", "a_asker"));
    expect(notified).toEqual([]); // already present via push
    const item = store.getSnapshot().inbox[0];
    expect(store.getSnapshot().inbox).toHaveLength(1);
    expect(item.fromAgent).toBe("a_asker");
    expect(isQuestion(item)).toBe(true);
    await c.answer(item, "Allow");
    expect(sent[0]).toEqual({ machine: "m_mac", to: "a_asker", body: JSON.stringify({ type: "porter.answer", v: 1, id: "ntf_1", choice: "Allow" }) });
    expect(store.getSnapshot().inbox[0].answer?.state).toBe("sent");

    await c.handle(msg({ type: "porter.notify", v: 1, id: "ntf_2", title: "Q", ask: ["A", "B"] }));
    expect(notified).toEqual(["ntf_2"]);
    await c.handle(msg({ type: "porter.cancel", v: 1, id: "ntf_2", resolution: "terminal" }));
    expect(store.getSnapshot().inbox[0].cancelled?.resolution).toBe("terminal");
    expect(isQuestion(store.getSnapshot().inbox[0])).toBe(false);

    await store.setPref("blocked", agentKey("m_mac", "sess-9"), true);
    expect(await store.ingestNotify("m_mac", "a_asker", { ...notify, id: "ntf_3" }, "comms")).toBe(false);
  });
});
