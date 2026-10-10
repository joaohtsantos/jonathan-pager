// Inbox (design: InboxK3). "Waiting on you" raised cards with a blue Answer
// button, then the timeline by day: porter notifies + legacy pager-api pushes.
// Fixed 68px rows; colored icon per kind, no status dots; unread = bold white.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import * as Notifications from "expo-notifications";
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { usePorter, usePorterState, useTick } from "../../porter/PorterProvider";
import { filterInbox, formatClock, formatHM, groupByDay, notifyLook, resolutionText, senderParts, splitInbox } from "../../porter/selectors";
import type { InboxItem } from "../../porter/store";
import { fetchPendingRequests, fetchPushes, markAllPushesRead, pagerConfigured, setPushRead, type PagerPush } from "../../lib/pagerApi";
import type { InboxStackParamList } from "../../navigation/types";
import { Empty, LargeHeader, OfflineBanner, MenuSheet, Screen, T, type MenuOption } from "../../components/ui";
import ConfirmModal from "../../components/ConfirmModal";
import { useToast } from "../../components/Toast";
import { KindIcon, Sender } from "./inboxLook";
import { clearGroups } from "../../porter/notify";
import { t } from "../../theme";

type Nav = NativeStackNavigationProp<InboxStackParamList>;
type Entry = { kind: "porter"; at: number; item: InboxItem } | { kind: "pager"; at: number; push: PagerPush };

const PAGER = "__pager__";

