// Settings (design: MachinesSettings): this phone, connection (broker, service
// key, push token), location; plus a dev-only mock-data switch.
import { useState } from "react";
import { Linking, Platform, ScrollView, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import Constants from "expo-constants";
import * as Location from "expo-location";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { MachinesStackParamList } from "../../navigation/types";
import { usePorter } from "../../porter/PorterProvider";
import { BackHeader, BigButton, Chevron, Input, KVRow, List, PageTitle, Screen, SectionHeader, Sheet, T, TextBtn, Toggle } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { useToken } from "../../tokenContext";
import { useLocation } from "../../locationContext";
import { t } from "../../theme";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const short = (s: string, head = 6, tail = 4) => (s.length > head + tail + 1 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s);

export default function MachinesSettingsScreen() {
  const nav = useNavigation<NativeStackNavigationProp<MachinesStackParamList>>();
  const { rt, connection, connectionError, refreshNode, mock, setMock } = usePorter();
  const { token, error: tokenError } = useToken();
  const loc = useLocation();
  const toast = useToast();
  const node = rt?.node;
  const version = (Constants.expoConfig?.version ?? "?") as string;
  const [editing, setEditing] = useState<"broker" | "key" | null>(null);
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const copy = async (text: string, label: string) => {
    await Clipboard.setStringAsync(text);
    if (Platform.OS !== "android") toast.show(`${label} copied`); // Android shows its own toast
  };

  const openEdit = (what: "broker" | "key") => {
    setUrl(node?.brokerURL ?? "");
    setKey("");
    setError("");
    setEditing(what);
  };

  const save = async () => {
    if (!node) return;
    setBusy(true);
    setError("");
    try {
      await node.configureBroker(url.trim(), key ? key : undefined);
      refreshNode();
      node.start();
      setEditing(null);
      toast.show("Broker OK");
      await rt?.porter.subscribeAll(token).catch(() => undefined);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const G = Location.PermissionStatus.GRANTED;
  const permText = loc.foreground === G && loc.background === G ? "granted" : loc.foreground === G ? "foreground only" : loc.foreground === Location.PermissionStatus.DENIED ? "denied" : "not asked";
  const fixPermissions = async () => {
    if (loc.foreground === Location.PermissionStatus.UNDETERMINED) await loc.requestForeground();
    else if (loc.foreground === G && loc.background === Location.PermissionStatus.UNDETERMINED) await loc.requestBackground();
    else void Linking.openSettings();
  };

  return (
    <Screen>
      <BackHeader label="Machines" onBack={() => nav.goBack()} />
      <PageTitle title="Settings" />
      <ScrollView contentContainerStyle={{ gap: 26, paddingBottom: 20 }}>
        <View>
          <SectionHeader size={15}>This phone</SectionHeader>
          <List>
            <KVRow
              label={<T size={15}>Identity</T>}
              sub={<T mono size={12} color={t.text3}>{node ? `phone · ${short(node.machineId)}` : "starting…"}</T>}
              right={<TextBtn label="Copy" size={15} disabled={!node} onPress={() => node && copy(JSON.stringify(node.identityBundle("phone")), "Identity")} />}
            />
            <KVRow label="App" value={`v${version} · ${Platform.OS === "android" ? "Android" : Platform.OS}`} />
          </List>
        </View>

        <View>
          <SectionHeader size={15} meta={connection === "online" ? "online" : connection}>Connection</SectionHeader>
          <List>
            <KVRow label="Broker" value={node?.brokerURL || "not set"} mono onPress={() => openEdit("broker")} />
            <KVRow label="Service key" value={node?.hasServiceKey ? "••••••••" : "not set"} mono right={<TextBtn label="Change" size={15} onPress={() => openEdit("key")} />} />
            <KVRow
              label="Push token"
              sub={tokenError ? tokenError : token ? undefined : "waiting for token…"}
              value={token ? short(token, 12, 4) : undefined}
              mono
              right={<TextBtn label="Copy" size={15} disabled={!token} onPress={() => token && copy(token, "Token")} />}
            />
          </List>
          {connectionError && connection !== "online" ? <T size={12} color={t.faint} style={{ marginHorizontal: 20, marginTop: 6 }}>{connectionError}</T> : null}
        </View>

        <View>
          <SectionHeader size={15}>Notifications</SectionHeader>
          <List>
            <KVRow label="Kinds and sounds" value="5 kinds" right={<Chevron />} onPress={() => nav.navigate("Notifications")} />
          </List>
        </View>

        <View>
          <SectionHeader size={15}>Location</SectionHeader>
          <List>
            <KVRow
              label={<T size={15}>Tracking</T>}
              sub={loc.background === G ? "Background geofence + significant changes" : "Needs background location permission"}
              right={<Toggle value={loc.tracking} disabled={loc.background !== G} onChange={(v) => void (v ? loc.startTracking() : loc.stopTracking())} />}
            />
            <KVRow label="Permissions" value={permText} right={<TextBtn label="Open ›" size={15} onPress={fixPermissions} />} />
          </List>
        </View>

        {__DEV__ ? (
          <View>
            <SectionHeader size={15} meta="dev builds only">Developer</SectionHeader>
            <List>
              <KVRow label={<T size={15}>Mock data</T>} sub="Show fake machines, agents and inbox (contract v1). Actions stay local." right={<Toggle value={mock} onChange={setMock} />} />
            </List>
          </View>
        ) : null}
      </ScrollView>

      <Sheet visible={editing !== null} onClose={() => setEditing(null)}>
        <View style={{ paddingHorizontal: 20, gap: 12 }}>
          <T size={20} weight="700">{editing === "key" ? "Service key" : "Broker"}</T>
          {editing === "broker" ? <Input mono value={url} onChangeText={setUrl} placeholder="https://comms.example.com" keyboardType="url" /> : null}
          <Input value={key} onChangeText={setKey} placeholder={node?.hasServiceKey ? "Service key (blank keeps the stored one)" : "Paste the broker service key"} secureTextEntry />
          {error ? <T size={12} color={t.danger} selectable>{error}</T> : null}
          <View style={{ flexDirection: "row" }}>
            <BigButton label={busy ? "Testing…" : "Save & connect"} disabled={busy || !url.trim()} onPress={save} />
          </View>
        </View>
      </Sheet>
    </Screen>
  );
}
