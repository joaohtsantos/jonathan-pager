// Local notifications for porter events (decrypted pushes and comms notifies).
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { colors } from "../theme";
import type { PorterStore, InboxItem } from "./store";
import { notifySenderAgent } from "./store";
import type { PushPlain } from "./types";

export const CHANNEL_HIGH = "porter-high";
export const CHANNEL_DEFAULT = "porter-default";

export async function setupPorterChannels(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(CHANNEL_HIGH, {
    name: "Agents · needs you",
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 400, 150, 400],
    lightColor: colors.urgent,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
  await Notifications.setNotificationChannelAsync(CHANNEL_DEFAULT, {
    name: "Agents · updates",
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 200],
    lightColor: colors.info,
  });
}

/** Data carried by our local notifications; App routes taps with it. */
export interface LocalNotificationData {
  porterLocal: "1";
  kind: "agent" | "notify";
  machine: string;
  agent?: string;
  id?: string;
  [k: string]: unknown;
}

async function present(title: string, body: string, data: LocalNotificationData, high: boolean) {
  await Notifications.scheduleNotificationAsync({
    content: { title, body, data, sound: high ? "default" : undefined },
    trigger: Platform.OS === "android" ? { channelId: high ? CHANNEL_HIGH : CHANNEL_DEFAULT } : null,
  });
}

function machineName(store: PorterStore, machineId: string, fallback?: string) {
  return store.getSnapshot().machines[machineId]?.name ?? fallback ?? machineId.slice(0, 10);
}

export async function presentAgentPush(store: PorterStore, from: string, p: Extract<PushPlain, { kind: "agent" }>) {
  if (store.isSilenced(from, p.agent)) return;
  // Same agent entering the same status twice within a minute → one notification.
  if (!(await store.claimShown(`agent:${from}:${p.agent}:${p.status}`, 60_000))) return;
  const who = `${machineName(store, from, p.machine)} · ${p.title || p.agent.slice(0, 8)}`;
  const needs = p.status === "needs_you";
  const body = needs
    ? p.needs?.text
      ? `${p.needs.kind === "input" ? "Waiting for input" : "Permission"}: ${p.needs.text}`
      : "Needs you"
    : p.summary || (p.status === "done" ? "Finished" : p.status);
  await present(who, body, { porterLocal: "1", kind: "agent", machine: from, agent: p.agent }, needs);
}

export async function presentNotify(store: PorterStore, item: InboxItem) {
  if (store.isSilenced(item.fromMachine, notifySenderAgent(item))) return;
  if (!(await store.claimShown(`notify:${item.fromMachine}:${item.id}`, 7 * 86_400_000))) return;
  const n = item.notify;
  const ctx = n.context?.agent ? ` · ${n.context.agent}` : n.context?.title ? ` · ${n.context.title}` : "";
  const title = `${n.title}`;
  const parts = [n.body, n.ask?.length ? `[ ${n.ask.join(" / ")} ]` : ""].filter(Boolean);
  await present(
    title,
    [...parts, `${n.context?.agent ? n.context.agent : machineName(store, item.fromMachine, n.context?.machine) + ctx}`].join("\n"),
    { porterLocal: "1", kind: "notify", machine: item.fromMachine, id: item.id },
    n.priority === "high" || !!n.ask?.length
  );
}
