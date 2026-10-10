// Live porter v1 interop against a real Go node running `serve --porter`.
// Skipped unless PORTER_IT_BROKER and PORTER_IT_CLI are set. The Go node's
// porter config must list PHONE_MACHINE_ID (below) as approver, e.g.
//   approvers = ["m_55555555555555555555555555555555"]
//   approvals = "phone"
//   recap = true
//   [share]
//   agents = "*"
//   status = "*"
// PORTER_IT_CLI is a wrapper `cli NODE args...` for the scratch node (never the live one).
// The test ends with porter.resign, which removes the phone from `approvers`:
// restore the config (and restart the scratch node) before re-running.
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
import { decisionVia, questionForAgent, recapLines } from "../selectors";
import { keyFingerprint } from "../../lib/fingerprint";

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
  it("subscribes, snapshots/updates, special, ask + last_decision, draft → text, fingerprints, resign", async () => {
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

    // Fingerprints: the app's format equals `comms fingerprint` both ways.
    expect(keyFingerprint(peer.public_key)).toBe(JSON.parse(go("fingerprint", "--json")).fingerprint);
    expect(keyFingerprint(phone.identityBundle().public_key)).toBe(JSON.parse(go("fingerprint", "phone", "--json")).fingerprint);
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

    // Recap (opt-in on the machine) arrives as multi-line text.
    go("porter", "event", "--agent", sid, "--kind", "update", "--recap", "- mapped the push path\n- tests green");
    const withRecap = await until(() => store.getSnapshot().machines[peer.machine_id]?.agents[sid]?.recap);
    expect(recapLines({ id: sid, status: "needs_you", recap: withRecap })).toEqual(["mapped the push path", "tests green"]);

    // Permission question tied to the agent: `porter ask` blocks until the phone answers.
    const ask = spawn(CLI!, [NODE, "porter", "ask", "--agent", sid, "--kind", "permission", "Run npm test?"], { stdio: ["ignore", "pipe", "pipe"] });
    let askOut = "";
    ask.stdout.on("data", (d) => (askOut += d));
    ask.stderr.on("data", (d) => (askOut += d));
    const q = await until(() => store.getSnapshot().inbox.find((i) => i.notify.kind === "permission" && i.notify.context?.session === sid && !i.answer));
    expect(notified).toContain(q.id);
    // The agent screen finds this question (Allow / Deny in the bottom bar).
    expect(questionForAgent(store.getSnapshot().inbox, peer.machine_id, store.getSnapshot().machines[peer.machine_id]?.name, sid)?.id).toBe(q.id);
    await porter.answer(q, q.notify.ask!.find((c) => /allow/i.test(c)) ?? q.notify.ask![0]);
    const code = await new Promise<number>((r) => ask.on("close", (c) => r(c ?? -1)));
    expect(askOut.toLowerCase()).toContain("allow");
    expect(code).toBe(0);

    // last_decision appears on the agent; the app reads it as "from this phone".
    const decided = await until(() => store.getSnapshot().machines[peer.machine_id]?.agents[sid]?.last_decision);
    expect(decided.answered_by).toBe("approver");
    expect(decided.choice?.toLowerCase()).toBe("allow");
    expect(decisionVia(decided, phone.machineId)).toBe("phone");
    expect(decisionVia(decided, "m_someoneelse0000000000000000000000")).toBe("terminal");

    // Draft → edited text round trip: `notify --ask --draft` waits and prints the
    // answer (`--ask` needs a comms identity to receive it).
    go("open", "asker", "--persistent", "--global", "--harness", "service");
    const draftSentAt = Date.now();
    const nt = spawn(CLI!, [NODE, "porter", "notify", "--from", "asker", "--to", "phone", "--title", "Reply to Sabrina?", "--body", "Thursday 14:00?", "--reason", "interop draft", "--ask", "Send,Dismiss", "--draft", "Pode sim!", "--json"], { stdio: ["ignore", "pipe", "pipe"] });
    let ntOut = "";
    nt.stdout.on("data", (d) => (ntOut += d));
    nt.stderr.on("data", (d) => (ntOut += d));
    const dq = await until(() => store.getSnapshot().inbox.find((i) => i.notify.title === "Reply to Sabrina?" && !i.answer && !i.cancelled && i.receivedAt >= draftSentAt));
    expect(dq.notify.draft).toBe("Pode sim!");
    await porter.answer(dq, "Send", "Pode sim, 14h ✓");
    await new Promise<number>((r) => nt.on("close", (c) => r(c ?? -1)));
    const ntJSON = JSON.parse(ntOut.trim().split("\n").filter((l) => l.startsWith("{")).pop() ?? "{}");
    expect(ntJSON).toMatchObject({ choice: "Send", text: "Pode sim, 14h ✓" });

    go("porter", "event", "--agent", sid, "--kind", "end");
    await until(() => {
      const x = store.getSnapshot().machines[peer.machine_id]?.agents[sid];
      return !x || x.status === "ended";
    });

    // Resign: the machine answers with a fresh porter.subscribed, approver:false.
    const before = store.getSnapshot().machines[peer.machine_id]!.subscribed!.at;
    await porter.resign(peer.machine_id);
    const after = await until(() => {
      const sub = store.getSnapshot().machines[peer.machine_id]?.subscribed;
      return sub && sub.at > before ? sub : undefined;
    });
    expect(after.approver).toBe(false);
    expect(after.refused).toContain("trusts");
    await phone.stop();
  }, 120_000);
});