export default function InboxScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<RouteProp<InboxStackParamList, "InboxList">>();
  const { rt, version, store, mock, phoneOffline, lastOnlineAt } = usePorter();
  const state = usePorterState();
  const toast = useToast();
  const now = useTick(1000);
  const [pushes, setPushes] = useState<PagerPush[]>([]);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [pagerError, setPagerError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [machineFilter, setMachineFilter] = useState<string | undefined>(route.params?.machine);
  const agentFilter = route.params?.agent;
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const pagerOn = pagerConfigured() && !mock;

  useEffect(() => setMachineFilter(route.params?.machine), [route.params?.machine]);

  const loadPager = useCallback(async () => {
    if (!pagerConfigured()) return;
    try {
      const [p, r] = await Promise.all([fetchPushes(50), fetchPendingRequests()]);
      setPushes(p);
      setPendingRequests(r.length);
      setPagerError("");
    } catch (e) {
      setPagerError(String(e));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadPager();
      void clearGroups().catch(() => undefined);
    }, [loadPager])
  );

  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((n) => {
      const data = n.request.content.data as { porterLocal?: string } | undefined;
      if (!data?.porterLocal) void loadPager();
    });
    const tm = setInterval(loadPager, 60_000);
    return () => {
      sub.remove();
      clearInterval(tm);
    };
  }, [loadPager]);

  const names = useMemo(() => {
    const out: Record<string, string> = {};
    for (const p of rt?.node.peers() ?? []) out[p.machine_id] = p.alias;
    for (const m of Object.values(state.machines)) if (m.name) out[m.machineId] = m.name;
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rt, version, state.machines]);
  const nameOf = (id: string) => names[id] ?? id.slice(0, 10);

  const porterItems = filterInbox(state.inbox, { machine: machineFilter === PAGER ? "__none__" : machineFilter, agent: agentFilter });
  const { questions, rest } = splitInbox(porterItems, now);
  const showPager = pagerOn && !agentFilter && (!machineFilter || machineFilter === PAGER);

  const timeline: Entry[] = useMemo(() => {
    const e: Entry[] = rest.map((item) => ({ kind: "porter" as const, at: item.receivedAt, item }));
    if (showPager) for (const push of pushes) e.push({ kind: "pager", at: Date.parse(push.created_at) || 0, push });
    return e.sort((a, b) => b.at - a.at);
  }, [rest, pushes, showPager]);
  const days = groupByDay(timeline, (e) => e.at, now);

  const unreadPorter = state.inbox.filter((i) => !i.read).length;
  const unreadPager = pagerOn ? pushes.filter((p) => !p.read).length : 0;
  const openQuestions = splitInbox(state.inbox, now).questions.length;
  const attention = unreadPorter + unreadPager + (pagerOn ? pendingRequests : 0) + openQuestions;

  useEffect(() => {
    nav.getParent()?.setOptions({ tabBarBadge: attention > 0 ? " " : undefined });
  }, [nav, attention]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadPager();
    if (!mock && rt?.node.configured && !rt.node.isRunning) await rt.node.drain().catch(() => undefined);
    setRefreshing(false);
  };

  const markAll = async () => {
    setConfirm(false);
    await store?.markAllRead();
    if (unreadPager > 0) {
      try {
        await markAllPushesRead();
        setPushes((p) => p.map((x) => ({ ...x, read: 1 })));
      } catch {
        toast.show("Pager mark-all failed");
      }
    }
    toast.show("Marked all read");
  };

  const togglePagerRead = async (p: PagerPush) => {
    try {
      await setPushRead(p.id, !p.read);
      setPushes((list) => list.map((x) => (x.id === p.id ? { ...x, read: p.read ? 0 : 1 } : x)));
    } catch {
      toast.show("Failed");
    }
  };

  /** Permission asks open the agent (StatePermission) when it is known. */
  const openItem = (i: InboxItem) => {
    const session = i.notify.context?.session;
    const m = state.machines[i.fromMachine];
    if (i.notify.kind === "permission" && session && m?.agents[session] && m.agents[session].status === "needs_you") {
      nav.navigate("AgentDetail", { machine: i.fromMachine, agent: session, from: "Inbox" });
    } else nav.navigate("InboxItem", { machine: i.fromMachine, id: i.id });
  };

  const machinesInInbox = Array.from(new Set(state.inbox.map((i) => i.fromMachine)));
  const filterLabel = agentFilter ? `${nameOf(machineFilter ?? "")}:${agentFilter.split(":").pop()}` : machineFilter === PAGER ? "Pager" : machineFilter ? nameOf(machineFilter) : "All senders";

  const menuOptions: MenuOption[] = [
    { key: "all", label: "All senders", checked: !machineFilter && !agentFilter, onPress: () => { setMachineFilter(undefined); nav.setParams({ agent: undefined, machine: undefined }); } },
    ...machinesInInbox.map((m) => ({ key: m, label: nameOf(m), checked: machineFilter === m && !agentFilter, onPress: () => { setMachineFilter(m); nav.setParams({ agent: undefined }); } })),
    ...(pagerOn ? [{ key: PAGER, label: "Pager (legacy)", checked: machineFilter === PAGER, onPress: () => setMachineFilter(PAGER) }] : []),
    ...(pagerOn ? [{ key: "log", label: "Pager log…", color: t.accent, onPress: () => nav.navigate("PushList") }] : []),
    ...(unreadPorter + unreadPager > 0 ? [{ key: "read", label: "Mark all read", color: t.accent, onPress: () => setConfirm(true) }] : []),
  ];

  const waitingCount = questions.length + (showPager && pendingRequests > 0 ? 1 : 0);

  return (
    <Screen inbox>
      <LargeHeader
        title="Inbox"
        right={
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Pressable onPress={() => setMenu(true)} hitSlop={6} style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 8 }}>
              <T size={13} color="rgba(255,255,255,0.75)">{filterLabel} ▾</T>
            </Pressable>
            <Pressable onPress={() => nav.navigate("Senders")} hitSlop={6} style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 8 }}>
              <T size={15} weight="600" color={t.accent}>Senders</T>
            </Pressable>
          </View>
        }
      />
      <OfflineBanner offline={phoneOffline} since={lastOnlineAt} />
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, gap: 24, paddingBottom: 20 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.faint} colors={[t.accent]} progressBackgroundColor={t.sheet} />}
      >
        {waitingCount > 0 ? (
          <View>
            <SecH title="Waiting on you" count={waitingCount} />
            {questions.map((q) => {
              const sp = senderParts(q, nameOf(q.fromMachine));
              const exp = q.notify.expires_at ? Date.parse(q.notify.expires_at) : 0;
              const when = exp ? (exp - now < 3600_000 ? `${formatClock(exp - now)} left` : `until ${formatHM(exp)}`) : "";
              return (
                <Pressable key={`${q.fromMachine}/${q.id}`} onPress={() => openItem(q)} style={({ pressed }) => [s.card, pressed && { opacity: 0.8 }]}>
                  <KindIcon look={notifyLook(q, now)} />
                  <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                    <T size={15} weight="600" color={t.white} lines={1}>{q.notify.title}</T>
                    <View style={{ flexDirection: "row", gap: 6, overflow: "hidden" }}>
                      <Sender machine={sp.machine} agent={sp.agent} />
                      {when ? <T size={12} color={t.text3} lines={1}>· {when}</T> : null}
                    </View>
                  </View>
                  <View style={s.answer}>
                    <T size={14} weight="600" color={t.white}>Answer</T>
                  </View>
                </Pressable>
              );
            })}
            {showPager && pendingRequests > 0 ? (
              <Pressable onPress={() => nav.navigate("Requests")} style={({ pressed }) => [s.card, pressed && { opacity: 0.8 }]}>
                <KindIcon look="question" />
                <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                  <T size={15} weight="600" color={t.white} lines={1}>{`${pendingRequests} pending request${pendingRequests === 1 ? "" : "s"}`}</T>
                  <T mono size={12} color="rgba(255,255,255,0.45)">pager-api · action cards</T>
                </View>
                <View style={s.answer}>
                  <T size={14} weight="600" color={t.white}>Open</T>
                </View>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {days.map((d) => (
          <View key={d.day}>
            <SecH title={d.day} />
            <View style={s.list}>
              {d.items.map((e) =>
                e.kind === "porter" ? (
                  <PorterRow key={`p/${e.item.fromMachine}/${e.item.id}`} item={e.item} machineName={nameOf(e.item.fromMachine)} now={now} onPress={() => openItem(e.item)} onLongPress={() => store?.updateInbox(e.item.id, e.item.fromMachine, (i) => ({ ...i, read: !i.read }))} />
                ) : (
                  <PagerRow key={`g/${e.push.id}`} push={e.push} onPress={() => nav.navigate("PushDetail", { id: e.push.id })} onLongPress={() => togglePagerRead(e.push)} />
                )
              )}
            </View>
          </View>
        ))}

        {!waitingCount && !days.length ? <Empty icon="check" title="All clear" hint={machineFilter || agentFilter ? "Nothing from this sender." : "Nothing waiting on you and no messages in the last 7 days."} /> : null}
        {pagerError && showPager ? <T size={11} color={t.faint} style={{ marginHorizontal: 20 }}>pager-api: {pagerError}</T> : null}
      </ScrollView>
      <MenuSheet visible={menu} title="Show" options={menuOptions} onClose={() => setMenu(false)} />
      <ConfirmModal visible={confirm} title="Mark all read" body={`Mark ${unreadPorter + unreadPager} item(s) as read?`} confirmLabel="Mark all" onConfirm={markAll} onCancel={() => setConfirm(false)} />
    </Screen>
  );
}

function SecH({ title, count }: { title: string; count?: number }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "baseline", gap: 7, paddingHorizontal: 20, marginBottom: 8 }}>
      <T size={15} weight="700" color={t.white}>{title}</T>
      {count !== undefined ? <T size={12} weight="500" color={t.text3}>{count}</T> : null}
    </View>
  );
}

