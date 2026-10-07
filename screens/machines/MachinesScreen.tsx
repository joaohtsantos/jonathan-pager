// Paired machines + comms setup (identity, broker, pairing), then the old
// Settings content.
import { useState } from "react";
import { Platform, Pressable, ScrollView, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { usePorter, usePorterState, useTick } from "../../porter/PorterProvider";
import { formatAgo, formatDuration } from "../../porter/selectors";
import type { MachineState } from "../../porter/store";
import type { MachinesStackParamList } from "../../navigation/types";
import { Badge, Block, Btn, Field, KV, Mono, ScreenHeader, ui } from "../../components/ui";
import { SettingsSections } from "../SettingsScreen";
import { useToast } from "../../components/Toast";
import { useToken } from "../../tokenContext";
import { colors, spacing } from "../../theme";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function statusLine(m?: MachineState): string {
  const st = m?.status;
  if (!st) return "no status yet";
  const parts = [
    st.load !== undefined ? `load ${st.load.toFixed(2)}` : "",
    st.mem_pct !== undefined ? `mem ${Math.round(st.mem_pct)}%` : "",
    st.disk_pct !== undefined ? `disk ${Math.round(st.disk_pct)}%` : "",
    st.temp_c !== undefined ? `${st.temp_c.toFixed(0)}°C` : "",
    st.battery_pct !== undefined ? `bat ${Math.round(st.battery_pct)}%` : "",
    st.uptime_s !== undefined ? `up ${formatDuration(st.uptime_s * 1000)}` : "",
  ].filter(Boolean);
  return parts.join(" · ") || "status received";
}

export default function MachinesScreen() {
  const nav = useNavigation<NativeStackNavigationProp<MachinesStackParamList>>();
  const { rt, bootError, connection, connectionError, refreshNode, version } = usePorter();
  const { token } = useToken();
  const state = usePorterState();
  const toast = useToast();
  const now = useTick(15_000);
  const node = rt?.node;

  const [brokerURL, setBrokerURL] = useState<string | null>(null);
  const [serviceKey, setServiceKey] = useState("");
  const [bundle, setBundle] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  void version;

  const copyIdentity = async () => {
    if (!node) return;
    await Clipboard.setStringAsync(JSON.stringify(node.identityBundle("phone")));
    if (Platform.OS !== "android") toast.show("IDENTITY COPIED");
  };

  const saveBroker = async () => {
    if (!node) return;
    setBusy("broker");
    setError("");
    try {
      await node.configureBroker((brokerURL ?? node.brokerURL).trim(), serviceKey ? serviceKey : undefined);
      setServiceKey("");
      setBrokerURL(null);
      refreshNode();
      node.start();
      toast.show("BROKER OK");
      await rt?.porter.subscribeAll(token).catch(() => undefined);
    } catch (e) {
      setError(`broker: ${errText(e)}`);
    } finally {
      setBusy("");
    }
  };

  const pair = async () => {
    if (!node) return;
    setBusy("pair");
    setError("");
    try {
      const peer = await node.pair(bundle);
      setBundle("");
      refreshNode();
      toast.show(`PAIRED ${peer.alias.toUpperCase()}`);
      // porter may not be visible until the machine pairs + grants us back.
      await rt?.porter.subscribe(peer.machine_id, token).catch((e) => setError(`subscribe: ${errText(e)}`));
    } catch (e) {
      setError(`pair: ${errText(e)}`);
    } finally {
      setBusy("");
    }
  };

  const peers = node?.peers() ?? [];

  return (
    <View style={ui.screen}>
      <ScreenHeader title="MACHINES" status={`${peers.length} PAIRED · COMMS ${connection.toUpperCase()}`} />
      <ScrollView contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled">
        {bootError ? <Mono style={ui.error}>comms failed to start: {bootError}</Mono> : null}
        {error ? (
          <Block accent={colors.urgent}>
            <Mono size={11} style={{ color: colors.urgent }} selectable>{error}</Mono>
          </Block>
        ) : null}

        {/* PAIRED MACHINES */}
        {peers.map((p) => {
          const m = state.machines[p.machine_id];
          const sub = m?.subscribed;
          const agents = m ? Object.values(m.agents).filter((a) => a.status !== "ended") : [];
          const needs = agents.filter((a) => a.status === "needs_you").length;
          return (
            <Pressable key={p.machine_id} onPress={() => nav.navigate("MachineDetail", { machine: p.machine_id })}>
              <Block accent={needs ? colors.urgent : sub ? colors.accent : colors.border}>
                <View style={ui.row}>
                  <Mono bold>{(m?.name ?? p.alias).toUpperCase()}</Mono>
                  <Mono size={10} faint>{m?.lastMessageAt ? formatAgo(m.lastMessageAt, now) : "never heard"}</Mono>
                </View>
                <View style={[ui.rowGap, { marginTop: 6 }]}>
                  {sub?.approver ? <Badge label="APPROVER" color={colors.accent} /> : null}
                  {sub?.push ? <Badge label="PUSH" color={colors.accent} /> : sub ? <Badge label="NO PUSH" /> : null}
                  {!sub ? <Badge label={m?.subscribeSentAt ? "SUBSCRIBE SENT" : "NOT SUBSCRIBED"} /> : null}
                  {sub?.refused?.length ? <Badge label={`REFUSED ${sub.refused.join(",")}`} /> : null}
                  <Mono size={10} faint>{agents.length} agents{needs ? ` · ${needs} need you` : ""}</Mono>
                </View>
                <Mono size={11} dim style={{ marginTop: 6 }}>{statusLine(m)}</Mono>
                {m?.subscribeError ? <Mono size={10} style={{ color: colors.urgent, marginTop: 4 }}>{m.subscribeError}</Mono> : null}
              </Block>
            </Pressable>
          );
        })}

        {/* PAIR */}
        <Block title="PAIR A MACHINE">
          <Mono size={11} faint>
            On the machine run `comms export` and paste its JSON here. Then give it this phone's identity (below): `comms pair --file phone.json --alias phone` (or `--stdin`) and `comms grant phone`.
          </Mono>
          <Field value={bundle} onChangeText={setBundle} placeholder='{"machine_id":"m_…","public_key":"…","alias":"pi"}' multiline style={{ minHeight: 60, textAlignVertical: "top" }} />
          <Btn label={busy === "pair" ? "PAIRING…" : "PAIR"} onPress={pair} disabled={!node || !bundle.trim() || !!busy} />
        </Block>

        {/* IDENTITY */}
        <Block title="THIS PHONE" right={<Btn small label="COPY IDENTITY" onPress={copyIdentity} disabled={!node} />}>
          <KV label="MACHINE ID" value={node?.machineId ?? "…"} />
          <KV label="PUBLIC KEY" value={node?.identityBundle().public_key ?? "…"} />
          <KV label="AGENT" value={node ? `app (${node.agentId})` : "…"} />
        </Block>

        {/* BROKER */}
        <Block title="BROKER" right={<Badge label={connection.toUpperCase()} color={connection === "online" ? colors.accent : colors.borderBright} />}>
          <Field label="URL" value={brokerURL ?? node?.brokerURL ?? ""} onChangeText={setBrokerURL} placeholder="https://comms.example.com" keyboardType="url" />
          <Field
            label="SERVICE KEY"
            value={serviceKey}
            onChangeText={setServiceKey}
            placeholder={node?.hasServiceKey ? "•••••• stored (leave blank to keep)" : "paste broker service key"}
            secureTextEntry
          />
          <Btn label={busy === "broker" ? "TESTING…" : "SAVE & CONNECT"} onPress={saveBroker} disabled={!node || !!busy || !(brokerURL ?? node?.brokerURL)} />
          {connectionError && connection !== "online" ? <Mono size={10} faint style={{ marginTop: spacing.sm }}>{connectionError}</Mono> : null}
        </Block>

        <Mono size={10} faint bold style={{ letterSpacing: 2, marginVertical: spacing.md }}>APP SETTINGS</Mono>
        <SettingsSections />
      </ScrollView>
    </View>
  );
}
