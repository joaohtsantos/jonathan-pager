// Live interop against a real Go comms broker + node. Skipped unless
// COMMS_IT_BROKER (broker URL) and COMMS_IT_CLI (a wrapper that runs
// `comms --data-dir <scratch node> ...` for the node named in arg 1) are set.
// Scratch setup (never the live node — unset COMMS_SOCKET/COMMS_DATA_DIR!):
//   comms --data-dir D --socket D/node.sock serve --broker-listen 127.0.0.1:47811 &
//   comms --data-dir D --socket D/node.sock name mac
//   comms --data-dir D --socket D/node.sock broker http://127.0.0.1:47811
// COMMS_IT_CLI is a script `cli NODE args...` wrapping exactly that invocation.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CommsNode, type InboundMessage } from "../node";
import { MemoryKV } from "../storage";
import { fetchStream } from "../stream";

const BROKER = process.env.COMMS_IT_BROKER;
const CLI = process.env.COMMS_IT_CLI;
const NODE = process.env.COMMS_IT_NODE ?? "mac";

const go = (...args: string[]) => execFileSync(CLI!, [NODE, ...args], { encoding: "utf8" });
const goJSON = (...args: string[]) => JSON.parse(go(...args, "--json"));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => T | Promise<T>, ms = 15000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out");
    await sleep(250);
  }
}

describe.skipIf(!BROKER || !CLI)("interop with Go comms", () => {
  it("auths, pairs, and exchanges messages + receipts both ways", async () => {
    const kv = new MemoryKV();
    const phone = await CommsNode.load({ kv, secrets: new MemoryKV(), openStream: fetchStream() });
    await phone.configureBroker(BROKER!); // challenge → openAnonymous → complete

    // Pair both ways, grant both ways.
    const macBundle = goJSON("export", "--alias", NODE);
    const peer = await phone.pair(JSON.stringify(macBundle));
    const bundlePath = join(tmpdir(), `phone-bundle-${Date.now()}.json`);
    writeFileSync(bundlePath, JSON.stringify(phone.identityBundle("phone")));
    const alias = `phone${Date.now() % 1_000_000}`; // unique per run on a reused scratch node
    go("pair", "--file", bundlePath, "--alias", alias);
    go("grant", alias);
    go("open", "bot", "--persistent", "--global", "--harness", "service");

    const received: InboundMessage[] = [];
    phone.onMessage((m) => void received.push(m));
    phone.start();
    await until(() => phone.connection === "online");

    // Phone → Go agent.
    const agentId = await until(async () => {
      try {
        return await phone.resolveAgent(peer.machine_id, "bot", true);
      } catch {
        return "";
      }
    });
    expect(agentId).toMatch(/^a_[0-9a-f]{32}$/);
    const body = JSON.stringify({ type: "porter.answer", v: 1, id: "ntf_x", choice: "Allow <ção>" });
    const id = await phone.send(peer.machine_id, "bot", body);
    const inbox = await until(() => {
      const page = goJSON("inbox", "bot");
      return (page.messages ?? []).find((m: { id: string }) => m.id === id);
    });
    expect(inbox.body).toBe(body);
    // Go node's receipt comes back over the stream.
    await until(async () => ["received", "handed_off"].includes((await phone.sentState(id)) ?? ""));

    // Go agent → phone (live stream).
    const sent = goJSON("post", "--from", "bot", "--to", `${alias}:app`, "hello phone ✓");
    const got = (await until(() => received.find((m) => m.id === sent.id)))!;
    expect(got.body).toBe("hello phone ✓");
    expect(got.fromAgent).toBe(agentId);
    // Phone's handed_off receipt reaches the Go node.
    await until(() => goJSON("status", sent.id).state === "handed_off");

    // Offline queue → drain on resume.
    await phone.stop();
    const later = goJSON("post", "--from", "bot", "--to", `${alias}:app`, "while you were away");
    await until(() => ["forwarded", "queued"].includes(goJSON("status", later.id).state) || true);
    await sleep(1500);
    await phone.drain({ quietMs: 1500, maxMs: 15000 });
    expect(received.find((m) => m.id === later.id)?.body).toBe("while you were away");
    await until(() => goJSON("status", later.id).state === "handed_off");
  }, 90_000);
});
