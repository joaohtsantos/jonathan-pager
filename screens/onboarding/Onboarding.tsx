// First launch (designs: FirstConnect, FirstName, FirstPair). Shown only when
// no broker is configured and onboarding was never finished.
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePorter } from "../../porter/PorterProvider";
import { M, T } from "../../components/ui";
import { keyFingerprint } from "../../lib/fingerprint";
import { DEFAULT_NEW_ALIAS, usePhoneAlias } from "../../lib/phoneAlias";
import { useToken } from "../../tokenContext";
import PairScreen from "../machines/PairScreen";
import { Logo } from "./Logo";
import { fonts, t } from "../../theme";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const ALIAS_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

function Dots({ step }: { step: number }) {
  return (
    <View style={{ flexDirection: "row", gap: 6, justifyContent: "center", paddingTop: 18 }}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={{ width: i === step ? 22 : 8, height: 8, borderRadius: 4, backgroundColor: i === step ? t.accent : "rgba(255,255,255,0.2)" }} />
      ))}
    </View>
  );
}

function Primary({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [s.primary, disabled && { backgroundColor: "rgba(10,132,255,0.35)" }, pressed && { opacity: 0.8 }]}>
      <T size={17} weight="700" color={disabled ? "rgba(255,255,255,0.5)" : t.white}>{label}</T>
    </Pressable>
  );
}

function Field({ label, ...props }: { label: string } & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={{ gap: 6 }}>
      <T size={13} weight="600" color="rgba(255,255,255,0.65)">{label}</T>
      <TextInput placeholderTextColor={t.faint} autoCapitalize="none" autoCorrect={false} {...props} style={[s.input, props.style]} />
    </View>
  );
}

export default function Onboarding({ onDone }: { onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const { rt, refreshNode } = usePorter();
  const { token } = useToken();
  const [, setAlias] = usePhoneAlias();
  const [step, setStep] = useState(0);
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [name, setName] = useState(DEFAULT_NEW_ALIAS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pairing, setPairing] = useState(false);
  const node = rt?.node;

  const connect = async () => {
    if (!node) return;
    setBusy(true);
    setError("");
    try {
      await node.configureBroker(url.trim(), key);
      refreshNode();
      node.start();
      setStep(1);
    } catch (e) {
      setError(`Couldn't connect: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const saveName = () => {
    setAlias(name);
    setStep(2);
    void rt?.porter.subscribeAll(token).catch(() => undefined);
  };

  const body =
    step === 0 ? (
      <>
        <View style={{ alignItems: "center", gap: 14 }}>
          <Logo size={72} />
          <T size={26} weight="700" color={t.white}>Welcome to Pager</T>
          <T size={15} color="rgba(255,255,255,0.65)" style={{ textAlign: "center", lineHeight: 21 }}>
            Your agents, pushes and location, on your phone. First, connect to your comms broker.
          </T>
        </View>
        <Field label="Broker URL" value={url} onChangeText={setUrl} placeholder="https://…" keyboardType="url" style={{ fontFamily: fonts.mono }} />
        <Field label="Service key" value={key} onChangeText={setKey} secureTextEntry placeholder="paste the broker service key" />
        <T size={12} color={t.text3}>Saved only on this phone. Change later in Settings.</T>
        {error ? <T size={13} color={t.danger} selectable>{error}</T> : null}
        <View style={{ flex: 1 }} />
        <Primary label={busy ? "Connecting…" : "Connect"} onPress={connect} disabled={busy || !node || !url.trim() || !key.trim()} />
      </>
    ) : step === 1 ? (
      <>
        <View style={{ gap: 10 }}>
          <T size={26} weight="700" color={t.white}>Name this phone</T>
          <T size={15} color="rgba(255,255,255,0.65)" style={{ lineHeight: 21 }}>Machines will see this name when the phone asks them for things.</T>
        </View>
        <Field label="Phone name" value={name} onChangeText={(v) => setName(v.toLowerCase())} style={{ fontFamily: fonts.mono }} />
        {!ALIAS_RE.test(name) ? <T size={12} color={t.danger}>Lowercase letters, digits and dashes.</T> : null}
        <View style={s.card}>
          <T size={12} weight="600" color={t.dim}>Identity created</T>
          <T mono size={16} style={{ letterSpacing: 1 }}>{node ? keyFingerprint(node.identityBundle().public_key) : "…"}</T>
          <T size={12} color={t.dim}>Key fingerprint. Machines show it when you pair.</T>
        </View>
        <View style={{ flex: 1 }} />
        <Primary label="Continue" onPress={saveName} disabled={!ALIAS_RE.test(name)} />
      </>
    ) : (
      <>
        <View style={{ gap: 10 }}>
          <T size={26} weight="700" color={t.white}>Add your first machine</T>
          <T size={15} color="rgba(255,255,255,0.65)" style={{ lineHeight: 21 }}>Pair a Mac or the Pi to see its agents and get its pushes.</T>
        </View>
        <View style={[s.card, { gap: 10 }]}>
          <T size={14}><T size={14} weight="700">1</T> · Copy this phone's identity</T>
          <T size={14}>
            <T size={14} weight="700">2</T> · On the machine: <M>{`comms pair --stdin --alias ${name}`}</M>, then <M>comms export</M>
          </T>
          <T size={14}><T size={14} weight="700">3</T> · Paste its identity here and check the fingerprint</T>
        </View>
        <View style={{ flex: 1 }} />
        <Primary label="Add a machine" onPress={() => setPairing(true)} />
        <Pressable onPress={onDone} style={{ minHeight: 44, alignItems: "center", justifyContent: "center" }}>
          <T size={15} weight="600" color={t.accent}>Skip for now</T>
        </Pressable>
      </>
    );

  if (pairing) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top + 12, paddingBottom: insets.bottom }}>
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 10, minHeight: 44 }}>
          <Pressable onPress={() => setPairing(false)} style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 6 }}>
            <T size={16} color={t.accent}>‹ Back</T>
          </Pressable>
        </View>
        <T size={24} weight="700" style={{ marginHorizontal: 20, marginBottom: 18 }}>Add a machine</T>
        <PairScreen embedded onDone={onDone} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={{ paddingTop: insets.top }}>
        <Dots step={step} />
      </View>
      <ScrollView contentContainerStyle={{ flexGrow: 1, gap: 22, paddingTop: 40, paddingHorizontal: 24, paddingBottom: 28 + insets.bottom }} keyboardShouldPersistTaps="handled">
        {body}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  input: { minHeight: 48, borderWidth: 1, borderColor: "rgba(255,255,255,0.14)", borderRadius: 10, paddingHorizontal: 12, backgroundColor: "rgba(255,255,255,0.05)", color: t.white, fontSize: 15 },
  primary: { minHeight: 52, borderRadius: 12, backgroundColor: t.accent, alignItems: "center", justifyContent: "center" },
  card: { padding: 14, borderRadius: 12, backgroundColor: "#262629", gap: 6 },
});

