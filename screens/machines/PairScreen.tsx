// Add a machine (design: PairFinal): three numbered steps, then "Pair <alias>".
// Subscribes to agents, status and trusts; changeable on the machine page.
import { useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useNavigation } from "@react-navigation/native";
import { usePorter } from "../../porter/PorterProvider";
import { parseBundle } from "../../comms/node";
import { BackHeader, BigButton, M, PageTitle, Screen, T } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { useToken } from "../../tokenContext";
import { keyFingerprint } from "../../lib/fingerprint";
import { usePhoneAlias } from "../../lib/phoneAlias";
import { fonts, t } from "../../theme";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Tolerates surrounding text / code fences around the JSON bundle. */
export function extractJSON(s: string) {
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  return a >= 0 && b > a ? s.slice(a, b + 1) : s;
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", gap: 14 }}>
      <View style={s.num}>
        <T size={13} weight="700" color={t.accent}>{n}</T>
      </View>
      <View style={{ flex: 1, gap: 8 }}>
        <T size={16} weight="600">{title}</T>
        {children}
      </View>
    </View>
  );
}

export default function PairScreen({ onDone, embedded }: { onDone?: () => void; embedded?: boolean } = {}) {
  const nav = useNavigation();
  const { rt, refreshNode } = usePorter();
  const { token } = useToken();
  const toast = useToast();
  const [alias] = usePhoneAlias();
  const node = rt?.node;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const done = onDone ?? (() => nav.goBack());

  const parsed = useMemo(() => {
    if (!text.trim()) return null;
    try {
      return parseBundle(extractJSON(text));
    } catch (e) {
      return { error: errText(e) } as const;
    }
  }, [text]);
  const ok = parsed && !("error" in parsed) ? parsed : null;

  const copy = async () => {
    if (!node) return;
    await Clipboard.setStringAsync(JSON.stringify(node.identityBundle(alias)));
    if (Platform.OS !== "android") toast.show("Identity copied");
  };

  const pair = async () => {
    if (!node || !ok) return;
    setBusy(true);
    setError("");
    try {
      const peer = await node.pair(extractJSON(text));
      refreshNode();
      // porter may not be visible until the machine pairs + grants us back.
      await rt?.porter.subscribe(peer.machine_id, token, ["agents", "status", "trusts"]).catch((e) => toast.show(`Paired; subscribe failed: ${errText(e)}`, 3000));
      toast.show(`Paired ${peer.alias}`);
      done();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const body = (
    <ScrollView contentContainerStyle={{ flexGrow: 1, gap: 22, paddingHorizontal: 20, paddingBottom: 16 }} keyboardShouldPersistTaps="handled">
      <Step n={1} title="Give the machine this phone">
        <Pressable onPress={copy} disabled={!node} style={({ pressed }) => [s.copy, pressed && { opacity: 0.7 }]}>
          <T size={15} weight="600" color={t.white}>Copy this phone's identity</T>
        </Pressable>
        <T size={13} color="rgba(255,255,255,0.6)">
          Then on the machine: <M color={t.white}>{`comms pair --stdin --alias ${alias}`}</M> and <M color={t.white}>{`comms grant ${alias}`}</M>
        </T>
      </Step>
      <Step n={2} title="Paste the machine's identity">
        <T size={13} color="rgba(255,255,255,0.6)">
          From <M color={t.white}>comms export</M> on that machine
        </T>
        <TextInput
          accessibilityLabel="Machine identity"
          value={text}
          onChangeText={setText}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          placeholder='{"machine_id":"m_…","public_key":"…","alias":"work-mac"}'
          placeholderTextColor={t.faint}
          style={s.area}
          textAlignVertical="top"
        />
        {parsed && "error" in parsed ? <T size={12} color={t.danger}>{parsed.error}</T> : null}
      </Step>
      <Step n={3} title="Check it's the right machine">
        <View style={s.check}>
          <T mono size={17} weight="600" color={ok ? t.white : t.faint}>{ok ? ok.alias : "—"}</T>
          <T mono size={18} color={ok ? t.white : t.faint} style={{ letterSpacing: 1.2 }}>{ok ? keyFingerprint(ok.public_key) : "paste the identity first"}</T>
          <T size={12} color={t.dim}>
            Must match the fingerprint <M>comms export</M> shows there
          </T>
        </View>
      </Step>
      <View style={{ flex: 1 }} />
      {error ? <T size={12} color={t.danger} selectable>{error}</T> : null}
      <T size={12} color={t.text3} style={{ textAlign: "center" }}>Subscribes to agents, status and trusts · change later in the machine's page</T>
      <View style={{ flexDirection: "row" }}>
        <BigButton label={busy ? "Pairing…" : ok ? `Pair ${ok.alias}` : "Pair"} disabled={!ok || busy || !node} onPress={pair} />
      </View>
    </ScrollView>
  );

  if (embedded) return body;
  return (
    <Screen>
      <BackHeader label="Machines" onBack={() => nav.goBack()} />
      <View style={{ paddingTop: 2, paddingHorizontal: 20, paddingBottom: 18 }}>
        <PageTitle title="Add a machine" />
      </View>
      {body}
    </Screen>
  );
}

const s = StyleSheet.create({
  num: { width: 26, height: 26, borderRadius: 13, backgroundColor: "rgba(10,132,255,0.2)", alignItems: "center", justifyContent: "center" },
  copy: { minHeight: 44, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.1)", alignItems: "center", justifyContent: "center" },
  area: { height: 72, borderWidth: 1, borderColor: "rgba(255,255,255,0.14)", borderRadius: 10, padding: 10, backgroundColor: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.75)", fontSize: 12, lineHeight: 17, fontFamily: fonts.mono },
  check: { padding: 14, borderRadius: 10, backgroundColor: "#262629", gap: 6 },
});
