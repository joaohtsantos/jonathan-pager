// One timeline: porter notifies (comms) + pager-api pushes, with open
// questions and pending pager-api requests pinned on top.
import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import * as Notifications from "expo-notifications";
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { usePorter, usePorterState, useTick } from "../../porter/PorterProvider";
import { filterInbox, formatAgo, splitInbox } from "../../porter/selectors";
import type { InboxItem } from "../../porter/store";
import { fetchPendingRequests, fetchPushes, markAllPushesRead, pagerConfigured, setPushRead, type PagerPush } from "../../lib/pagerApi";
import type { InboxStackParamList } from "../../navigation/types";
import { Badge, Block, Btn, Chip, Empty, Mono, ScreenHeader, ui } from "../../components/ui";
import ConfirmModal from "../../components/ConfirmModal";
import { useToast } from "../../components/Toast";
import { colors, spacing } from "../../theme";

type Nav = NativeStackNavigationProp<InboxStackParamList>;
type Entry = { kind: "porter"; at: number; item: InboxItem } | { kind: "pager"; at: number; push: PagerPush };

const CATEGORY_COLOR: Record<string, string> = { urgent: colors.urgent, alert: colors.alert, info: colors.info };
const PAGER = "__pager__";

export function QuestionCard({ item, machineName }: { item: InboxItem; machineName: string }) {
  const { rt } = usePorter();
  const toast = useToast();
  const now = useTick(1000);
  const n = item.notify;
  const exp = n.expires_at ? Date.parse(n.expires_at) : 0;
  const answer = async (choice: string) => {
    if (!rt) return;
    try {
      await rt.porter.answer(item, choice);
      toast.show(`SENT · ${choice.toUpperCase()}`);
    } catch (e) {
      toast.show(`FAILED · ${e instanceof Error ? e.message : String(e)}`, 3000);
    }
  };
  return (
    <Block accent={colors.urgent}>
      <View style={ui.row}>
        <Badge label={(n.kind ?? "question").toUpperCase()} color={colors.urgent} filled />
        <Mono size={10} faint>
          {exp ? (exp > now ? `expires in ${Math.ceil((exp - now) / 1000)}s` : "expired") : formatAgo(item.receivedAt, now)}
        </Mono>
      </View>
      <Mono bold style={{ marginTop: spacing.sm }} selectable>
        {n.title}
      </Mono>
      {n.body ? (
        <Mono size={12} dim style={{ marginTop: 4 }} selectable>
          {n.body}
        </Mono>
      ) : null}
      {n.trust ? (
        <Mono size={11} dim style={{ marginTop: 4 }}>
          {n.trust.sender} → {n.trust.receiver}
        </Mono>
      ) : null}
      <Mono size={10} faint style={{ marginTop: 4 }}>
        {n.context?.agent || machineName}
        {n.context?.title && !n.context?.agent ? ` · ${n.context.title}` : ""}
        {n.reason ? ` · ${n.reason}` : ""}
      </Mono>
      <View style={[ui.rowGap, { marginTop: spacing.md }]}>
        {item.answer ? (
          <Mono size={11} style={{ color: item.answer.state === "failed" ? colors.urgent : colors.accent }}>
            {item.answer.choice.toUpperCase()} · {item.answer.state.toUpperCase()}
            {item.answer.error ? ` · ${item.answer.error}` : ""}
          </Mono>
        ) : null}
        {(!item.answer || item.answer.state === "failed") &&
          (n.ask ?? []).map((choice) => (
            <Btn key={choice} label={choice.toUpperCase()} tone={/deny/i.test(choice) ? "danger" : "accent"} onPress={() => answer(choice)} disabled={!rt} />
          ))}
      </View>
    </Block>
  );
}

