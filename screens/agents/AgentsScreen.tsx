// Agents tab (design: AppAgents, mode n4). Flat rows; one collapsible section
// per machine; Edit reorders machines (saved on this phone) and toggles
// floating machines that need you to the top.
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import { usePorter, usePorterState, useTick } from "../../porter/PorterProvider";
import { formatClock, graveyard, groupedAgents, liveDurations, livenessText, machineLiveness, orderGroups, type MachineGroup } from "../../porter/selectors";
import type { MachineState } from "../../porter/store";
import type { Agent } from "../../porter/types";
import type { AgentsStackParamList } from "../../navigation/types";
import { Empty, LargeHeader, Screen, StatusDot, T, TextBtn, Toggle, statusColor } from "../../components/ui";
import { usePersisted } from "../../lib/usePersisted";
import { t } from "../../theme";

type Nav = NativeStackNavigationProp<AgentsStackParamList>;

export function statusLabel(a: Agent): string {
  if (a.status === "needs_you") return a.needs?.kind === "permission" ? "needs approval" : "needs answer";
  return a.status;
}

/** Right-hand clock: time in status while live, total run time once done. */
export function agentClock(a: Agent, now: number): string {
  const d = liveDurations(a, now);
  return formatClock(a.status === "done" ? d.runningMs : d.inStatusMs);
}

export function AgentListRow({ agent, child, offline, now, onPress }: { agent: Agent; child?: boolean; offline?: boolean; now: number; onPress: () => void }) {
  const needs = agent.status === "needs_you";
  const body = needs ? agent.needs?.text : agent.summary;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        s.row,
        child && s.childRow,
        needs && { backgroundColor: "rgba(255,159,10,0.08)" },
        { opacity: (agent.status === "done" ? 0.6 : 1) * (offline ? 0.45 : 1) },
        pressed && { backgroundColor: t.fill },
      ]}
    >
      <StatusDot status={agent.status} style={{ marginTop: 5 }} />
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <T mono size={child ? 13 : 14} color={child ? "rgba(255,255,255,0.75)" : t.text} lines={1} style={{ flexShrink: 1 }}>
            {child ? agent.agent_type || agent.title || agent.id.slice(0, 8) : agent.title || agent.id.slice(0, 8)}
          </T>
          {agent.special && !child ? <Feather name="star" size={11} color={t.accent} /> : null}
        </View>
        <View style={{ flexDirection: "row", gap: 5 }}>
          <T size={11} color={statusColor(agent.status)}>{statusLabel(agent)}</T>
          <T size={11} color="rgba(255,255,255,0.25)">·</T>
          <T size={11} mono color={t.faint}>{child ? "subagent" : agent.harness ?? "agent"}</T>
        </View>
        {body ? (
          needs ? (
            <T size={14} weight="500" style={{ marginTop: 2 }} lines={3}>
              {body}
            </T>
          ) : (
            <T size={12} color={t.dim} lines={1}>
              {body}
            </T>
          )
        ) : null}
      </View>
      <T mono size={12} color={t.dim} style={{ marginTop: 1 }}>
        {agentClock(agent, now)}
      </T>
    </Pressable>
  );
}

function MachineHeader({ g, open, online, liveText, onToggle }: { g: MachineGroup; open: boolean; online: boolean; liveText: string; onToggle: () => void }) {
  const all = g.nodes.flatMap((n) => [n.agent]);
  const done = all.filter((a) => a.status === "done").length;
  const rest = [g.running ? `${g.running} running` : "", done ? `${done} done` : ""].filter(Boolean).join(" · ");
  return (
    <Pressable onPress={onToggle} accessibilityState={{ expanded: open }} style={({ pressed }) => [s.secHead, pressed && { opacity: 0.7 }]}>
      <Feather name="chevron-right" size={13} color="rgba(255,255,255,0.5)" style={{ transform: [{ rotate: open ? "90deg" : "0deg" }] }} />
      <T mono size={14} weight="600" color={online ? t.text : "rgba(255,255,255,0.45)"}>
        {g.machine.name || g.machine.machineId.slice(0, 10)}
      </T>
      <T size={11} color={online ? t.faint : "rgba(255,255,255,0.45)"}>{liveText}</T>
      <View style={{ marginLeft: "auto", flexDirection: "row" }}>
        {g.needsYou ? <T size={11} color={t.needs}>{`${g.needsYou} needs you`}</T> : null}
        <T size={11} color={t.faint}>{(g.needsYou && rest ? " · " : "") + rest}</T>
      </View>
    </Pressable>
  );
}

