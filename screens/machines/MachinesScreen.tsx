// Machines tab (design: MachinesA): one row per paired machine; "+" pairs a
// new one, the gear opens Settings.
import { Pressable, ScrollView, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import { usePorter, usePorterState, useTick } from "../../porter/PorterProvider";
import { formatHM, livenessText, machineLiveness } from "../../porter/selectors";
import type { MachineState } from "../../porter/store";
import type { MachinesStackParamList } from "../../navigation/types";
import { Chevron, Empty, LargeHeader, OfflineBanner, Screen, T } from "../../components/ui";
import { t } from "../../theme";

/** Paired machines (or the mock ones) with whatever porter state we have. */
export function useMachineList(): MachineState[] {
  const { rt, mock } = usePorter();
  const state = usePorterState();
  if (mock) return Object.values(state.machines);
  return (rt?.node.peers() ?? []).map((p) => state.machines[p.machine_id] ?? { machineId: p.machine_id, name: p.alias, agents: {}, trusts: {} }).map((m) => ({ ...m, name: m.name ?? rt?.node.peer(m.machineId)?.alias }));
}

export function liveAgentCount(m: MachineState) {
  const live = Object.values(m.agents).filter((a) => a.status !== "ended");
  return { live: live.length, running: m.status?.agents_running ?? live.filter((a) => a.status === "running").length };
}

function summary(m: MachineState, online: boolean, seenAt: number): string {
  const st = m.status;
  const c = liveAgentCount(m);
  const parts = [
    online ? `${c.running} agent${c.running === 1 ? "" : "s"} running` : `${c.live} agent${c.live === 1 ? "" : "s"}`,
    st?.battery_pct !== undefined ? `battery ${Math.round(st.battery_pct)}%` : "",
    online && st?.disk_pct !== undefined ? `disk ${Math.round(st.disk_pct)}%` : "",
    online && st?.temp_c !== undefined ? `${Math.round(st.temp_c)}°C` : "",
    !online && seenAt ? `last update ${formatHM(seenAt)}` : "",
  ];
  return parts.filter(Boolean).join(" · ");
}

export default function MachinesScreen() {
  const nav = useNavigation<NativeStackNavigationProp<MachinesStackParamList>>();
  const { presence, bootError, phoneOffline, lastOnlineAt } = usePorter();
  const now = useTick(15_000);
  const machines = useMachineList();

  return (
    <Screen>
      <LargeHeader
        title="Machines"
        right={
          <View style={{ flexDirection: "row" }}>
            <Pressable accessibilityLabel="Add a machine" onPress={() => nav.navigate("Pair")} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
              <Feather name="plus" size={24} color={t.accent} />
            </Pressable>
            <Pressable accessibilityLabel="Settings" onPress={() => nav.navigate("Settings")} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
              <Feather name="settings" size={21} color={t.accent} />
            </Pressable>
          </View>
        }
      />
      <OfflineBanner offline={phoneOffline} since={lastOnlineAt} />
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingBottom: 20 }}>
        {bootError ? <T size={12} color={t.danger} style={{ marginHorizontal: 20, marginBottom: 12 }}>comms failed to start: {bootError}</T> : null}
        {machines.length === 0 ? (
          <Empty icon="server" title="No machines yet" hint="Pair a Mac or the Pi to see its agents and get its pushes." action={{ label: "Add a machine", onPress: () => nav.navigate("Pair") }} />
        ) : (
          <View style={{ borderTopWidth: 1, borderTopColor: t.divider }}>
            {machines.map((m) => {
              const l = machineLiveness(m, presence, now);
              return (
                <Pressable key={m.machineId} onPress={() => nav.navigate("MachineDetail", { machine: m.machineId })} style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 64, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: t.divider }, pressed && { backgroundColor: t.fill }]}>
                  <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                    <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
                      <T mono size={16} weight="600" color={l.online ? t.white : t.text3}>{m.name ?? m.machineId.slice(0, 10)}</T>
                      <T size={12} weight="500" color={t.text3}>{livenessText(l)}</T>
                    </View>
                    <T size={13} color="rgba(255,255,255,0.6)" lines={1}>{summary(m, l.online, l.seenAt)}</T>
                  </View>
                  <Chevron />
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
