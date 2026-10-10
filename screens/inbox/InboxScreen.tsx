// Inbox (design: InboxK3). "Waiting on you" raised cards with a blue Answer
// button (porter questions + pending pager-api requests, first 5 then "N more"),
// then the timeline by day: porter notifies + legacy pager-api pushes.
// Fixed 68px rows; colored icon per kind, no status dots; unread = bold white.
// Bulk actions: long-press a row (or "Select") → round checkboxes, "N selected"
// header, bottom bar Mark seen / Dismiss (logic in ./selection).
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { BackHandler, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import * as Notifications from "expo-notifications";
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { usePorter, usePorterState, useTick } from "../../porter/PorterProvider";
import { filterInbox, formatClock, formatHM, groupByDay, notifyLook, resolutionText, senderParts, splitInbox } from "../../porter/selectors";
import type { InboxItem } from "../../porter/store";
import { answerRequest, fetchPendingRequests, fetchPushes, markAllPushesRead, pagerConfigured, setPushRead, type PagerPush, type PagerRequest } from "../../lib/pagerApi";
import { usePersisted } from "../../lib/usePersisted";
import type { InboxStackParamList } from "../../navigation/types";
import { BigButton, BottomBar, ButtonPair, Empty, LargeHeader, OfflineBanner, MenuSheet, Screen, T, TextBtn, type MenuOption } from "../../components/ui";
import ConfirmModal from "../../components/ConfirmModal";
import { useToast } from "../../components/Toast";
import { KindIcon, SelectCircle, Sender } from "./inboxLook";
import { addDismissed, allSelected, dismissConfirm, initialSel, planDismiss, porterKey, pushKey, requestKey, runBatched, selReducer, type DismissPlan, type SelKey } from "./selection";
import { clearGroups } from "../../porter/notify";
import { t } from "../../theme";

type Nav = NativeStackNavigationProp<InboxStackParamList>;
type Entry = { kind: "porter"; at: number; item: InboxItem } | { kind: "pager"; at: number; push: PagerPush };

const PAGER = "__pager__";
const WAITING_CAP = 5;
const PRIO = { high: 0, medium: 1, low: 2 } as const;
const CONCURRENCY = 5;
const entryKey = (e: Entry) => (e.kind === "porter" ? porterKey(e.item.fromMachine, e.item.id) : pushKey(e.push.id));

export default function InboxScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<RouteProp<InboxStackParamList, "InboxList">>();
  const { rt, version, store, mock, phoneOffline, lastOnlineAt } = usePorter();
  const state = usePorterState();
  const toast = useToast();
  const now = useTick(1000);
  const [pushes, setPushes] = useState<PagerPush[]>([]);
  const [requests, setRequests] = useState<PagerRequest[]>([]);
  const [showAllWaiting, setShowAllWaiting] = useState(false);
  const [pagerError, setPagerError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [machineFilter, setMachineFilter] = useState<string | undefined>(route.params?.machine);
  const agentFilter = route.params?.agent;
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const pagerOn = pagerConfigured() && !mock;
  const [sel, dispatch] = useReducer(selReducer, initialSel);
  const [dismissed, setDismissed] = usePersisted<SelKey[]>("ui.inbox.dismissed.v1", []);
  const dismissedSet = useMemo(() => new Set(dismissed), [dismissed]);
  const [progress, setProgress] = useState("");
  const [bulkConfirm, setBulkConfirm] = useState<{ title: string; body: string; plan: DismissPlan } | null>(null);

  useEffect(() => setMachineFilter(route.params?.machine), [route.params?.machine]);

  const loadPager = useCallback(async () => {
    if (!pagerConfigured()) return;
    try {
      const [p, r] = await Promise.all([fetchPushes(50), fetchPendingRequests()]);
      setPushes(p);
      setRequests(r);
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

  const porterItems = filterInbox(state.inbox, { machine: machineFilter === PAGER ? "__none__" : machineFilter, agent: agentFilter }).filter(
    (i) => !dismissedSet.has(porterKey(i.fromMachine, i.id))
  );
  const { questions, rest } = splitInbox(porterItems, now);
  const showPager = pagerOn && !agentFilter && (!machineFilter || machineFilter === PAGER);

  const timeline: Entry[] = useMemo(() => {
    const e: Entry[] = rest.map((item) => ({ kind: "porter" as const, at: item.receivedAt, item }));
    if (showPager) for (const push of pushes) if (!dismissedSet.has(pushKey(push.id))) e.push({ kind: "pager", at: Date.parse(push.created_at) || 0, push });
    return e.sort((a, b) => b.at - a.at);
  }, [rest, pushes, showPager, dismissedSet]);
  const days = groupByDay(timeline, (e) => e.at, now);

  const unreadPorter = state.inbox.filter((i) => !i.read && !dismissedSet.has(porterKey(i.fromMachine, i.id))).length;
  const unreadPager = pagerOn ? pushes.filter((p) => !p.read && !dismissedSet.has(pushKey(p.id))).length : 0;
  const openQuestions = splitInbox(state.inbox, now).questions.length;
  const attention = unreadPorter + unreadPager + (pagerOn ? requests.length : 0) + openQuestions;

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
    toast.show("Marked all seen");
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
    ...(unreadPorter + unreadPager > 0 ? [{ key: "read", label: "Mark all seen", color: t.accent, onPress: () => setConfirm(true) }] : []),
  ];

  const pagerWaiting = useMemo(
    () => (showPager ? [...requests].sort((a, b) => (PRIO[a.priority] ?? 2) - (PRIO[b.priority] ?? 2) || b.created_at.localeCompare(a.created_at)) : []),
    [requests, showPager]
  );
  const waitingCount = questions.length + pagerWaiting.length;
  const waitingCap = showAllWaiting ? Infinity : WAITING_CAP;
  const shownQuestions = questions.slice(0, waitingCap);
  const shownRequests = pagerWaiting.slice(0, Math.max(0, waitingCap - shownQuestions.length));
  const hiddenWaiting = waitingCount - shownQuestions.length - shownRequests.length;

  // ---- selection / bulk actions ----
  // Everything the current sender filter shows (incl. waiting cards past the cap).
  const visibleKeys = useMemo(
    () => [...questions.map((q) => porterKey(q.fromMachine, q.id)), ...pagerWaiting.map((r) => requestKey(r.id)), ...timeline.map(entryKey)],
    [questions, pagerWaiting, timeline]
  );
  const visibleSig = visibleKeys.join("|");
  useEffect(() => {
    dispatch({ type: "prune", visible: visibleKeys });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleSig]);
  const questionKeys = useMemo(() => new Set(questions.map((q) => porterKey(q.fromMachine, q.id))), [questions]);
  const selecting = sel.active;
  const selectedSet = new Set(sel.selected);
  const nSel = sel.selected.length;
  const busy = progress !== "";

  useFocusEffect(
    useCallback(() => {
      if (!selecting) return;
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        dispatch({ type: "exit" });
        return true;
      });
      return () => sub.remove();
    }, [selecting])
  );

  const pressRow = (key: SelKey, open: () => void) => (selecting ? dispatch({ type: "toggle", key }) : open());
  const longPressRow = (key: SelKey) => dispatch({ type: "enter", key });

  const bulkMarkSeen = async () => {
    const keys = sel.selected;
    const porter = state.inbox.filter((i) => !i.read && keys.includes(porterKey(i.fromMachine, i.id)));
    const pushIds = pushes.filter((p) => !p.read && keys.includes(pushKey(p.id))).map((p) => p.id);
    await Promise.all(porter.map((i) => store?.updateInbox(i.id, i.fromMachine, (x) => ({ ...x, read: true }))));
    let failed = 0;
    if (pushIds.length) {
      const ids = new Set(pushIds);
      setPushes((l) => l.map((x) => (ids.has(x.id) ? { ...x, read: 1 } : x)));
      setProgress(`Marking seen 0/${pushIds.length}`);
      const res = await runBatched(pushIds, (id) => setPushRead(id, true), CONCURRENCY, (d, n) => setProgress(`Marking seen ${d}/${n}`));
      failed = res.failed.length;
      setProgress("");
    }
    dispatch({ type: "exit" });
    const n = porter.length + pushIds.length;
    toast.show(failed ? `Marked ${n - failed} seen · ${failed} failed` : `Marked ${n} seen`, failed ? 3000 : 1500);
  };

  const doDismiss = async (plan: DismissPlan) => {
    setBulkConfirm(null);
    if (plan.local.length) setDismissed(addDismissed(dismissed, plan.local));
    let ok = 0;
    let failed = 0;
    if (plan.requests.length) {
      const byId = new Map(requests.map((r) => [r.id, r]));
      const reqs = plan.requests.map((id) => byId.get(id)).filter((r): r is PagerRequest => !!r);
      setProgress(`Dismissing 0/${reqs.length}`);
      const res = await runBatched(reqs, (r) => answerRequest(r, "rejected"), CONCURRENCY, (d, n) => setProgress(`Dismissing ${d}/${n}`));
      const done = new Set(res.ok.map((r) => r.id));
      setRequests((l) => l.filter((r) => !done.has(r.id)));
      ok = res.ok.length;
      failed = res.failed.length + (plan.requests.length - reqs.length);
      setProgress("");
    }
    dispatch({ type: "exit" });
    const parts = [`Dismissed ${plan.local.length + ok}`];
    if (failed) parts.push(`${failed} failed`);
    if (plan.kept.length) parts.push(`${plan.kept.length} kept`);
    toast.show(parts.join(" · "), failed ? 3000 : 1500);
  };

  const startDismiss = () => {
    const plan = planDismiss(sel.selected, (k) => questionKeys.has(k));
    if (!plan.local.length && !plan.requests.length) {
      toast.show(plan.kept.length === 1 ? "That question needs an answer" : "These questions need an answer", 2500);
      return;
    }
    const c = dismissConfirm(plan);
    if (c) setBulkConfirm({ ...c, plan });
    else void doDismiss(plan);
  };

  return (
    <Screen inbox>
      <LargeHeader
        title={selecting ? `${nSel} selected` : "Inbox"}
        right={
          selecting ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <TextBtn label={allSelected(sel, visibleKeys) ? "Deselect all" : "Select all"} size={15} disabled={busy || !visibleKeys.length} onPress={() => dispatch({ type: "toggleAll", keys: visibleKeys })} />
              <TextBtn label="Cancel" size={15} disabled={busy} onPress={() => dispatch({ type: "exit" })} />
            </View>
          ) : (
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Pressable onPress={() => setMenu(true)} hitSlop={6} style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 8 }}>
              <T size={13} color="rgba(255,255,255,0.75)">{filterLabel} ▾</T>
            </Pressable>
            {visibleKeys.length ? (
              <Pressable onPress={() => dispatch({ type: "enter" })} hitSlop={6} style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 8 }}>
                <T size={15} weight="600" color={t.accent}>Select</T>
              </Pressable>
            ) : null}
            <Pressable onPress={() => nav.navigate("Senders")} hitSlop={6} style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 8 }}>
              <T size={15} weight="600" color={t.accent}>Senders</T>
            </Pressable>
          </View>
          )
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
            {shownQuestions.map((q) => {
              const sp = senderParts(q, nameOf(q.fromMachine));
              const exp = q.notify.expires_at ? Date.parse(q.notify.expires_at) : 0;
              const when = exp ? (exp - now < 3600_000 ? `${formatClock(exp - now)} left` : `until ${formatHM(exp)}`) : "";
              const key = porterKey(q.fromMachine, q.id);
              return (
                <Pressable key={`${q.fromMachine}/${q.id}`} onPress={() => pressRow(key, () => openItem(q))} onLongPress={() => longPressRow(key)} style={({ pressed }) => [s.card, pressed && { opacity: 0.8 }]}>
                  {selecting ? <SelectCircle on={selectedSet.has(key)} /> : null}
                  <KindIcon look={notifyLook(q, now)} />
                  <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                    <T size={15} weight="600" color={t.white} lines={1}>{q.notify.title}</T>
                    <View style={{ flexDirection: "row", gap: 6, overflow: "hidden" }}>
                      <Sender machine={sp.machine} agent={sp.agent} />
                      {when ? <T size={12} color={t.text3} lines={1}>· {when}</T> : null}
                    </View>
                  </View>
                  {selecting ? null : (
                    <View style={s.answer}>
                      <T size={14} weight="600" color={t.white}>Answer</T>
                    </View>
                  )}
                </Pressable>
              );
            })}
            {shownRequests.map((r) => (
              <Pressable key={`r/${r.id}`} onPress={() => pressRow(requestKey(r.id), () => nav.navigate("PagerItem", { request: r }))} onLongPress={() => longPressRow(requestKey(r.id))} style={({ pressed }) => [s.card, pressed && { opacity: 0.8 }]}>
                {selecting ? <SelectCircle on={selectedSet.has(requestKey(r.id))} /> : null}
                <KindIcon look={r.priority === "high" ? "high" : "question"} />
                <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                  <T size={15} weight="600" color={t.white} lines={1}>{r.email_subject ?? r.summary}</T>
                  <View style={{ flexDirection: "row", gap: 6, overflow: "hidden" }}>
                    <T mono size={12} color="rgba(255,255,255,0.85)" lines={1} style={{ flexShrink: 1 }}>{r.email_sender ?? `pager:${r.type}`}</T>
                    <T size={12} color={t.text3}>· {formatHM(Date.parse(r.created_at) || 0)}</T>
                  </View>
                </View>
                {selecting ? null : (
                  <View style={s.answer}>
                    <T size={14} weight="600" color={t.white}>Answer</T>
                  </View>
                )}
              </Pressable>
            ))}
            {hiddenWaiting > 0 || (showAllWaiting && waitingCount > WAITING_CAP) ? (
              <Pressable onPress={() => setShowAllWaiting((v) => !v)} hitSlop={4} style={({ pressed }) => [s.more, pressed && { opacity: 0.6 }]}>
                <T size={14} weight="600" color={t.accent}>{hiddenWaiting > 0 ? `${hiddenWaiting} more` : "Show less"}</T>
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
                  <PorterRow key={`p/${e.item.fromMachine}/${e.item.id}`} item={e.item} machineName={nameOf(e.item.fromMachine)} now={now} selected={selecting ? selectedSet.has(entryKey(e)) : undefined} onPress={() => pressRow(entryKey(e), () => openItem(e.item))} onLongPress={() => longPressRow(entryKey(e))} />
                ) : (
                  <PagerRow key={`g/${e.push.id}`} push={e.push} selected={selecting ? selectedSet.has(entryKey(e)) : undefined} onPress={() => pressRow(entryKey(e), () => { setPushes((l) => l.map((x) => (x.id === e.push.id ? { ...x, read: 1 } : x))); nav.navigate("PagerItem", { push: e.push }); })} onLongPress={() => longPressRow(entryKey(e))} />
                )
              )}
            </View>
          </View>
        ))}

        {!waitingCount && !days.length ? <Empty icon="check" title="All clear" hint={machineFilter || agentFilter ? "Nothing from this sender." : "Nothing waiting on you and no messages in the last 7 days."} /> : null}
        {pagerError && showPager ? <T size={11} color={t.faint} style={{ marginHorizontal: 20 }}>pager-api: {pagerError}</T> : null}
      </ScrollView>
      {selecting ? (
        <BottomBar inbox note={progress || undefined}>
          <ButtonPair>
            <View style={[s.barBtn, (busy || !nSel) && s.barBtnOff]} pointerEvents={busy || !nSel ? "none" : "auto"}>
              <BigButton inbox kind="secondary" label="Mark seen" disabled={busy || !nSel} onPress={() => void bulkMarkSeen()} />
            </View>
            <View style={[s.barBtn, (busy || !nSel) && s.barBtnOff]} pointerEvents={busy || !nSel ? "none" : "auto"}>
              <BigButton inbox kind="secondary" label="Dismiss" disabled={busy || !nSel} onPress={startDismiss} />
            </View>
          </ButtonPair>
        </BottomBar>
      ) : null}
      <MenuSheet visible={menu} title="Show" options={menuOptions} onClose={() => setMenu(false)} />
      <ConfirmModal visible={confirm} title="Mark all seen" body={`Mark ${unreadPorter + unreadPager} item(s) as seen?`} confirmLabel="Mark all" onConfirm={markAll} onCancel={() => setConfirm(false)} />
      <ConfirmModal visible={!!bulkConfirm} title={bulkConfirm?.title ?? ""} body={bulkConfirm?.body ?? ""} confirmLabel="Dismiss" danger onConfirm={() => bulkConfirm && void doDismiss(bulkConfirm.plan)} onCancel={() => setBulkConfirm(null)} />
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

