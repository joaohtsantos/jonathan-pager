// Senders (design: AppSenders): everyone who pushed to this phone, per machine,
// with Allow / Muted / Blocked for the machine and for each agent.
import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { usePorter, usePorterState } from "../../porter/PorterProvider";
import { agentKey, machineKey, notifySenderAgent } from "../../porter/store";
import { BackHeader, List, MenuSheet, PageTitle, Screen, SectionHeader, T } from "../../components/ui";
import { t } from "../../theme";

type Pref = "allow" | "mute" | "block";
const LABEL: Record<Pref, string> = { allow: "Allow", mute: "Muted", block: "Blocked" };
const COLOR: Record<Pref, string> = { allow: t.dim, mute: t.needs, block: t.danger };

export default function SendersScreen() {
  const nav = useNavigation();
  const { store, rt } = usePorter();
  const state = usePorterState();
  const [picking, setPicking] = useState<{ key: string; label: string } | null>(null);

  const groups = useMemo(() => {
    const by: Record<string, Set<string>> = {};
    for (const i of state.inbox) {
      (by[i.fromMachine] ??= new Set());
      const a = notifySenderAgent(i);
      if (a) by[i.fromMachine].add(a);
    }
    return Object.entries(by).map(([machine, agents]) => ({ machine, agents: [...agents].sort() }));
  }, [state.inbox]);

  const nameOf = (id: string) => state.machines[id]?.name ?? rt?.node.peer(id)?.alias ?? id.slice(0, 10);
  const prefOf = (key: string): Pref => (state.prefs.blocked[key] ? "block" : state.prefs.muted[key] ? "mute" : "allow");
  const setPref = async (key: string, v: Pref) => {
    await store?.setPref("muted", key, v === "mute");
    await store?.setPref("blocked", key, v === "block");
  };
  const agentLabel = (machine: string, a: string) => (a.includes(":") ? a : `${nameOf(machine)}:${a}`);

  return (
    <Screen>
      <BackHeader label="Inbox" onBack={() => nav.goBack()} />
      <PageTitle title="Senders" sub="Everyone who has pushed to this phone. Tap a state to change it." />
      <ScrollView contentContainerStyle={{ gap: 22, paddingBottom: 20 }}>
        {groups.length === 0 ? <T color={t.faint} style={{ marginHorizontal: 20 }}>No pushes yet.</T> : null}
        {groups.map((g) => {
          const mk = machineKey(g.machine);
          const mp = prefOf(mk);
          return (
            <View key={g.machine}>
              <SectionHeader
                meta="whole machine"
                right={
                  <Pressable onPress={() => setPicking({ key: mk, label: nameOf(g.machine) })} hitSlop={8}>
                    <T size={11} color={mp === "allow" ? t.faint : COLOR[mp]}>{LABEL[mp]} ▾</T>
                  </Pressable>
                }
              >
                <T mono size={14} weight="600">{nameOf(g.machine)}</T>
              </SectionHeader>
              <List>
                {g.agents.map((a) => {
                  const k = agentKey(g.machine, a);
                  const p = prefOf(k);
                  return (
                    <View key={a} style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44, paddingLeft: 18, paddingRight: 10, borderBottomWidth: 1, borderBottomColor: t.hairline }}>
                      <T mono style={{ flex: 1 }} lines={1}>{agentLabel(g.machine, a)}</T>
                      <Pressable onPress={() => setPicking({ key: k, label: agentLabel(g.machine, a) })} style={{ minHeight: 40, paddingHorizontal: 10, justifyContent: "center" }}>
                        <T color={COLOR[p]}>{LABEL[p]} ▾</T>
                      </Pressable>
                    </View>
                  );
                })}
              </List>
            </View>
          );
        })}
        <T size={12} color={t.faint} style={{ marginHorizontal: 20, lineHeight: 17 }}>
          A machine setting covers all its agents. Muted senders still land in the inbox; blocked ones are dropped. Stored on this phone only.
        </T>
      </ScrollView>
      <MenuSheet
        visible={!!picking}
        title={picking?.label ?? ""}
        sub="pushes from this sender"
        onClose={() => setPicking(null)}
        options={(["allow", "mute", "block"] as Pref[]).map((v) => ({
          key: v,
          label: v === "allow" ? "Allow" : v === "mute" ? "Mute" : "Block",
          color: v === "block" ? t.danger : undefined,
          checked: picking ? prefOf(picking.key) === v : false,
          onPress: () => picking && void setPref(picking.key, v),
        }))}
      />
    </Screen>
  );
}
