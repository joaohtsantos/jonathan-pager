// One inbox item: InboxOpenMsg (message) or InboxOpenAsk (question with an
// optional editable draft; actions pinned at the bottom).
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Linking, Platform, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import { usePorter, usePorterState, useTick } from "../../porter/PorterProvider";
import { agentKey, effectivePref, isQuestion, notifySenderAgent } from "../../porter/store";
import { dayLabel, formatHM, machineLiveness, notifyLook, resolutionText, senderParts } from "../../porter/selectors";
import type { InboxStackParamList } from "../../navigation/types";
import { BackHeader, BigButton, BottomBar, ButtonPair, Empty, Note, Screen, Segmented, T, TextBtn } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { KindIcon, LOOK } from "./inboxLook";
import { t } from "../../theme";

const isDenyish = (c: string) => /^(deny|dismiss|no|reject|skip|cancel|ignore)/i.test(c);

export default function InboxItemScreen() {
  const { params } = useRoute<RouteProp<InboxStackParamList, "InboxItem">>();
  const nav = useNavigation<NativeStackNavigationProp<InboxStackParamList>>();
  const { actions, store, rt, presence, phoneOffline } = usePorter();
  const state = usePorterState();
  const toast = useToast();
  const now = useTick(1000);
  const item = state.inbox.find((i) => i.id === params.id && i.fromMachine === params.machine);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (item && !item.read) void store?.updateInbox(item.id, item.fromMachine, (i) => ({ ...i, read: true }));
    // Only on open: "Mark unread" must stick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);

  const back = () => nav.goBack();
  if (!item) {
    return (
      <Screen inbox>
        <BackHeader label="Inbox" onBack={back} />
        <Empty title="Not found" hint="This notification is no longer stored." />
      </Screen>
    );
  }

  const n = item.notify;
  const machine = state.machines[item.fromMachine];
  const machineName = machine?.name ?? rt?.node.peer(item.fromMachine)?.alias ?? item.fromMachine.slice(0, 10);
  const sp = senderParts(item, machineName);
  const look = notifyLook(item, now);
  const open = isQuestion(item, now);
  const asking = !!n.ask?.length;
  const live = machineLiveness(machine, presence, now);
  const senderKey = notifySenderAgent(item);
  const ak = senderKey ? agentKey(item.fromMachine, senderKey) : undefined;
  const pref = effectivePref(state.prefs, item.fromMachine, senderKey);
  const exp = n.expires_at ? Date.parse(n.expires_at) : 0;
  const shownDraft = draft ?? n.draft ?? "";
  const edited = draft !== null && draft !== (n.draft ?? "");

  const when = (ms: number) => `${dayLabel(ms, now).toLowerCase()} ${formatHM(ms)}`;
  const headTime = open && exp ? `answer by ${formatHM(exp)}` : when(n.sent_at ? Date.parse(n.sent_at) : item.receivedAt);
  const kindLabel = look === "answered" ? (n.kind === "permission" ? "Permission" : n.kind === "trust" ? "Trust" : "Question") : LOOK[look].label;
  const kindColor = look === "answered" ? t.dim : LOOK[look].color;

  const send = async (choice: string, text?: string) => {
    setBusy(true);
    try {
      await actions.answer(item, choice, text);
      toast.show(`Sent · ${choice}`);
    } catch (e) {
      toast.show(`Couldn't send: ${e instanceof Error ? e.message : String(e)}`, 3000);
    } finally {
      setBusy(false);
    }
  };

  const dismiss = async () => {
    const d = n.ask?.find(isDenyish);
    if (d) await send(d);
    else await actions.dismiss(item);
  };

  const setPref = async (v: "allow" | "mute" | "block") => {
    if (!ak || !store) return;
    await store.setSenderPref(ak, v);
  };

  const openLink = () => {
    const link = n.link;
    if (!link) return;
    const m = /^agent:([^/]+)\/(.+)$/.exec(link);
    if (m) {
      const target = Object.values(state.machines).find((x) => x.name === m[1])?.machineId ?? item.fromMachine;
      nav.navigate("AgentDetail", { machine: target, agent: m[2], from: "Inbox" });
    } else if (/^https:\/\//.test(link)) void Linking.openURL(link);
  };

  // ---- bottom actions (questions only) -------------------------------------------
  let bottom = null;
  if (asking && open) {
    const offline = !live.online || phoneOffline;
    const disabled = offline || busy || item.answer?.state === "sending";
    const note = !live.online ? `Can't reach ${machineName} — buttons come back when it does` : phoneOffline ? "No connection — buttons come back when it does" : item.answer?.state === "failed" ? `Couldn't send: ${item.answer.error ?? "error"} — try again` : undefined;
    const choices = n.ask!;
    if (n.draft !== undefined) {
      const sendChoice = choices.find((c) => !isDenyish(c)) ?? choices[0];
      bottom = (
        <BottomBar inbox note={note}>
          <ButtonPair>
            <BigButton inbox kind="secondary" label="Dismiss" disabled={busy} onPress={dismiss} />
            <BigButton label="Send reply" disabled={disabled || !shownDraft.trim()} onPress={() => send(sendChoice, shownDraft)} />
          </ButtonPair>
        </BottomBar>
      );
    } else if (choices.length === 2) {
      const deny = choices.find(isDenyish) ?? choices[1];
      const yes = choices.find((c) => c !== deny) ?? choices[0];
      bottom = (
        <BottomBar inbox note={note}>
          <ButtonPair>
            <BigButton inbox kind="secondary" label={deny} disabled={disabled} onPress={() => send(deny)} />
            <BigButton label={yes} disabled={disabled} onPress={() => send(yes)} />
          </ButtonPair>
        </BottomBar>
      );
    } else {
      bottom = (
        <BottomBar inbox note={note}>
          {choices.map((c, i) => (
            <View key={c} style={{ flexDirection: "row" }}>
              <BigButton inbox kind={isDenyish(c) ? "secondary" : i === 0 ? "primary" : "secondary"} label={c} disabled={disabled} onPress={() => send(c)} />
            </View>
          ))}
        </BottomBar>
      );
    }
  }

  const outcome = asking && !open ? resolutionText(item, machineName) : undefined;

  return (
    <Screen inbox>
      <BackHeader
        label="Inbox"
        onBack={back}
        right={!asking ? <TextBtn label="Mark unread" weight="400" size={15} onPress={() => { void store?.updateInbox(item.id, item.fromMachine, (i) => ({ ...i, read: false })); back(); }} /> : undefined}
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={{ gap: 24, paddingTop: 8, paddingHorizontal: 20, paddingBottom: 20 }} keyboardShouldPersistTaps="handled">
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <KindIcon look={look} />
              <T size={13} weight="600" color={kindColor}>{kindLabel}</T>
              <T mono size={12} color={t.text3} style={{ marginLeft: "auto" }}>{headTime}</T>
            </View>
            <T size={24} weight="700" color={t.white} style={{ lineHeight: 29 }} selectable>{n.title}</T>
            {n.body ? <T size={16} color="rgba(255,255,255,0.85)" style={{ lineHeight: 24 }} selectable>{n.body}</T> : null}
            {n.trust ? <T mono size={13} color={t.dim}>{`${n.trust.sender} → ${n.trust.receiver}`}</T> : null}
            {n.reason ? <T size={13} color="rgba(255,255,255,0.6)">Why: {n.reason}</T> : null}
            {n.link ? <TextBtn label={n.link.startsWith("agent:") ? "Open agent ›" : "Open link ›"} onPress={openLink} /> : null}
          </View>

          {outcome ? <Note tone={item.answer?.state === "sent" ? "green" : "neutral"}>{(item.answer?.state === "sent" ? "✓ " : "") + outcome + (item.answer?.text ? ` · “${item.answer.text}”` : "")}</Note> : null}

          {asking && open && n.draft !== undefined ? (
            <View>
              <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}>
                <T size={12} weight="600" color={t.text3}>Draft reply</T>
                {edited ? <T size={12} color="rgba(255,255,255,0.4)" style={{ marginLeft: 6 }}>· edited</T> : null}
                {edited ? <View style={{ marginLeft: "auto" }}><TextBtn label="Reset" size={13} onPress={() => setDraft(null)} /></View> : null}
              </View>
              <TextInput
                accessibilityLabel="Draft reply"
                value={shownDraft}
                onChangeText={setDraft}
                multiline
                style={s.draft}
                placeholderTextColor={t.faint}
                placeholder="Write a reply"
                textAlignVertical="top"
              />
            </View>
          ) : null}

          <View>
            <T size={12} weight="600" color={t.text3} style={{ marginBottom: 6 }}>From</T>
            <View style={{ borderTopWidth: 1, borderTopColor: t.divider }}>
              <View style={s.kv}>
                <T mono size={15}>
                  <T mono size={15} color={t.white}>{sp.machine}</T>
                  {sp.agent ? <T mono size={15} color={t.text3}>:{sp.agent}</T> : null}
                </T>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Feather name="check" size={12} color={t.accent} />
                  <T size={12} color="rgba(255,255,255,0.6)">verified</T>
                </View>
              </View>
              {n.context?.title ? <KV k="Session" v={n.context.title} /> : null}
              {n.context?.harness || n.context?.project ? <KV k="Harness · project" v={[n.context?.harness, n.context?.project].filter(Boolean).join(" · ")} /> : null}
              {asking ? null : <KV k="Received" v={`${when(item.receivedAt)} · ${item.via}`} />}
            </View>
          </View>

          {ak && !asking ? (
            <View>
              <T size={12} weight="600" color={t.text3} style={{ marginBottom: 6 }}>
                Pushes from <T mono size={12} color={t.text3}>{sp.agent ? `${sp.machine}:${sp.agent}` : sp.machine}</T>
              </T>
              <Segmented
                value={pref}
                onChange={setPref}
                options={[
                  { value: "allow", label: "Allow" },
                  { value: "mute", label: "Mute" },
                  { value: "block", label: "Block", color: t.danger },
                ]}
              />
              <TextBtn label="All senders ›" size={13} onPress={() => nav.navigate("Senders")} />
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
      {bottom}
    </Screen>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <View style={s.kv}>
      <T color="rgba(255,255,255,0.6)">{k}</T>
      <T mono size={13} lines={1} style={{ flexShrink: 1 }}>{v}</T>
    </View>
  );
}

const s = StyleSheet.create({
  kv: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, height: 44, borderBottomWidth: 1, borderBottomColor: t.divider },
  draft: { minHeight: 100, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", borderRadius: 10, padding: 12, backgroundColor: "rgba(255,255,255,0.05)", color: t.white, fontSize: 15, lineHeight: 22 },
});