function PorterRow({ item, machineName, now, selected, onPress, onLongPress }: { item: InboxItem; machineName: string; now: number; selected?: boolean; onPress: () => void; onLongPress: () => void }) {
  const look = notifyLook(item, now);
  const read = item.read || look === "answered";
  const sp = senderParts(item, machineName);
  const line = look === "answered" ? resolutionText(item, sp.machine) : item.notify.body;
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} style={({ pressed }) => [s.row, pressed && { backgroundColor: t.fill }]}>
      {selected !== undefined ? <SelectCircle on={selected} /> : null}
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

function PagerRow({ push, selected, onPress, onLongPress }: { push: PagerPush; selected?: boolean; onPress: () => void; onLongPress: () => void }) {
  const read = !!push.read;
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} style={({ pressed }) => [s.row, pressed && { backgroundColor: t.fill }]}>
      {selected !== undefined ? <SelectCircle on={selected} /> : null}
      {/* pager-api marks every push urgent, so the category isn't a priority signal. */}
      <KindIcon look="message" dim={read} />
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
  more: { minHeight: 44, marginHorizontal: 12, alignItems: "center", justifyContent: "center" },
  answer: { minHeight: 34, paddingHorizontal: 12, borderRadius: 8, backgroundColor: t.accent, justifyContent: "center" },
  list: { borderTopWidth: 1, borderTopColor: t.divider },
  barBtn: { flex: 1, flexDirection: "row" },
  barBtnOff: { opacity: 0.4 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, height: 68, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: t.divider },
});