export default function AgentsScreen() {
  const nav = useNavigation<Nav>();
  const { rt, version, presence, mock } = usePorter();
  const state = usePorterState();
  const now = useTick(1000);
  const [editing, setEditing] = useState(false);
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [order, setOrder] = usePersisted<string[]>("ui.agents.order.v1", []);
  const [float, setFloat] = usePersisted<boolean>("ui.agents.float.v1", true);

  // Paired machines without porter state yet still get a (empty) section.
  const groups = useMemo(() => {
    const names: Record<string, string> = {};
    const snap = { ...state, machines: { ...state.machines } };
    if (!mock) {
      for (const p of rt?.node.peers() ?? []) {
        names[p.machine_id] = p.alias;
        if (!snap.machines[p.machine_id]) snap.machines[p.machine_id] = { machineId: p.machine_id, agents: {}, trusts: {} } as MachineState;
      }
    }
    return groupedAgents(snap, names);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, rt, version, mock]);

  // Saved order + any new machines at the bottom.
  const fullOrder = useMemo(() => [...order.filter((id) => groups.some((g) => g.machine.machineId === id)), ...groups.map((g) => g.machine.machineId).filter((id) => !order.includes(id))], [order, groups]);
  const ordered = orderGroups(groups, fullOrder, float);
  const total = groups.reduce((n, g) => n + g.nodes.reduce((k, x) => k + 1 + x.children.length, 0), 0);
  const dead = graveyard(state).length;

  const move = (i: number, d: number) => {
    const o = [...fullOrder];
    const j = i + d;
    if (j < 0 || j >= o.length) return;
    [o[i], o[j]] = [o[j], o[i]];
    setOrder(o);
  };

  const open = (machine: string, agent: string) => nav.navigate("AgentDetail", { machine, agent });

  return (
    <Screen>
      <LargeHeader title="Agents" count={total} right={groups.length ? <TextBtn label={editing ? "Done" : "Edit"} size={15} onPress={() => setEditing(!editing)} /> : undefined} />
      {editing ? (
        <ScrollView contentContainerStyle={{ paddingTop: 4, paddingHorizontal: 16, paddingBottom: 16, gap: 10 }}>
          <T size={12} weight="600" color="rgba(255,255,255,0.45)" style={{ paddingHorizontal: 4 }}>
            MACHINE ORDER
          </T>
          <View style={s.card}>
            {fullOrder.map((id, i) => {
              const g = groups.find((x) => x.machine.machineId === id)!;
              const count = g.nodes.reduce((k, x) => k + 1 + x.children.length, 0);
              return (
                <View key={id} style={s.editRow}>
                  <Feather name="menu" size={16} color={t.faint} />
                  <T mono size={15} style={{ flex: 1 }}>
                    {g.machine.name || id.slice(0, 10)}
                  </T>
                  <T mono size={12} color={t.faint}>{count}</T>
                  <Pressable accessibilityLabel={`Move ${g.machine.name} up`} onPress={() => move(i, -1)} disabled={i === 0} style={s.arrow}>
                    <Feather name="chevron-up" size={20} color={i > 0 ? t.accent : "rgba(255,255,255,0.2)"} />
                  </Pressable>
                  <Pressable accessibilityLabel={`Move ${g.machine.name} down`} onPress={() => move(i, 1)} disabled={i === fullOrder.length - 1} style={s.arrow}>
                    <Feather name="chevron-down" size={20} color={i < fullOrder.length - 1 ? t.accent : "rgba(255,255,255,0.2)"} />
                  </Pressable>
                </View>
              );
            })}
          </View>
          <Pressable onPress={() => setFloat(!float)} style={[s.card, { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 14 }]}>
            <View style={{ flex: 1, gap: 2 }}>
              <T size={15}>Float machines that need you</T>
              <T size={12} color="rgba(255,255,255,0.45)">A machine with a waiting agent jumps to the top, then drops back.</T>
            </View>
            <Toggle value={float} onChange={setFloat} />
          </Pressable>
          <T size={12} color="rgba(255,255,255,0.4)" style={{ paddingHorizontal: 4 }}>
            The order is saved on this phone. New machines are added at the bottom.
          </T>
        </ScrollView>
      ) : groups.length === 0 ? (
        <Empty title="No machines yet" hint="Pair a machine in the Machines tab to see its agents here." />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 16, gap: 22 }}>
          {ordered.map((g) => {
            const id = g.machine.machineId;
            const live = machineLiveness(g.machine, presence, now);
            const isOpen = !closed[id];
            return (
              <View key={id}>
                <MachineHeader g={g} open={isOpen} online={live.online} liveText={livenessText(live)} onToggle={() => setClosed({ ...closed, [id]: isOpen })} />
                {isOpen ? (
                  <View style={s.box}>
                    {g.nodes.length === 0 ? (
                      <T size={12} color={t.faint} style={{ paddingHorizontal: 18, paddingVertical: 11 }}>
                        {g.machine.agentsAt ? "No live agents" : "Waiting for porter on this machine"}
                      </T>
                    ) : null}
                    {g.nodes.map((n) => (
                      <View key={n.agent.id}>
                        <AgentListRow agent={n.agent} offline={!live.online} now={now} onPress={() => open(id, n.agent.id)} />
                        {n.children.map((c) => (
                          <AgentListRow key={c.id} child agent={c} offline={!live.online} now={now} onPress={() => open(id, c.id)} />
                        ))}
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })}
          <Pressable onPress={() => nav.navigate("Graveyard")} style={({ pressed }) => [s.graveLink, pressed && { backgroundColor: t.fill }]}>
            <Feather name="trash-2" size={16} color={t.dim} />
            <T color={t.dim} style={{ flex: 1 }}>Graveyard</T>
            <T mono size={12} color={t.faint}>{`${dead} ended · 7 days`}</T>
            <Feather name="chevron-right" size={13} color={t.faint} />
          </Pressable>
        </ScrollView>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  secHead: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: 7, paddingLeft: 14, paddingRight: 20, marginBottom: 2 },
  box: { borderTopWidth: 1, borderTopColor: t.hairline },
  row: { flexDirection: "row", gap: 10, alignItems: "flex-start", paddingVertical: 11, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: t.hairline },
  childRow: { paddingVertical: 8, paddingLeft: 38 },
  card: { borderRadius: 12, backgroundColor: t.fill, overflow: "hidden" },
  editRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 2, paddingLeft: 14, paddingRight: 8, borderBottomWidth: 1, borderBottomColor: t.hairline },
  arrow: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  graveLink: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, paddingHorizontal: 18, borderTopWidth: 1, borderBottomWidth: 1, borderColor: t.hairline },
});
