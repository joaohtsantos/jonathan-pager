// Local Android notifications for porter events (decrypted pushes and comms
// notifies). Design: NotifB / NotifSettings.
// - Approvals (permission / trust notifies): one notification each, standard
//   action buttons that answer without opening the app.
// - Everything else: one notification per machine ("pi · 3"), one line per
//   item, replaced in place as items arrive (expo-notifications has no Android
//   group API for local notifications, so the "group" is a single summary).
// - Five channels; each can also be switched off in the app.
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import type { PorterStore, InboxItem } from "./store";
import { notifySenderAgent } from "./store";
import type { PushPlain } from "./types";

export const CHANNELS = {
  approvals: { id: "pager-approvals", name: "Approvals", desc: "Permission and trust requests, with Allow / Deny" },
  questions: { id: "pager-questions", name: "Questions", desc: "An agent or sender asks you something" },
  special: { id: "pager-special", name: "Special agents", desc: "A starred agent stopped" },
  alerts: { id: "pager-alerts", name: "Alerts", desc: "High-priority messages" },
  messages: { id: "pager-messages", name: "Messages", desc: "Everything else" },
} as const;
export type ChannelKey = keyof typeof CHANNELS;
export const CHANNEL_ORDER: ChannelKey[] = ["approvals", "questions", "special", "alerts", "messages"];

export const CATEGORY_PERMISSION = "porter-permission";
export const CATEGORY_TRUST = "porter-trust";
export const ACTION = { allow: "allow", deny: "deny", once: "once", more: "more" } as const;

const OFF_KEY = "pager.notif.off.v1";
const GROUP_KEY = "pager.notif.groups.v1";
const GROUP_MAX_LINES = 6;

export async function setupPorterChannels(): Promise<void> {
  if (Platform.OS !== "android") return;
  const I = Notifications.AndroidImportance;
  const conf: Record<ChannelKey, Notifications.NotificationChannelInput> = {
    approvals: { name: CHANNELS.approvals.name, description: CHANNELS.approvals.desc, importance: I.MAX, vibrationPattern: [0, 400, 150, 400], lightColor: "#0A84FF", lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE },
    questions: { name: CHANNELS.questions.name, description: CHANNELS.questions.desc, importance: I.DEFAULT, vibrationPattern: [0, 250] },
    special: { name: CHANNELS.special.name, description: CHANNELS.special.desc, importance: I.LOW, sound: null, enableVibrate: false },
    alerts: { name: CHANNELS.alerts.name, description: CHANNELS.alerts.desc, importance: I.HIGH, vibrationPattern: [0, 400, 150, 400], lightColor: "#FF453A" },
    messages: { name: CHANNELS.messages.name, description: CHANNELS.messages.desc, importance: I.LOW, sound: null, enableVibrate: false },
  };
  for (const k of CHANNEL_ORDER) await Notifications.setNotificationChannelAsync(CHANNELS[k].id, conf[k]);
  // Superseded channels from the first porter build.
  for (const old of ["porter-high", "porter-default"]) await Notifications.deleteNotificationChannelAsync(old).catch(() => undefined);
  await setupCategories();
}

export async function setupCategories(): Promise<void> {
  const bg = { opensAppToForeground: false };
  await Notifications.setNotificationCategoryAsync(CATEGORY_PERMISSION, [
    { identifier: ACTION.deny, buttonTitle: "Deny", options: bg },
    { identifier: ACTION.allow, buttonTitle: "Allow", options: bg },
  ]);
  await Notifications.setNotificationCategoryAsync(CATEGORY_TRUST, [
    { identifier: ACTION.once, buttonTitle: "Allow once", options: bg },
    { identifier: ACTION.deny, buttonTitle: "Deny", options: bg },
    { identifier: ACTION.more, buttonTitle: "More…", options: { opensAppToForeground: true } },
  ]);
}

// ---- per-channel on/off (app level) ---------------------------------------------

