// Live porter v1 interop against a real Go node running `serve --porter`.
// Skipped unless PORTER_IT_BROKER and PORTER_IT_CLI are set. The Go node's
// porter config must list PHONE_MACHINE_ID (below) as approver, e.g.
//   approvers = ["m_55555555555555555555555555555555"]
//   [share]
//   agents = "*"
//   status = "*"
// PORTER_IT_CLI is a wrapper `cli NODE args...` for the scratch node (never the live one).
import { describe, expect, it } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toBase64 } from "../../comms/bytes";
import { keyPairFromSecret } from "../../comms/crypto";
import { CommsNode } from "../../comms/node";
import { MemoryKV } from "../../comms/storage";
import { fetchStream } from "../../comms/stream";
import { PorterClient } from "../client";
import { PorterStore } from "../store";

const BROKER = process.env.PORTER_IT_BROKER;
const CLI = process.env.PORTER_IT_CLI;
const NODE = process.env.PORTER_IT_NODE ?? "pmac";
export const PHONE_MACHINE_ID = "m_55555555555555555555555555555555";

const go = (...args: string[]) => execFileSync(CLI!, [NODE, ...args], { encoding: "utf8" });
const goJSON = (...args: string[]) => JSON.parse(go(...args, "--json"));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => T | Promise<T>, ms = 20000): Promise<NonNullable<T>> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v as NonNullable<T>;
    if (Date.now() > end) throw new Error("timed out");
    await sleep(250);
  }
}

async function seededPhone() {
  const kv = new MemoryKV();
  const secrets = new MemoryKV();
  const kp = keyPairFromSecret(new Uint8Array(32).fill(5));
  await secrets.set("comms_secret_key", toBase64(kp.secretKey));
  await kv.setItem(
    "comms.state.v1",
    JSON.stringify({
      machine_id: PHONE_MACHINE_ID,
      public_key: toBase64(kp.publicKey),
      agent_id: "a_55555555555555555555555555555555",
      alias: "app",
      created_at: Date.now(),
      broker_url: "",
      presence_revision: 0,
      peers: {},
      grants: {},
    })
  );
  return CommsNode.load({ kv, secrets, openStream: fetchStream() });
}

describe.skipIf(!BROKER || !CLI)("porter v1 interop with Go", () => {
  it("subscribes, receives snapshots/updates, sets special, answers a question", async () => {
    const phone = await seededPhone();
    await phone.configureBroker(BROKER!);
    const store = new PorterStore(new MemoryKV());
    const notified: string[] = [];
    const porter = new PorterClient(phone, store, { onNotify: (i) => notified.push(i.id) });
    porter.attach();

    const peer = await phone.pair(JSON.stringify(goJSON("export", "--alias", NODE)));
    const bundlePath = join(tmpdir(), `porter-phone-${Date.now()}.json`);
    writeFileSync(bundlePath, JSON.stringify(phone.identityBundle("phone")));
    try {
      go("pair", "--file", bundlePath, "--alias", "phone");
    } catch {
      // already paired on a reused scratch node
    }
    go("grant", "phone");
    phone.start();
    await until(() => phone.connection === "online");

    await until(async () => {
      try {
        await phone.resolveAgent(peer.machine_id, "porter", true);
        return true;
      } catch {
        return false;
      }
    });
    await porter.subscribe(peer.machine_id); // no push token: never calls Expo
    const m = await until(() => {
      const x = store.getSnapshot().machines[peer.machine_id];
      return x?.subscribed && x.agentsAt ? x : undefined;
    });
    expect(m.subscribed?.approver).toBe(true);
    expect(m.subscribed?.topics).toContain("agents");
    await until(() => store.getSnapshot().machines[peer.machine_id]?.status?.host);

    // Plain notification.
    go("porter", "notify", "--to", "phone", "--title", "Deploy finished", "--body", "it ✓", "--reason", "interop test");
    const n = await until(() => store.getSnapshot().inbox.find((i) => i.notify.title === "Deploy finished"));
    expect(n.notify.reason).toBe("interop test");
    expect(n.fromMachine).toBe(peer.machine_id);
    // v1: carried by <machine>:porter
    expect(n.fromAgent).toBe(await phone.resolveAgent(peer.machine_id, "porter"));

    // Agent lifecycle through the real porter event CLI.
    const sid = `itsess-${Date.now()}`;
    go("porter", "event", "--agent", sid, "--kind", "start", "--title", "it-agent");
    go("porter", "event", "--agent", sid, "--kind", "prompt");
    await until(() => store.getSnapshot().machines[peer.machine_id]?.agents[sid]?.status === "running");
    go("porter", "event", "--agent", sid, "--kind", "needs", "--needs-kind", "permission", "--needs-text", "Bash: npm test");
    const a = await until(() => {
      const x = store.getSnapshot().machines[peer.machine_id]?.agents[sid];
      return x?.status === "needs_you" ? x : undefined;
    });
    expect(a.needs?.text).toContain("npm test");

    await porter.setSpecial(peer.machine_id, sid, true);
    await until(() => store.getSnapshot().machines[peer.machine_id]?.agents[sid]?.special === true);

    // Question: `porter ask` blocks until the phone answers.
    const ask = spawn(CLI!, [NODE, "porter", "ask", "Run npm test?"], { stdio: ["ignore", "pipe", "pipe"] });
    let askOut = "";
    ask.stdout.on("data", (d) => (askOut += d));
    ask.stderr.on("data", (d) => (askOut += d));
    const q = await until(() => store.getSnapshot().inbox.find((i) => i.notify.ask?.length && !i.answer));
    expect(notified).toContain(q.id);
    await porter.answer(q, q.notify.ask!.find((c) => /allow/i.test(c)) ?? q.notify.ask![0]);
    const code = await new Promise<number>((r) => ask.on("close", (c) => r(c ?? -1)));
    expect(askOut.toLowerCase()).toContain("allow");
    expect(code).toBe(0);

    go("porter", "event", "--agent", sid, "--kind", "end");
    await until(() => {
      const x = store.getSnapshot().machines[peer.machine_id]?.agents[sid];
      return !x || x.status === "ended";
    });
    await phone.stop();
  }, 120_000);
});
