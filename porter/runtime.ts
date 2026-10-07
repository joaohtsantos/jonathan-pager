// App-wide singletons: the comms node, porter store and porter client. Shared
// by the UI and by the background push task (which may run headless).
import { CommsNode } from "../comms/node";
import { asyncKV, installPRNG, secureSecrets } from "../comms/rn";
import { PorterClient } from "./client";
import { PorterStore } from "./store";
import { presentAgentPush, presentNotify } from "./notify";
import { extractPorterData, openPorterPush } from "./push";

export interface Runtime {
  node: CommsNode;
  store: PorterStore;
  porter: PorterClient;
}

let runtime: Promise<Runtime> | null = null;

export function getRuntime(): Promise<Runtime> {
  if (!runtime) {
    runtime = (async () => {
      installPRNG();
      const node = await CommsNode.load({ kv: asyncKV, secrets: secureSecrets });
      const store = new PorterStore(asyncKV);
      await store.load();
      const porter = new PorterClient(node, store, {
        onNotify: (item) => void presentNotify(store, item).catch(() => undefined),
      });
      porter.attach();
      return { node, store, porter };
    })();
    runtime.catch(() => {
      runtime = null;
    });
  }
  return runtime;
}

/**
 * Handles one push payload (from the background task or the foreground
 * listener). Returns true if it was a porter push we could open.
 */
export async function handlePorterPush(payload: unknown): Promise<boolean> {
  const data = extractPorterData(payload);
  if (!data) return false;
  const { node, store, porter: _ } = await getRuntime();
  const plain = openPorterPush(data, (id) => node.peerPublicKey(id), node.secretKey());
  if (!plain) return false; // unknown sender or forged: drop silently
  if (plain.kind === "agent") {
    await store.applyAgentPush(data.from, plain);
    await presentAgentPush(store, data.from, plain);
  } else if (plain.kind === "notify") {
    const added = await store.ingestNotify(data.from, undefined, plain.notify, "push");
    const item = store.getSnapshot().inbox.find((i) => i.id === plain.notify.id && i.fromMachine === data.from);
    if (item && (added || !item.read)) await presentNotify(store, item);
    // A question needs the comms copy too: it carries the asker's agent ID
    // that the answer must go to. Fetch it now while we are awake.
    if (item?.notify.ask?.length && !item.fromAgent && !node.isRunning && node.configured) {
      await node.drain({ quietMs: 1500, maxMs: 8000 }).catch(() => undefined);
    }
  } else if (plain.kind === "wake") {
    // Too large for a push: fetch it from the broker queue; the comms path
    // ingests and presents it.
    if (!node.isRunning) await node.drain({ quietMs: 1500, maxMs: 8000 }).catch(() => undefined);
  }
  return true;
}
