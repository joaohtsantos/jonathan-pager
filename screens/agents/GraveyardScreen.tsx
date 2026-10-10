// Graveyard (design: AppGraveyard): ended sessions grouped by day, machine
// prominent per row, stale shown in gray like everything else here.
import { ScrollView, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { usePorterState } from "../../porter/PorterProvider";
import { formatClock, formatShort, graveyard, groupByDay, lifetimeMs } from "../../porter/selectors";
import type { AgentsStackParamList } from "../../navigation/types";
import { BackHeader, Empty, List, PageTitle, Row, Screen, SectionHeader, StatusDot, T } from "../../components/ui";
import { t } from "../../theme";

export default function GraveyardScreen() {
  const nav = useNavigation<NativeStackNavigationProp<AgentsStackParamList>>();
  const items = graveyard(usePorterState());
  const now = Date.now();
  const days = groupByDay(items, (x) => Date.parse(x.agent.ended_at ?? "") || 0, now);

  return (
    <Screen>
      <BackHeader label="Agents" onBack={() => nav.goBack()} />
      <PageTitle row title="Graveyard" sub="ended sessions, kept 7 days" />
      {items.length === 0 ? (
        <Empty title="Nothing here" hint="Ended sessions stay here for 7 days." />
      ) : (
        <ScrollView contentContainerStyle={{ gap: 22, paddingBottom: 20 }}>
          {days.map((d, di) => (
            <View key={d.day}>
              <SectionHeader meta={<T size={11} mono color={t.faint}>{d.items.length}</T>}>{d.day}</SectionHeader>
              <List>
                {d.items.map(({ machine, agent }) => (
                  <Row key={`${machine.machineId}/${agent.id}`} onPress={() => nav.navigate("AgentDetail", { machine: machine.machineId, agent: agent.id, from: "Graveyard" })}>
                    <StatusDot status="ended" style={{ marginTop: 5 }} />
                    <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                      <T mono lines={1}>{agent.title || agent.agent_type || agent.id.slice(0, 8)}</T>
                      <View style={{ flexDirection: "row", gap: 5 }}>
                        <T mono size={12} color="rgba(255,255,255,0.85)">{machine.name ?? machine.machineId.slice(0, 10)}</T>
                        <T size={12} color={t.faint} lines={1} style={{ flexShrink: 1 }}>
                          · {agent.end_reason === "stale" ? "stale · silent 24h" : agent.end_reason ?? "ended"}
                          {agent.harness ? ` · ${agent.harness}` : ""}
                        </T>
                      </View>
                      <T size={12} color={t.dim}>
                        ran <T size={12} mono color={t.dim}>{formatClock(agent.running_ms ?? 0)}</T> · waited <T size={12} mono color={t.dim}>{formatClock(agent.waiting_ms ?? 0)}</T>
                      </T>
                    </View>
                    <T mono size={12} color={t.dim}>{formatShort(lifetimeMs(agent))}</T>
                  </Row>
                ))}
              </List>
              {di === days.length - 1 ? <T size={12} color={t.faint} style={{ marginTop: 12, marginHorizontal: 20 }}>Older sessions are removed after 7 days.</T> : null}
            </View>
          ))}
        </ScrollView>
      )}
    </Screen>
  );
}