export async function getChannelsOff(): Promise<Partial<Record<ChannelKey, true>>> {
  try {
    return JSON.parse((await AsyncStorage.getItem(OFF_KEY)) ?? "{}");
  } catch {
    return {};
  }
}

export async function setChannelOff(k: ChannelKey, off: boolean): Promise<void> {
  const cur = await getChannelsOff();
  if (off) cur[k] = true;
  else delete cur[k];
  await AsyncStorage.setItem(OFF_KEY, JSON.stringify(cur));
}

/** "Sound + pop-up" / "Sound" / "Silent" / "Off", from the live Android channel. */
export async function channelLevel(k: ChannelKey): Promise<string> {
  if (Platform.OS !== "android") return "";
  const ch = await Notifications.getNotificationChannelAsync(CHANNELS[k].id).catch(() => null);
  if (!ch) return "";
  const I = Notifications.AndroidImportance;
  if (ch.importance === I.NONE) return "Off";
  if (ch.importance >= I.HIGH) return ch.sound === null ? "Pop-up" : "Sound + pop-up";
  if (ch.importance === I.DEFAULT) return ch.sound === null ? "Silent" : "Sound";
  return "Silent";
}

// ---- routing helpers -----------------------------------------------------------------

/** Data carried by our local notifications; App and the task route with it. */
export interface LocalNotificationData {
  porterLocal: "1";
  kind: "agent" | "notify" | "group";
  machine: string;
  agent?: string;
  id?: string;
  [k: string]: unknown;
}

export const notifyNotificationId = (machine: string, id: string) => `notify:${machine}:${id}`;
const groupNotificationId = (machine: string) => `group:${machine}`;

function machineName(store: PorterStore, machineId: string, fallback?: string) {
  return store.getSnapshot().machines[machineId]?.name ?? fallback ?? machineId.slice(0, 10);
}

const shortAgent = (a?: string) => (a ? a.split(":").pop() : undefined);

/** Channel for a notify by kind / priority. */
export function channelFor(item: InboxItem): ChannelKey {
  const n = item.notify;
  if (n.kind === "permission" || n.kind === "trust") return "approvals";
  if (n.ask?.length) return "questions";
  if (n.priority === "high") return "alerts";
  return "messages";
}

async function allowed(store: PorterStore, ch: ChannelKey, machine: string, agent: string | undefined, question: boolean) {
  if ((await getChannelsOff())[ch]) return false;
  // Muted senders never notify — questions from muted senders still do.
  if (store.isSilenced(machine, agent)) {
    const p = store.getSnapshot().prefs;
    const blocked = p.blocked[`m:${machine}`] || (agent && p.blocked[`a:${machine}/${agent}`]);
    if (blocked || !question) return false;
  }
  return true;
}

// ---- per-machine group ----------------------------------------------------------------

interface GroupLine {
  key: string;
  who?: string;
  text: string;
  at: number;
  data: LocalNotificationData;
}

async function readGroups(): Promise<Record<string, GroupLine[]>> {
  try {
    return JSON.parse((await AsyncStorage.getItem(GROUP_KEY)) ?? "{}");
  } catch {
    return {};
  }
}

async function addToGroup(store: PorterStore, machine: string, line: GroupLine, channel: ChannelKey) {
  const groups = await readGroups();
  const lines = [line, ...(groups[machine] ?? []).filter((l) => l.key !== line.key)].slice(0, 20);
  groups[machine] = lines;
  await AsyncStorage.setItem(GROUP_KEY, JSON.stringify(groups));
  const name = machineName(store, machine);
  const shown = lines.slice(0, GROUP_MAX_LINES);
  const body = shown.map((l) => (l.who ? `${l.who}  ${l.text}` : l.text)).join("\n") + (lines.length > shown.length ? `\n+${lines.length - shown.length} more` : "");
  const data: LocalNotificationData = lines.length === 1 ? line.data : { porterLocal: "1", kind: "group", machine };
  await Notifications.scheduleNotificationAsync({
    identifier: groupNotificationId(machine),
    content: { title: `${name} · ${lines.length}`, body, data, sound: channel === "questions" || channel === "alerts" ? "default" : undefined },
    trigger: Platform.OS === "android" ? { channelId: CHANNELS[channel].id } : null,
  });
}

