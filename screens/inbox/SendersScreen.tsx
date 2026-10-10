// Senders (design: SendersFinal): everyone who pushed to this phone, grouped by
// machine; fixed 56px rows with "last push"; Allowed / Muted / Blocked per
// agent and per whole machine. The agent's own setting wins over its machine's.
import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { usePorter, usePorterState } from "../../porter/PorterProvider";
import { agentKey, effectivePref, machineKey, notifySenderAgent, ownPref, type SenderPref } from "../../porter/store";
import { dayLabel, formatHM } from "../../porter/selectors";
import { BackHeader, MenuSheet, PageTitle, Screen, T } from "../../components/ui";
import { t } from "../../theme";

const LABEL: Record<SenderPref, string> = { allow: "Allowed", mute: "Muted", block: "Blocked" };

function PrefLabel({ pref, size = 14 }: { pref: SenderPref; size?: number }) {
  if (pref === "allow") return <T size={size} color={t.text3}>Allowed</T>;
  const color = pref === "mute" ? t.white : t.danger;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
      <Feather name={pref === "mute" ? "bell-off" : "slash"} size={14} color={color} />
      <T size={size} color={color}>{LABEL[pref]}</T>
    </View>
  );
}

function lastPush(ms: number, now: number) {
  const d = dayLabel(ms, now);
  return d === "Today" ? formatHM(ms) : d === "Yesterday" ? "yesterday" : d.replace(/^\w+ /, "");
}

export default function SendersScreen() {
  const nav = useNavigation();
  const { store, rt } = usePorter();
  const state = usePorterState();
  const [picking, setPicking] = useState<{ key: string; label: string; agent: boolean } | null>(null);
  const now = Date.now();

  const groups = useMemo(() => {
    const by: Record<string, Map<string, number>> = {};
    for (const i of state.inbox) {
      const m = (by[i.fromMachine] ??= new Map());
      const a = notifySenderAgent(i);
      if (a) m.set(a, Math.max(m.get(a) ?? 0, i.receivedAt));
    }
    return Object.entries(by).map(([machine, agents]) => ({ machine, agents: [...agents.entries()].sort((x, y) => y[1] - x[1]) }));
  }, [state.inbox]);

  const nameOf = (id: string) => state.machines[id]?.name ?? rt?.node.peer(id)?.alias ?? id.slice(0, 10);
  const short = (a: string) => a.split(":").pop() ?? a;

  return (
    <Screen>
      <BackHeader label="Inbox" onBack={() => nav.goBack()} />
      <PageTitle title="Senders" />
      <T size={13} color="rgba(255,255,255,0.6)" style={{ marginHorizontal: 20, marginBottom: 18, lineHeight: 19 }}>
        Muted: kept in the Inbox, no notification. Blocked: dropped. Questions always notify unless blocked.
      </T>
      <ScrollView contentContainerStyle={{ gap: 24, paddingBottom: 20 }}>
        {groups.length === 0 ? <T color={t.faint} style={{ marginHorizontal: 20 }}>No pushes yet.</T> : null}
        {groups.map((g) => {
          const mk = machineKey(g.machine);
          const mp = ownPref(state.prefs, mk) ?? "allow";
          return (
            <View key={g.machine}>
              <View style={{ flexDirection: "row", alignItems: "baseline", paddingHorizontal: 20, marginBottom: 8 }}>
                <T mono size={15} weight="700" color={t.white}>{nameOf(g.machine)}</T>
                <Pressable onPress={() => setPicking({ key: mk, label: `${nameOf(g.machine)} · whole machine`, agent: false })} hitSlop={8} style={{ marginLeft: "auto" }}>
                  <T size={13} weight="500" color="rgba(255,255,255,0.6)">whole machine: {LABEL[mp]} ⌄</T>
                </Pressable>
              </View>
              <View style={{ borderTopWidth: 1, borderTopColor: t.divider }}>
                {g.agents.map(([a, at]) => {
                  const k = agentKey(g.machine, a);
                  const p = ownPref(state.prefs, k) ?? effectivePref(state.prefs, g.machine, a);
                  return (
                    <Pressable key={a} onPress={() => setPicking({ key: k, label: `${nameOf(g.machine)}:${short(a)}`, agent: true })} style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: 10, height: 56, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: t.divider }, pressed && { backgroundColor: t.fill }]}>
                      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                        <T mono size={15} lines={1}>{short(a)}</T>
                        <T size={12} color={t.text3}>last push {lastPush(at, now)}</T>
                      </View>
                      <PrefLabel pref={p} />
                      <Feather name="chevron-down" size={14} color={t.text3} />
                    </Pressable>
                  );
                })}
              </View>
            </View>
          );
        })}
      </ScrollView>
      <MenuSheet
        visible={!!picking}
        title={picking?.label ?? ""}
        onClose={() => setPicking(null)}
        options={[
          ...(picking?.agent ? [{ key: "inherit", label: "Same as machine", color: t.dim, checked: !ownPref(state.prefs, picking.key), onPress: () => void store?.setSenderPref(picking.key, undefined) }] : []),
          ...(["allow", "mute", "block"] as SenderPref[]).map((v) => ({
            key: v,
            label: LABEL[v],
            color: v === "block" ? t.danger : undefined,
            checked: picking ? (ownPref(state.prefs, picking.key) ?? (picking.agent ? undefined : "allow")) === v : false,
            onPress: () => picking && void store?.setSenderPref(picking.key, v === "allow" && !picking.agent ? undefined : v),
          })),
        ]}
      />
    </Screen>
  );
}
