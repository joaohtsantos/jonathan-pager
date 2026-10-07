import { FlatList, Pressable, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { usePorterState } from "../../porter/PorterProvider";
import { formatAgo, formatDuration, graveyard, lifetimeMs } from "../../porter/selectors";
import type { AgentsStackParamList } from "../../navigation/types";
import { Block, Empty, Mono, ui } from "../../components/ui";
import { spacing } from "../../theme";

export default function GraveyardScreen() {
  const nav = useNavigation<NativeStackNavigationProp<AgentsStackParamList>>();
  const items = graveyard(usePorterState());
  if (!items.length) return <Empty title="GRAVEYARD EMPTY" hint="Ended sessions stay here for 7 days." />;
  return (
    <FlatList
      style={ui.screen}
      contentContainerStyle={ui.content}
      data={items}
      keyExtractor={(x) => `${x.machine.machineId}/${x.agent.id}`}
      renderItem={({ item: { machine, agent } }) => (
        <Pressable onPress={() => nav.navigate("AgentDetail", { machine: machine.machineId, agent: agent.id })}>
          <Block>
            <View style={ui.row}>
              <Mono bold lines={1} style={{ flex: 1 }}>
                {agent.title || agent.id.slice(0, 8)}
              </Mono>
              <Mono size={10} faint>
                {formatAgo(agent.ended_at)}
              </Mono>
            </View>
            <Mono size={11} dim style={{ marginTop: spacing.xs }}>
              {(machine.name ?? machine.machineId.slice(0, 10)) + (agent.project ? ` · ${agent.project}` : "")} · {agent.end_reason ?? "ended"}
            </Mono>
            <Mono size={11} faint style={{ marginTop: spacing.xs }}>
              lived {formatDuration(lifetimeMs(agent))} · ran {formatDuration(agent.running_ms ?? 0)} · waited {formatDuration(agent.waiting_ms ?? 0)}
            </Mono>
          </Block>
        </Pressable>
      )}
    />
  );
}