/** The user looked at the inbox: drop the per-machine summaries. */
export async function clearGroups(): Promise<void> {
  const groups = await readGroups();
  await AsyncStorage.setItem(GROUP_KEY, "{}");
  await Promise.all(Object.keys(groups).map((m) => Notifications.dismissNotificationAsync(groupNotificationId(m)).catch(() => undefined)));
}

// ---- presenters ---------------------------------------------------------------------------

export async function presentAgentPush(store: PorterStore, from: string, p: Extract<PushPlain, { kind: "agent" }>) {
  const needs = p.status === "needs_you";
  const ch: ChannelKey = needs ? "questions" : "special";
  if (!(await allowed(store, ch, from, p.agent, needs))) return;
  // Same agent entering the same status twice within a minute → one line.
  if (!(await store.claimShown(`agent:${from}:${p.agent}:${p.status}`, 60_000))) return;
  const text = needs
    ? p.needs?.text
      ? `${p.needs.kind === "input" ? "asks: " : "needs approval: "}${p.needs.text.replace(/^Bash:\s*/, "")}`
      : "needs you"
    : `finished${p.summary ? ` · ${p.summary}` : ""}`;
  await addToGroup(store, from, { key: `agent:${p.agent}`, who: p.title || p.agent.slice(0, 8), text, at: Date.now(), data: { porterLocal: "1", kind: "agent", machine: from, agent: p.agent } }, ch);
}

export async function presentNotify(store: PorterStore, item: InboxItem) {
  const n = item.notify;
  const ch = channelFor(item);
  const sender = notifySenderAgent(item);
  if (!(await allowed(store, ch, item.fromMachine, sender, !!n.ask?.length))) return;
  if (!(await store.claimShown(`notify:${item.fromMachine}:${item.id}`, 7 * 86_400_000))) return;
  const data: LocalNotificationData = { porterLocal: "1", kind: "notify", machine: item.fromMachine, id: item.id };
  const name = machineName(store, item.fromMachine, n.context?.machine);

  if (ch === "approvals") {
    const who = shortAgent(n.context?.agent) ?? n.context?.title ?? "an agent";
    const title =
      n.kind === "trust"
        ? `${n.trust?.sender ?? "A peer"} wants to give orders to ${shortAgent(n.trust?.receiver) ?? who}`
        : /^Bash:/.test(n.body ?? "")
          ? `${who} wants to run a command`
          : n.title;
    const body = n.kind === "trust" ? n.body ?? "" : (n.body ?? n.title).replace(/^Bash:\s*/, "");
    await Notifications.scheduleNotificationAsync({
      identifier: notifyNotificationId(item.fromMachine, item.id),
      content: { title, body, subtitle: name, data, sound: "default", categoryIdentifier: n.kind === "trust" ? CATEGORY_TRUST : CATEGORY_PERMISSION, sticky: false },
      trigger: Platform.OS === "android" ? { channelId: CHANNELS.approvals.id } : null,
    });
    return;
  }

  const who = ch === "alerts" ? "Alert" : shortAgent(sender);
  await addToGroup(store, item.fromMachine, { key: `notify:${item.id}`, who, text: n.title, at: Date.now(), data }, ch);
}

/** Removes an approval notification (answered in-app, or porter.cancel). */
export async function dismissNotify(machine: string, id: string): Promise<void> {
  await Notifications.dismissNotificationAsync(notifyNotificationId(machine, id)).catch(() => undefined);
}

export async function presentSendFailed(machine: string, id: string, choice: string, why: string): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    identifier: `failed:${machine}:${id}`,
    content: { title: "Couldn't send — open the app", body: `${choice}: ${why}`, data: { porterLocal: "1", kind: "notify", machine, id } satisfies LocalNotificationData, sound: "default" },
    trigger: Platform.OS === "android" ? { channelId: CHANNELS.approvals.id } : null,
  });
}
