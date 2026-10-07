import { useMemo } from "react";
import { Pressable, SectionList, StyleSheet, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import { usePorter, usePorterState, useTick } from "../../porter/PorterProvider";
import { formatAgo, formatDuration, graveyard, groupedAgents, liveDurations, type AgentNode } from "../../porter/selectors";
import type { Agent } from "../../porter/types";
import type { AgentsStackParamList } from "../../navigation/types";
import { Badge, Btn, Empty, Mono, ScreenHeader, statusColor, ui } from "../../components/ui";
import { colors, spacing } from "../../theme";

type Nav = NativeStackNavigationProp<AgentsStackParamList>;

const STATUS_LABEL: Record<string, string> = { needs_you: "NEEDS YOU", running: "RUNNING", done: "DONE", ended: "ENDED" };

export function AgentRow({ agent, machine, child, now, onPress }: { agent: Agent; machine: string; child?: boolean; now: number; onPress: () => void }) {
  const d = liveDurations(agent, now);
  const color = statusColor(agent.status);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.row, child && s.child, { borderLeftColor: color }, pressed && { opacity: 0.7 }]}>
      <View style={ui.row}>
        <View style={[ui.rowGap, { flex: 1 }]}>
          {agent.special ? <Feather name="star" size={12} color={colors.accent} /> : null}
          <Mono bold lines={1} style={{ flexShrink: 1 }}>
            {child ? "↳ " : ""}
            {agent.title || agent.agent_type || agent.id.slice(0, 8)}
          </Mono>
        </View>
        <Mono size={11} dim>
          {agent.status === "done" ? formatAgo(agent.status_since, now) : formatDuration(d.inStatusMs)}
        </Mono>
      </View>
      <View style={[ui.rowGap, { marginTop: 4 }]}>
        <Badge label={STATUS_LABEL[agent.status] ?? agent.status.toUpperCase()} color={color} filled={agent.status === "needs_you"} />
        {agent.agent_type && child ? <Mono size={10} faint>{agent.agent_type}</Mono> : null}
        {agent.project ? <Mono size={10} faint>{agent.project}</Mono> : null}
        {agent.harness && agent.harness !== "claude" ? <Mono size={10} faint>{agent.harness}</Mono> : null}
      </View>
      {agent.status === "needs_you" && agent.needs?.text ? (
        <Mono size={12} style={{ color: colors.urgent, marginTop: 4 }} lines={2}>
          {agent.needs.kind === "input" ? "input: " : ""}
          {agent.needs.text}
        </Mono>
      ) : agent.summary ? (
        <Mono size={11} dim lines={2} style={{ marginTop: 4 }}>
          {agent.summary}
        </Mono>
      ) : null}
    </Pressable>
  );
}

export default function AgentsScreen() {
  const nav = useNavigation<Nav>();
  const { rt, connection, version } = usePorter();
  const state = usePorterState();
  const now = useTick(1000);

  const names = useMemo(() => {
    const out: Record<string, string> = {};
    for (const p of rt?.node.peers() ?? []) out[p.machine_id] = p.alias;
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rt, version]);

  const groups = useMemo(() => groupedAgents(state, names), [state, names]);
  const dead = useMemo(() => graveyard(state).length, [state]);
  const needsYou = groups.reduce((n, g) => n + g.needsYou, 0);
  const running = groups.reduce((n, g) => n + g.running, 0);

  const sections = groups.map((g) => ({
    key: g.machine.machineId,
    title: g.machine.name || g.machine.machineId.slice(0, 10),
    group: g,
    data: g.nodes,
  }));

  const peers = rt?.node.peers().length ?? 0;

  return (
    <View style={ui.screen}>
      <ScreenHeader
        title="AGENTS"
        status={`${connection.toUpperCase()} · ${needsYou} NEED YOU · ${running} RUNNING`}
        right={dead > 0 ? <Btn small tone="dim" label={`GRAVEYARD ${dead}`} onPress={() => nav.navigate("Graveyard")} /> : undefined}
      />
      {sections.length === 0 ? (
        <Empty
          title={peers === 0 ? "NO MACHINES" : "NO AGENTS YET"}
          hint={peers === 0 ? "Pair a machine in the Machines tab." : "Waiting for porter snapshots from paired machines."}
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(n: AgentNode) => n.agent.id}
          contentContainerStyle={ui.content}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => (
            <View style={[ui.row, { marginTop: spacing.md, marginBottom: spacing.sm }]}>
              <Mono size={11} bold dim style={{ letterSpacing: 2 }}>
                {section.title.toUpperCase()}
              </Mono>
              <Mono size={10} faint>
                {section.group.machine.agentsAt ? `synced ${formatAgo(section.group.machine.agentsAt, now)}` : "no snapshot"}
                {section.group.machine.agentsTruncated ? " · truncated" : ""}
              </Mono>
            </View>
          )}
          renderSectionFooter={({ section }) =>
            section.data.length === 0 ? (
              <Mono size={11} faint style={{ marginBottom: spacing.sm }}>
                no live agents
              </Mono>
            ) : null
          }
          renderItem={({ item, section }) => (
            <View>
              <AgentRow
                agent={item.agent}
                machine={section.key}
                now={now}
                onPress={() => nav.navigate("AgentDetail", { machine: section.key, agent: item.agent.id })}
              />
              {item.children.map((c) => (
                <AgentRow
                  key={c.id}
                  child
                  agent={c}
                  machine={section.key}
                  now={now}
                  onPress={() => nav.navigate("AgentDetail", { machine: section.key, agent: c.id })}
                />
              ))}
            </View>
          )}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  row: {
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
  child: { marginLeft: spacing.xl, backgroundColor: colors.surfaceAlt },
});
