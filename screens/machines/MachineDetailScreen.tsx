import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { usePorter, usePorterState, useTick } from "../../porter/PorterProvider";
import { formatAgo, formatDuration } from "../../porter/selectors";
import type { MachinesStackParamList } from "../../navigation/types";
import { Badge, Block, Btn, Empty, KV, Mono, ui } from "../../components/ui";
import ConfirmModal from "../../components/ConfirmModal";
import { useToast } from "../../components/Toast";
import { useToken } from "../../tokenContext";
import { colors, spacing } from "../../theme";

export default function MachineDetailScreen() {
  const { params } = useRoute<RouteProp<MachinesStackParamList, "MachineDetail">>();
  const nav = useNavigation<NativeStackNavigationProp<MachinesStackParamList>>();
  const { rt, refreshNode } = usePorter();
  const { token } = useToken();
  const state = usePorterState();
  const toast = useToast();
  const now = useTick(15_000);
  const [confirmUnpair, setConfirmUnpair] = useState(false);
  const [error, setError] = useState("");

  const peer = rt?.node.peer(params.machine);
  const m = state.machines[params.machine];
  if (!peer) return <Empty title="NOT PAIRED" />;
  const sub = m?.subscribed;
  const st = m?.status;
  const grant = rt?.node.grant(params.machine);
  const trusts = Object.values(m?.trusts ?? {});

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setError("");
    try {
      await fn();
      toast.show(label);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const unpair = async () => {
    setConfirmUnpair(false);
    await run("UNPAIRED", async () => {
      await rt?.porter.unsubscribe(params.machine).catch(() => undefined);
      await rt?.node.unpair(params.machine);
      await rt?.store.forgetMachine(params.machine);
      refreshNode();
      nav.goBack();
    });
  };

  return (
    <ScrollView style={ui.screen} contentContainerStyle={ui.content}>
      <Block title={(m?.name ?? peer.alias).toUpperCase()}>
        <KV label="ALIAS" value={peer.alias} />
        <KV label="MACHINE ID" value={peer.machine_id} />
        <KV label="PUBLIC KEY" value={peer.public_key} />
        <KV label="PAIRED" value={formatAgo(peer.paired_at, now)} />
        <KV label="GRANT" value={grant?.allow_messages ? "may message this phone" : "blocked"} />
        <KV label="LAST HEARD" value={m?.lastMessageAt ? formatAgo(m.lastMessageAt, now) : "never"} />
      </Block>

      <Block title="PORTER">
        <View style={ui.rowGap}>
          {sub?.approver ? <Badge label="APPROVER" color={colors.accent} /> : <Badge label="NOT APPROVER" />}
          {sub?.push ? <Badge label="PUSH ON" color={colors.accent} /> : <Badge label="PUSH OFF" />}
          {sub?.porter_version ? <Mono size={10} faint>porter {sub.porter_version}</Mono> : null}
        </View>
        <KV label="TOPICS" value={sub?.topics?.join(", ") || "—"} />
        <KV label="REFUSED" value={sub?.refused?.join(", ") || "—"} />
        <KV label="SUBSCRIBED" value={sub ? formatAgo(sub.at, now) : m?.subscribeSentAt ? `sent ${formatAgo(m.subscribeSentAt, now)}, no reply` : "never"} />
        {m?.subscribeError ? <Mono size={10} style={{ color: colors.urgent }}>{m.subscribeError}</Mono> : null}
        <View style={[ui.rowGap, { marginTop: spacing.sm }]}>
          <Btn small label="RESUBSCRIBE" onPress={() => run("SUBSCRIBE SENT", () => rt!.porter.subscribe(params.machine, token))} />
          <Btn small tone="dim" label="UNSUBSCRIBE" onPress={() => run("UNSUBSCRIBE SENT", () => rt!.porter.unsubscribe(params.machine))} />
          <Btn
            small
            tone="dim"
            label={grant?.allow_messages ? "BLOCK MESSAGES" : "ALLOW MESSAGES"}
            onPress={() => run("GRANT UPDATED", async () => {
              await rt!.node.setGrant(params.machine, !grant?.allow_messages);
              refreshNode();
            })}
          />
        </View>
      </Block>

      <Block title="STATUS">
        {st ? (
          <>
            <KV label="HOST" value={`${st.host ?? "?"} (${st.os ?? "?"})`} />
            {st.uptime_s !== undefined ? <KV label="UPTIME" value={formatDuration(st.uptime_s * 1000)} /> : null}
            {st.load !== undefined ? <KV label="LOAD" value={st.load.toFixed(2)} /> : null}
            {st.mem_pct !== undefined ? <KV label="MEMORY" value={`${Math.round(st.mem_pct)}%`} /> : null}
            {st.disk_pct !== undefined ? <KV label="DISK" value={`${Math.round(st.disk_pct)}%`} /> : null}
            {st.temp_c !== undefined ? <KV label="TEMP" value={`${st.temp_c.toFixed(1)}°C`} /> : null}
            {st.battery_pct !== undefined ? <KV label="BATTERY" value={`${Math.round(st.battery_pct)}%`} /> : null}
            <KV label="AGENTS" value={String(st.agents_running ?? "—")} />
            <KV label="COMMS" value={st.comms_version ?? "—"} />
            <KV label="AT" value={st.at ? formatAgo(st.at, now) : "—"} />
          </>
        ) : (
          <Mono size={11} faint>No status received.</Mono>
        )}
      </Block>

      <Block title={`TRUSTS · ${trusts.length}`}>
        {!sub?.approver ? <Mono size={11} faint>Trusts are shared with approvers only.</Mono> : null}
        {trusts.map((t) => (
          <View key={t.id} style={{ paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider }}>
            <View style={ui.row}>
              <Mono size={12} bold style={{ flex: 1 }}>
                {t.sender} → {t.receiver}
              </Mono>
              <Badge label={t.scope.toUpperCase()} color={t.scope === "always" ? colors.accent : colors.borderBright} />
            </View>
            <View style={[ui.row, { marginTop: 4 }]}>
              <Mono size={10} faint>{t.approved_at ? `approved ${formatAgo(t.approved_at, now)}` : t.id}</Mono>
              {sub?.approver ? <Btn small tone="danger" label="REVOKE" onPress={() => run("REVOKE SENT", () => rt!.porter.revokeTrust(params.machine, t.id))} /> : null}
            </View>
          </View>
        ))}
      </Block>

      {error ? <Mono size={11} style={{ color: colors.urgent, marginBottom: spacing.md }} selectable>{error}</Mono> : null}
      <Btn tone="danger" label="UNPAIR" onPress={() => setConfirmUnpair(true)} />
      <ConfirmModal
        visible={confirmUnpair}
        danger
        title="UNPAIR"
        body={`Forget ${peer.alias}'s key, revoke its grant and drop its cached state?`}
        confirmLabel="UNPAIR"
        onConfirm={unpair}
        onCancel={() => setConfirmUnpair(false)}
      />
    </ScrollView>
  );
}