function PorterRow({ item, machineName, now, onPress, onLongPress }: { item: InboxItem; machineName: string; now: number; onPress: () => void; onLongPress: () => void }) {
  const look = notifyLook(item, now);
  const read = item.read || look === "answered";
  const sp = senderParts(item, machineName);
  const line = look === "answered" ? resolutionText(item, sp.machine) : item.notify.body;
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} style={({ pressed }) => [s.row, pressed && { backgroundColor: t.fill }]}>
      <KindIcon look={look} dim={read} />
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "baseline" }}>
          <T size={15} weight={read ? "400" : "600"} color={read ? "rgba(255,255,255,0.65)" : t.white} lines={1} style={{ flex: 1 }}>
            {item.notify.title}
          </T>
          <T mono size={12} color={t.text3}>{formatHM(item.receivedAt)}</T>
        </View>
        <View style={{ flexDirection: "row", overflow: "hidden" }}>
          <Sender machine={sp.machine} agent={sp.agent} read={read} />
          {line ? (
            <T size={12} color={read ? t.text3 : t.text2} lines={1} style={{ flexShrink: 1 }}>
              {" · "}
              {line.replace(/\s+/g, " ")}
            </T>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

function PagerRow({ push, onPress, onLongPress }: { push: PagerPush; onPress: () => void; onLongPress: () => void }) {
  const read = !!push.read;
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} style={({ pressed }) => [s.row, pressed && { backgroundColor: t.fill }]}>
      <KindIcon look={push.category === "urgent" ? "high" : "message"} dim={read} />
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "baseline" }}>
          <T size={15} weight={read ? "400" : "600"} color={read ? "rgba(255,255,255,0.65)" : t.white} lines={1} style={{ flex: 1 }}>
            {push.title}
          </T>
          <T mono size={12} color={t.text3}>{formatHM(Date.parse(push.created_at) || 0)}</T>
        </View>
        <View style={{ flexDirection: "row", overflow: "hidden" }}>
          <Sender machine="pager" agent={push.source} read={read} />
          {push.body ? (
            <T size={12} color={read ? t.text3 : t.text2} lines={1} style={{ flexShrink: 1 }}>
              {" · "}
              {push.body.replace(/\s+/g, " ")}
            </T>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: 12, height: 68, backgroundColor: t.raised, borderRadius: 12, marginHorizontal: 12, marginBottom: 8, paddingHorizontal: 12 },
  answer: { minHeight: 34, paddingHorizontal: 12, borderRadius: 8, backgroundColor: t.accent, justifyContent: "center" },
  list: { borderTopWidth: 1, borderTopColor: t.divider },
  row: { flexDirection: "row", alignItems: "center", gap: 12, height: 68, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: t.divider },
});
