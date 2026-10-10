// Add a machine (design: AppPair): give it this phone's identity, paste its
// identity (alias + key fingerprint shown to verify), pick topics, pair.
import { useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useNavigation } from "@react-navigation/native";
import { usePorter } from "../../porter/PorterProvider";
import { parseBundle } from "../../comms/node";
import { Check, Input, KVRow, List, PageTitle, Screen, SectionHeader, T, TextBtn, BackHeader } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { useToken } from "../../tokenContext";
import { t } from "../../theme";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** First 16 base64 chars of the key, in groups of 4 (matches `comms export` by eye). */
export function fingerprint(pub: string) {
  return pub.slice(0, 16).replace(/(.{4})/g, "$1 ").trim();
}

export default function PairScreen() {
  const nav = useNavigation();
  const { rt, refreshNode } = usePorter();
  const { token } = useToken();
  const toast = useToast();
  const node = rt?.node;
  const [text, setText] = useState("");
  const [topics, setTopics] = useState({ agents: true, status: true, trusts: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const identity = node ? JSON.stringify(node.identityBundle("phone")) : "…";
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
    await Clipboard.setStringAsync(identity);
    if (Platform.OS !== "android") toast.show("Identity copied");
  };

  const pair = async () => {
    if (!node || !ok) return;
    setBusy(true);
    setError("");
    try {
      const peer = await node.pair(extractJSON(text));
      refreshNode();
      const want = (Object.keys(topics) as (keyof typeof topics)[]).filter((k) => topics[k]);
      // porter may not be visible until the machine pairs + grants us back.
      await rt?.porter.subscribe(peer.machine_id, token, want).catch((e) => toast.show(`Paired; subscribe failed: ${errText(e)}`, 3000));
      toast.show(`Paired ${peer.alias}`);
      nav.goBack();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <BackHeader label="Machines" onBack={() => nav.goBack()} />
      <PageTitle title="Add a machine" />
      <ScrollView contentContainerStyle={{ gap: 22, paddingBottom: 20 }} keyboardShouldPersistTaps="handled">
        <View>
          <SectionHeader meta="paste on the machine">1 · Give it this phone</SectionHeader>
          <List>
            <KVRow label={<T mono size={12} color={t.faint} lines={1} style={{ flexShrink: 1 }}>{identity}</T>} right={<TextBtn label="Copy" onPress={copy} disabled={!node} />} />
          </List>
          <T size={12} color={t.faint} style={{ marginTop: 8, marginHorizontal: 20 }}>
            On the machine: <T mono size={12} color={t.dim}>comms pair --stdin</T> then <T mono size={12} color={t.dim}>comms grant phone</T>
          </T>
        </View>

        <View>
          <SectionHeader meta="from comms export">2 · Paste the machine's identity</SectionHeader>
          <List>
            <View style={{ paddingVertical: 10, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: t.hairline }}>
              <T size={11} color={t.faint}>Identity</T>
              <Input mono multiline value={text} onChangeText={setText} placeholder='{"machine_id":"m_…","public_key":"…","alias":"work-mac"}' style={{ marginTop: 4, minHeight: 76, textAlignVertical: "top", borderRadius: 8 }} />
            </View>
            {ok ? (
              <>
                <KVRow label="Alias" value={ok.alias} mono />
                <KVRow label="Key fingerprint" value={fingerprint(ok.public_key)} mono />
              </>
            ) : parsed && "error" in parsed ? (
              <KVRow label={<T size={13} color={t.danger}>{parsed.error}</T>} />
            ) : null}
          </List>
          <T size={12} color={t.faint} style={{ marginTop: 8, marginHorizontal: 20 }}>
            Check the fingerprint matches <T mono size={12} color={t.dim}>comms export</T> on that machine.
          </T>
        </View>

        <View>
          <SectionHeader>3 · Subscribe to</SectionHeader>
          <List>
            <Check label="Agents" value={topics.agents} onChange={(v) => setTopics({ ...topics, agents: v })} />
            <Check label="Status" value={topics.status} onChange={(v) => setTopics({ ...topics, status: v })} />
            <Check label="Trusts" sub="only if this phone approves there" value={topics.trusts} onChange={(v) => setTopics({ ...topics, trusts: v })} />
          </List>
        </View>

        {error ? <T size={12} color={t.danger} style={{ marginHorizontal: 20 }} selectable>{error}</T> : null}
        <View style={{ paddingHorizontal: 18 }}>
          <Pressable onPress={pair} disabled={!ok || busy || !node} style={({ pressed }) => [{ minHeight: 48, borderRadius: 10, backgroundColor: ok && node ? t.accent : "rgba(10,132,255,0.35)", alignItems: "center", justifyContent: "center" }, pressed && { opacity: 0.8 }]}>
            <T size={16} weight="700" color={ok ? t.white : "rgba(255,255,255,0.5)"}>{busy ? "Pairing…" : ok ? `Pair ${ok.alias}` : "Pair"}</T>
          </Pressable>
        </View>
      </ScrollView>
    </Screen>
  );
}

/** Tolerates surrounding text / code fences around the JSON bundle. */
function extractJSON(s: string) {
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  return a >= 0 && b > a ? s.slice(a, b + 1) : s;
}
