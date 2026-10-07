import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { usePorter, usePorterState, useTick } from "../../porter/PorterProvider";
import { formatAgo, formatDuration, lifetimeMs, liveDurations } from "../../porter/selectors";
import type { AgentsStackParamList } from "../../navigation/types";
import { Badge, Block, Btn, Empty, KV, Mono, statusColor, ui } from "../../components/ui";
import { AgentRow } from "./AgentsScreen";
import { colors, spacing } from "../../theme";
import { useToast } from "../../components/Toast";

export default function AgentDetailScreen() {
  const { params } = useRoute<RouteProp<AgentsStackParamList, "AgentDetail">>();
  const nav = useNavigation<NativeStackNavigationProp<AgentsStackParamList>>();
  const { rt } = usePorter();
  const state = usePorterState();
  const now = useTick(1000);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const machine = state.machines[params.machine];
  const agent = machine?.agents[params.agent];
  if (!machine || !agent) return <Empty title="AGENT GONE" hint="It is no longer reported by its machine." />;

  const d = liveDurations(agent, now);
  const approver = machine.subscribed?.approver === true;
  const parent = agent.parent ? machine.agents[agent.parent] : undefined;
  const children = Object.values(machine.agents).filter((a) => a.parent === agent.id);

  const toggleSpecial = async () => {
    if (!rt) return;
    setBusy(true);
    setError("");
    try {
      await rt.porter.setSpecial(machine.machineId, agent.id, !agent.special);
      toast.show(agent.special ? "UNSTAR SENT" : "STAR SENT");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={ui.screen} contentContainerStyle={ui.content}>
      <Block accent={statusColor(agent.status)}>
        <Mono size={16} bold>
          {agent.special ? "★ " : ""}
          {agent.title || agent.id}
        </Mono>
        <View style={[ui.rowGap, { marginTop: spacing.sm }]}>
          <Badge label={agent.status.toUpperCase().replace("_", " ")} color={statusColor(agent.status)} filled={agent.status === "needs_you"} />
          <Mono size={11} dim>
            {machine.name ?? machine.machineId.slice(0, 10)}
          </Mono>
          {agent.harness ? <Mono size={11} faint>{agent.harness}</Mono> : null}
        </View>
        {agent.needs ? (
          <View style={{ marginTop: spacing.md }}>
            <Mono size={10} faint bold>
              {agent.needs.kind === "input" ? "WAITING FOR INPUT" : "PERMISSION"}
            </Mono>
            <Mono size={13} style={{ color: colors.urgent, marginTop: 4 }} selectable>
              {agent.needs.text || "—"}
            </Mono>
          </View>
        ) : null}
        {agent.summary ? (
          <Mono size={12} dim style={{ marginTop: spacing.md }} selectable>
            {agent.summary}
          </Mono>
        ) : null}
      </Block>

      <Block title="TIME">
        <KV label="IN STATUS" value={formatDuration(d.inStatusMs)} />
        <KV label="RUNNING" value={formatDuration(d.runningMs)} />
        <KV label="WAITING" value={formatDuration(d.waitingMs)} />
        <KV label="STARTED" value={agent.started_at ? formatAgo(agent.started_at, now) : "—"} />
        <KV label="LAST ACTIVE" value={formatAgo(agent.last_active_at, now)} />
        {agent.status === "ended" ? <KV label="LIFETIME" value={formatDuration(lifetimeMs(agent))} /> : null}
        {agent.status === "ended" ? <KV label="ENDED" value={`${formatAgo(agent.ended_at, now)} · ${agent.end_reason ?? "?"}`} /> : null}
      </Block>

      <Block title="IDENTITY">
        <KV label="PROJECT" value={agent.project ?? "—"} />
        <KV label="ADDRESS" value={agent.identity?.address ?? "—"} />
        <KV label="PERSISTENT" value={agent.identity?.persistent ? "yes" : "no"} />
        {agent.agent_type ? <KV label="TYPE" value={agent.agent_type} /> : null}
        <KV label="SESSION" value={agent.id} />
      </Block>

      <Block
        title="SPECIAL"
        right={approver ? <Btn small label={agent.special ? "UNSTAR" : "STAR"} onPress={toggleSpecial} disabled={busy || !rt} /> : <Badge label="NOT APPROVER" />}
      >
        <Mono size={11} faint>
          Special agents push on every stop, not only when they need you.
          {approver ? "" : " Only approvers of this machine can change it."}
        </Mono>
        {error ? <Mono style={{ color: colors.urgent, marginTop: spacing.sm }} size={11}>{error}</Mono> : null}
      </Block>

      {parent ? (
        <>
          <Mono size={10} faint bold style={{ letterSpacing: 2, marginVertical: spacing.sm }}>PARENT</Mono>
          <AgentRow agent={parent} machine={machine.machineId} now={now} onPress={() => nav.push("AgentDetail", { machine: machine.machineId, agent: parent.id })} />
        </>
      ) : null}
      {children.length ? (
        <>
          <Mono size={10} faint bold style={{ letterSpacing: 2, marginVertical: spacing.sm }}>SUBAGENTS</Mono>
          {children.map((c) => (
            <AgentRow key={c.id} child agent={c} machine={machine.machineId} now={now} onPress={() => nav.push("AgentDetail", { machine: machine.machineId, agent: c.id })} />
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}