export default function InboxScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<RouteProp<InboxStackParamList, "InboxList">>();
  const { rt, version } = usePorter();
  const state = usePorterState();
  const toast = useToast();
  const now = useTick(30_000);
  const [pushes, setPushes] = useState<PagerPush[]>([]);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [pagerError, setPagerError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [machineFilter, setMachineFilter] = useState<string | undefined>(route.params?.machine);
  const agentFilter = route.params?.agent;
  const [confirm, setConfirm] = useState(false);

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
    }, [loadPager])
  );

  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((n) => {
      const data = n.request.content.data as { porterLocal?: string } | undefined;
      if (!data?.porterLocal) void loadPager();
    });
    const t = setInterval(loadPager, 60_000);
    return () => {
      sub.remove();
      clearInterval(t);
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
  const showPager = !agentFilter && (!machineFilter || machineFilter === PAGER);

  const timeline: Entry[] = useMemo(() => {
    const e: Entry[] = rest.map((item) => ({ kind: "porter" as const, at: item.receivedAt, item }));
    if (showPager) for (const push of pushes) e.push({ kind: "pager", at: Date.parse(push.created_at) || 0, push });
    return e.sort((a, b) => b.at - a.at);
  }, [rest, pushes, showPager]);

  const unreadPorter = state.inbox.filter((i) => !i.read).length;
  const unreadPager = pushes.filter((p) => !p.read).length;
  const openQuestions = splitInbox(state.inbox, now).questions.length;
  const badge = unreadPorter + unreadPager + pendingRequests + openQuestions;

  useEffect(() => {
    nav.getParent()?.setOptions({ tabBarBadge: badge > 0 ? badge : undefined });
  }, [nav, badge]);

  const machinesInInbox = Array.from(new Set(state.inbox.map((i) => i.fromMachine)));

  const onRefresh = async () => {
    setRefreshing(true);
    await loadPager();
    if (rt?.node.configured && !rt.node.isRunning) await rt.node.drain().catch(() => undefined);
    setRefreshing(false);
  };

  const markAll = async () => {
    setConfirm(false);
    await rt?.store.markAllRead();
    if (unreadPager > 0) {
      try {
        await markAllPushesRead();
        setPushes((p) => p.map((x) => ({ ...x, read: 1 })));
      } catch {
        toast.show("PAGER MARK-ALL FAILED");
      }
    }
    toast.show("MARKED ALL READ");
  };

  const togglePagerRead = async (p: PagerPush) => {
    try {
      await setPushRead(p.id, !p.read);
      setPushes((list) => list.map((x) => (x.id === p.id ? { ...x, read: p.read ? 0 : 1 } : x)));
    } catch {
      toast.show("FAILED");
    }
  };

  const header = (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[ui.rowGap, { marginBottom: spacing.md }]}>
        <Chip label="ALL" active={!machineFilter} onPress={() => setMachineFilter(undefined)} />
        {machinesInInbox.map((m) => (
          <Chip key={m} label={nameOf(m).toUpperCase()} active={machineFilter === m} onPress={() => setMachineFilter(m)} />
        ))}
        {pagerConfigured() ? <Chip label="PAGER" active={machineFilter === PAGER} onPress={() => setMachineFilter(PAGER)} /> : null}
        {agentFilter ? <Chip label={`SENDER ${agentFilter.slice(0, 10)} ✕`} active onPress={() => nav.setParams({ agent: undefined })} /> : null}
      </ScrollView>

      {pendingRequests > 0 && showPager ? (
        <Pressable onPress={() => nav.navigate("Requests")}>
          <Block accent={colors.accent}>
            <View style={ui.row}>
              <Mono bold>REQUESTS · {pendingRequests} PENDING</Mono>
              <Mono size={11} style={{ color: colors.accent }}>OPEN →</Mono>
            </View>
            <Mono size={11} faint style={{ marginTop: 4 }}>
              pager-api action cards (approve / reject / done)
            </Mono>
          </Block>
        </Pressable>
      ) : null}

      {questions.map((q) => (
        <Pressable key={`${q.fromMachine}/${q.id}`} onPress={() => nav.navigate("InboxItem", { machine: q.fromMachine, id: q.id })}>
          <QuestionCard item={q} machineName={nameOf(q.fromMachine)} />
        </Pressable>
      ))}
      {pagerError && showPager ? <Mono size={10} faint style={{ marginBottom: spacing.sm }}>pager-api: {pagerError}</Mono> : null}
    </View>
  );

  return (
    <View style={ui.screen}>
      <ScreenHeader
        title="INBOX"
        status={`${openQuestions} OPEN · ${unreadPorter + unreadPager} UNREAD`}
        right={
          <View style={ui.rowGap}>
            {pagerConfigured() ? <Btn small tone="dim" label="PAGER LOG" onPress={() => nav.navigate("PushList")} /> : null}
            {unreadPorter + unreadPager > 0 ? <Btn small label="MARK ALL" onPress={() => setConfirm(true)} /> : null}
          </View>
        }
      />
      <FlatList
        data={timeline}
        keyExtractor={(e) => (e.kind === "porter" ? `p/${e.item.fromMachine}/${e.item.id}` : `g/${e.push.id}`)}
        contentContainerStyle={ui.content}
        ListHeaderComponent={header}
        ListEmptyComponent={questions.length || pendingRequests ? null : <Empty title="NO TRAFFIC" hint="pull down to sync" />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textFaint} colors={[colors.textFaint]} />}
        renderItem={({ item: e }) =>
          e.kind === "porter" ? (
            <Pressable
              onPress={() => nav.navigate("InboxItem", { machine: e.item.fromMachine, id: e.item.id })}
              onLongPress={() => rt?.store.updateInbox(e.item.id, e.item.fromMachine, (i) => ({ ...i, read: !i.read }))}
            >
              <View style={[s.card, { borderLeftColor: e.item.notify.priority === "high" ? colors.urgent : colors.alert }]}>
                <View style={ui.row}>
                  <Mono size={10} faint bold style={{ letterSpacing: 1 }}>
                    {(e.item.notify.context?.agent || nameOf(e.item.fromMachine)).toUpperCase()}
                    {e.item.notify.context?.title && !e.item.notify.context?.agent ? ` · ${e.item.notify.context.title}` : ""}
                  </Mono>
                  <Mono size={10} faint>{formatAgo(e.at, now)}</Mono>
                </View>
                <Mono bold={!e.item.read} dim={e.item.read} lines={1} style={{ marginTop: 4 }}>
                  {e.item.read ? "  " : "> "}
                  {e.item.notify.title}
                </Mono>
                {e.item.notify.body ? <Mono size={12} dim lines={2}>{e.item.notify.body}</Mono> : null}
                {e.item.answer ? <Mono size={10} style={{ color: colors.accent, marginTop: 4 }}>answered {e.item.answer.choice}</Mono> : null}
                {e.item.cancelled ? <Mono size={10} faint style={{ marginTop: 4 }}>resolved: {e.item.cancelled.resolution}</Mono> : null}
              </View>
            </Pressable>
          ) : (
            <Pressable onPress={() => nav.navigate("PushDetail", { id: e.push.id })} onLongPress={() => togglePagerRead(e.push)}>
              <View style={[s.card, { borderLeftColor: CATEGORY_COLOR[e.push.category] ?? colors.info }]}>
                <View style={ui.row}>
                  <Mono size={10} faint bold style={{ letterSpacing: 1 }}>
                    PAGER · {e.push.category.toUpperCase()}
                  </Mono>
                  <Mono size={10} faint>{formatAgo(e.at, now)}</Mono>
                </View>
                <Mono bold={!e.push.read} dim={!!e.push.read} lines={1} style={{ marginTop: 4 }}>
                  {e.push.read ? "  " : "> "}
                  {e.push.title}
                </Mono>
                {e.push.body ? <Mono size={12} dim lines={2}>{e.push.body}</Mono> : null}
                <Mono size={9} faint style={{ marginTop: 4 }}>:: {e.push.source}</Mono>
              </View>
            </Pressable>
          )
        }
      />
      <ConfirmModal
        visible={confirm}
        title="MARK ALL READ"
        body={`Mark ${unreadPorter + unreadPager} item(s) as read?`}
        confirmLabel="MARK ALL"
        onConfirm={markAll}
        onCancel={() => setConfirm(false)}
      />
    </View>
  );
}


const s = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderLeftWidth: 3,
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderTopColor: colors.border,
    borderRightColor: colors.border,
    borderBottomColor: colors.border,
  },
});
