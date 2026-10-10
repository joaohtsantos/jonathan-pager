// One machine (design: MachineDetail): health from the latest STATUS (kept
// while offline), approver / push switches, that machine's trusts, versions,
// unpair. "You approve here" can be turned OFF from the phone, never ON.
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { usePorter, usePorterState, useTick } from "../../porter/PorterProvider";
import { dayLabel, formatAgo, formatHM, livenessText, machineLiveness } from "../../porter/selectors";
import type { MachinesStackParamList } from "../../navigation/types";
import { BackHeader, Chevron, Empty, KVRow, List, Screen, SectionHeader, T, TextBtn, Toggle } from "../../components/ui";
import ConfirmModal from "../../components/ConfirmModal";
import { useToast } from "../../components/Toast";
import { useToken } from "../../tokenContext";
import { navigateTo } from "../../navigationRef";
import { liveAgentCount } from "./MachinesScreen";
import { t } from "../../theme";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function uptime(s: number) {
  const d = Math.floor(s / 86400);
  if (d >= 1) return `up ${d} day${d === 1 ? "" : "s"}`;
  const h = Math.floor(s / 3600);
  return h >= 1 ? `up ${h}h` : `up ${Math.floor(s / 60)}m`;
}

export default function MachineDetailScreen() {
  const { params } = useRoute<RouteProp<MachinesStackParamList, "MachineDetail">>();
  const nav = useNavigation<NativeStackNavigationProp<MachinesStackParamList>>();
  const { rt, refreshNode, actions, presence, mock, store } = usePorter();
  const { token } = useToken();
  const state = usePorterState();
  const toast = useToast();
  const now = useTick(15_000);
  const [confirmUnpair, setConfirmUnpair] = useState(false);
  const [confirmResign, setConfirmResign] = useState(false);
  const [error, setError] = useState("");

  const peer = rt?.node.peer(params.machine);
  const m = state.machines[params.machine];
  const back = () => nav.goBack();
  if (!m && !peer) {
    return (
      <Screen>
        <BackHeader label="Machines" onBack={back} />
        <Empty title="Not paired" />
      </Screen>
    );
  }
  const name = m?.name ?? peer?.alias ?? params.machine.slice(0, 10);
  const st = m?.status;
  const live = machineLiveness(m, presence, now);
  const sub = m?.subscribed;
  const approver = sub?.approver === true;
  const pushOn = !m?.pushOff;
  const trusts = Object.values(m?.trusts ?? {});
  const grant = rt?.node.grant(params.machine);
  const counts = m ? liveAgentCount(m) : { live: 0, running: 0 };

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setError("");
    try {
      await fn();
      toast.show(label);
    } catch (e) {
      setError(errText(e));
    }
  };

  const unpair = async () => {
    setConfirmUnpair(false);
    await run(`Unpaired ${name}`, async () => {
      if (!mock) {
        await rt?.porter.unsubscribe(params.machine).catch(() => undefined);
        await rt?.node.unpair(params.machine);
      }
      await store?.forgetMachine(params.machine);
      refreshNode();
      nav.goBack();
    });
  };

  const subLine = [livenessText(live), st?.os, st?.uptime_s !== undefined && live.online ? uptime(st.uptime_s) : ""].filter(Boolean).join(" · ");
  const health: [string, string][] = [];
  if (st?.disk_pct !== undefined) health.push(["Disk", `${Math.round(st.disk_pct)}%`]);
  if (st?.mem_pct !== undefined) health.push(["Memory", `${Math.round(st.mem_pct)}%`]);
  if (st?.load !== undefined) health.push(["Load", st.load.toFixed(2)]);
  if (st?.temp_c !== undefined) health.push(["Temperature", `${Math.round(st.temp_c)}°C`]);
  if (st?.battery_pct !== undefined) health.push(["Battery", `${Math.round(st.battery_pct)}%`]);

  return (
    <Screen>
      <BackHeader label="Machines" onBack={back} />
      <ScrollView contentContainerStyle={{ gap: 26, paddingTop: 4, paddingBottom: 20 }}>
        <View style={{ paddingHorizontal: 20, gap: 4 }}>
          <T mono size={26} weight="600">{name}</T>
          <T color="rgba(255,255,255,0.65)">{subLine}</T>
        </View>

        <View>
          <SectionHeader size={15} meta={st?.at && !live.online ? `as of ${dayLabel(st.at, now).toLowerCase()} ${formatHM(st.at)}` : undefined}>Health</SectionHeader>
          <List>
            {health.length ? health.map(([k, v]) => <KVRow key={k} label={k} value={v} mono />) : <KVRow label="No status received yet" />}
          </List>
        </View>

        <View>
          <SectionHeader size={15}>On this machine</SectionHeader>
          <List>
            <KVRow label="Agents" value={live.online ? `${counts.running} running` : `${counts.live} live`} right={<Chevron />} onPress={() => navigateTo("Agents", "AgentsList")} />
            <KVRow
              label="You approve here"
              sub={approver ? undefined : "set on the machine: comms porter setup --approver phone"}
              right={<Toggle value={approver} disabled={!approver} onChange={(v) => !v && setConfirmResign(true)} />}
            />
            <KVRow
              label="Push notifications"
              sub={pushOn && sub && sub.push === false ? "no push token on this phone yet" : undefined}
              right={<Toggle value={pushOn} onChange={(v) => run(v ? "Push on" : "Push off", () => actions.setPush(params.machine, v))} />}
            />
          </List>
        </View>

        <View>
          <SectionHeader size={15} meta="who may give orders to agents here">Trusts</SectionHeader>
          <List>
            {!approver && sub?.refused?.includes("trusts") ? <KVRow label="Shared with approvers only" /> : null}
            {approver && trusts.length === 0 ? <KVRow label="None" /> : null}
            {trusts.map((tr) => (
              <View key={tr.id} style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: t.hairline }}>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <T mono lines={1}>{`${tr.sender} → ${tr.receiver.split(":").pop()}`}</T>
                  <T size={12} color={t.text3}>
                    {tr.scope === "always" ? "always" : "this session"}
                    {tr.approved_at ? (tr.scope === "always" ? ` · since ${dayLabel(tr.approved_at, now)}` : ` · ${formatHM(tr.approved_at)}`) : ""}
                  </T>
                </View>
                {approver ? <TextBtn label="Revoke" tone="danger" size={15} onPress={() => run("Revoke sent", () => actions.revokeTrust(params.machine, tr.id))} /> : null}
              </View>
            ))}
          </List>
        </View>

        <View>
          <SectionHeader size={15}>Versions</SectionHeader>
          <List>
            <KVRow label="comms · porter" value={`${st?.comms_version ?? "—"} · ${sub?.porter_version ?? "—"}`} mono />
          </List>
        </View>

        {!mock ? (
          <View>
            <SectionHeader size={15}>Connection</SectionHeader>
            <List>
              <KVRow label="Machine ID" value={params.machine} mono />
              {peer ? <KVRow label="Paired" value={formatAgo(peer.paired_at, now)} /> : null}
              <KVRow label="Subscribed" value={sub ? formatAgo(sub.at, now) : m?.subscribeSentAt ? "sent, no reply" : "never"} right={<TextBtn label="Resubscribe" onPress={() => run("Subscribe sent", () => rt!.porter.subscribe(params.machine, token))} />} />
              <KVRow
                label="May message this phone"
                right={<Toggle value={!!grant?.allow_messages} onChange={(v) => run("Grant updated", async () => { await rt!.node.setGrant(params.machine, v); refreshNode(); })} />}
              />
            </List>
            {m?.subscribeError ? <T size={12} color={t.danger} style={{ marginHorizontal: 20, marginTop: 6 }}>{m.subscribeError}</T> : null}
          </View>
        ) : null}

        {error ? <T size={12} color={t.danger} style={{ marginHorizontal: 20 }} selectable>{error}</T> : null}

        <View style={{ paddingHorizontal: 18 }}>
          <Pressable onPress={() => setConfirmUnpair(true)} style={({ pressed }) => [{ minHeight: 48, borderRadius: 10, backgroundColor: "rgba(255,69,58,0.12)", alignItems: "center", justifyContent: "center" }, pressed && { opacity: 0.7 }]}>
            <T size={16} weight="600" color={t.danger}>Unpair {name}</T>
          </Pressable>
        </View>
      </ScrollView>
      <ConfirmModal visible={confirmUnpair} danger title={`Unpair ${name}`} body={`Forget ${name}'s key, revoke its grant and drop its cached state?`} confirmLabel="Unpair" onConfirm={unpair} onCancel={() => setConfirmUnpair(false)} />
      <ConfirmModal
        visible={confirmResign}
        danger
        title="Stop approving"
        body={`Stop approving on ${name}? Turning it back on must be done on that machine.`}
        confirmLabel="Stop approving"
        onConfirm={() => {
          setConfirmResign(false);
          void run("Sent — waiting for the machine", () => actions.resign(params.machine));
        }}
        onCancel={() => setConfirmResign(false)}
      />
    </Screen>
  );
}
