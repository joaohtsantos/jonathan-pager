// App-wide singletons: the comms node, porter store and porter client. Shared
// by the UI and by the background push task (which may run headless).
import { CommsNode } from "../comms/node";
import { asyncKV, installPRNG, secureSecrets } from "../comms/rn";
import { PorterClient } from "./client";
import { PorterStore } from "./store";
import { ACTION, dismissNotify, presentAgentPush, presentNotify, presentSendFailed, type LocalNotificationData } from "./notify";
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
        onResolved: (machine, id) => void dismissNotify(machine, id),
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

/**
 * An action button on an approval notification (Allow / Deny / Allow once),
 * pressed without opening the app: answer over comms from here. Returns false
 * when the response is not one of ours (taps, "More…").
 */
export async function handleNotificationAction(actionId: string, data: Partial<LocalNotificationData> | undefined): Promise<boolean> {
  if (!data || data.porterLocal !== "1" || data.kind !== "notify" || !data.machine || !data.id) return false;
  if (actionId !== ACTION.allow && actionId !== ACTION.deny && actionId !== ACTION.once) return false;
  const { node, store, porter } = await getRuntime();
  await store.reload();
  const item = store.getSnapshot().inbox.find((i) => i.id === data.id && i.fromMachine === data.machine);
  const ask = item?.notify.ask ?? [];
  const pick =
    actionId === ACTION.deny
      ? ask.find((c) => /^deny/i.test(c)) ?? "Deny"
      : actionId === ACTION.once
        ? ask.find((c) => /once/i.test(c)) ?? "Once"
        : ask.find((c) => /^allow/i.test(c)) ?? "Allow";
  await dismissNotify(data.machine, data.id);
  if (!item) {
    await presentSendFailed(data.machine, data.id, pick, "question not found on this phone");
    return true;
  }
  if (item.answer?.state === "sent" || item.cancelled) return true;
  try {
    const msgId = await porter.answer(item, pick);
    // send() queues on network errors instead of throwing: a queued answer
    // did not reach the broker yet.
    const st = await node.sentState(msgId);
    if (!st || st === "queued" || st === "failed") await presentSendFailed(data.machine, data.id, pick, "no connection — queued");
  } catch (e) {
    await presentSendFailed(data.machine, data.id, pick, e instanceof Error ? e.message : String(e));
  }
  return true;
}
