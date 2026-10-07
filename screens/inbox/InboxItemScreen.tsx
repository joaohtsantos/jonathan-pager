// One notify with full sender provenance and per-sender mute / block.
import { useEffect } from "react";
import { Linking, ScrollView, View } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { usePorter, usePorterState } from "../../porter/PorterProvider";
import { agentKey, isQuestion, machineKey, notifySenderAgent } from "../../porter/store";
import { formatAgo } from "../../porter/selectors";
import type { InboxStackParamList } from "../../navigation/types";
import { Block, Btn, Empty, KV, Mono, ui } from "../../components/ui";
import { QuestionCard } from "./InboxScreen";
import { navigateTo } from "../../navigationRef";
import { spacing } from "../../theme";

export default function InboxItemScreen() {
  const { params } = useRoute<RouteProp<InboxStackParamList, "InboxItem">>();
  const nav = useNavigation<NativeStackNavigationProp<InboxStackParamList>>();
  const { rt } = usePorter();
  const state = usePorterState();
  const item = state.inbox.find((i) => i.id === params.id && i.fromMachine === params.machine);

  useEffect(() => {
    if (item && !item.read) void rt?.store.updateInbox(item.id, item.fromMachine, (i) => ({ ...i, read: true }));
  }, [item, rt]);

  if (!item) return <Empty title="NOT FOUND" hint="This notification is no longer stored." />;
  const n = item.notify;
  const machine = state.machines[item.fromMachine];
  const machineName = machine?.name ?? rt?.node.peer(item.fromMachine)?.alias ?? item.fromMachine.slice(0, 10);
  const sender = notifySenderAgent(item);
  const mk = machineKey(item.fromMachine);
  const ak = sender ? agentKey(item.fromMachine, sender) : undefined;
  const p = state.prefs;

  const link = n.link;
  const openLink = () => {
    if (!link) return;
    const m = /^agent:([^/]+)\/(.+)$/.exec(link);
    if (m) {
      // link machine is the porter machine name; map to the machine id we know.
      const target = Object.values(state.machines).find((x) => x.name === m[1])?.machineId ?? item.fromMachine;
      navigateTo("Agents", "AgentDetail", { machine: target, agent: m[2] });
    } else if (/^https:\/\//.test(link)) void Linking.openURL(link);
  };

  return (
    <ScrollView style={ui.screen} contentContainerStyle={ui.content}>
      {isQuestion(item) || item.answer || n.ask?.length ? (
        <QuestionCard item={item} machineName={machineName} />
      ) : (
        <Block>
          <Mono size={15} bold selectable>{n.title}</Mono>
          {n.body ? <Mono size={13} dim style={{ marginTop: spacing.sm }} selectable>{n.body}</Mono> : null}
        </Block>
      )}

      <Block title="SENDER">
        <KV label="MACHINE" value={machineName} />
        <KV label="HARNESS" value={n.context?.harness ?? "—"} />
        <KV label="AGENT" value={n.context?.title ?? "—"} />
        <KV label="PROJECT" value={n.context?.project ?? "—"} />
        <KV label="SESSION" value={n.context?.session ?? "—"} />
        <KV label="COMMS FROM" value={item.fromAgent ? `${item.fromMachine}:${item.fromAgent}` : `${item.fromMachine} (push)`} />
        <KV label="REASON" value={n.reason ?? "—"} />
        <KV label="PRIORITY" value={n.priority ?? "normal"} />
        <KV label="KIND" value={n.kind ?? "message"} />
        <KV label="SENT" value={n.sent_at ? formatAgo(n.sent_at) : "—"} />
        <KV label="RECEIVED" value={`${formatAgo(item.receivedAt)} via ${item.via}`} />
        {link ? (
          <View style={{ marginTop: spacing.sm }}>
            <Btn small label="OPEN LINK" onPress={openLink} />
          </View>
        ) : null}
      </Block>

      <Block title="THIS SENDER">
        <View style={ui.rowGap}>
          <Btn small tone="dim" label="SHOW ALL" onPress={() => nav.navigate("InboxList", { machine: item.fromMachine, agent: sender })} />
          {ak ? (
            <>
              <Btn small tone="dim" label={p.muted[ak] ? "UNMUTE AGENT" : "MUTE AGENT"} onPress={() => rt?.store.setPref("muted", ak, !p.muted[ak])} />
              <Btn small tone="danger" label={p.blocked[ak] ? "UNBLOCK AGENT" : "BLOCK AGENT"} onPress={() => rt?.store.setPref("blocked", ak, !p.blocked[ak])} />
            </>
          ) : null}
        </View>
        <View style={[ui.rowGap, { marginTop: spacing.sm }]}>
          <Btn small tone="dim" label={p.muted[mk] ? "UNMUTE MACHINE" : "MUTE MACHINE"} onPress={() => rt?.store.setPref("muted", mk, !p.muted[mk])} />
          <Btn small tone="danger" label={p.blocked[mk] ? "UNBLOCK MACHINE" : "BLOCK MACHINE"} onPress={() => rt?.store.setPref("blocked", mk, !p.blocked[mk])} />
        </View>
        <Mono size={10} faint style={{ marginTop: spacing.sm }}>
          Mute: kept in the inbox, no notification. Block: dropped on arrival. Stored on this phone only.
        </Mono>
      </Block>
    </ScrollView>
  );
}
