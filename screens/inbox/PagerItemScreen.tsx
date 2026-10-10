// Legacy pager-api item, in the same layout as InboxItemScreen:
// a pending request = InboxOpenAsk (editable proposed draft, pinned
// Dismiss = reject / Send reply = approve), a push = InboxOpenMsg.
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Linking, Platform, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTick } from "../../porter/PorterProvider";
import { dayLabel, formatHM } from "../../porter/selectors";
import { answerRequest, GENERIC_REQUEST_TYPES, parseRequestPayload, setPushRead, type PagerPush, type PagerRequest } from "../../lib/pagerApi";
import type { InboxStackParamList } from "../../navigation/types";
import { BackHeader, BigButton, BottomBar, ButtonPair, Screen, T, TextBtn } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { KindIcon, LOOK } from "./inboxLook";
import { t } from "../../theme";

export default function PagerItemScreen() {
  const { params } = useRoute<RouteProp<InboxStackParamList, "PagerItem">>();
  const nav = useNavigation<NativeStackNavigationProp<InboxStackParamList>>();
  const back = () => nav.goBack();
  return "request" in params ? <RequestView req={params.request} back={back} /> : <PushView push={params.push} back={back} />;
}

function useWhen() {
  const now = useTick(30_000);
  return (iso: string) => {
    const ms = Date.parse(iso) || 0;
    return `${dayLabel(ms, now).toLowerCase()} ${formatHM(ms)}`;
  };
}

function Head({ look, label, color, time, title, body }: { look: "question" | "high" | "message"; label: string; color: string; time: string; title: string; body?: string | null }) {
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <KindIcon look={look} />
        <T size={13} weight="600" color={color}>{label}</T>
        <T mono size={12} color={t.text3} style={{ marginLeft: "auto" }}>{time}</T>
      </View>
      <T size={24} weight="700" color={t.white} style={{ lineHeight: 29 }} selectable>{title}</T>
      {body ? <T size={16} color="rgba(255,255,255,0.85)" style={{ lineHeight: 24 }} selectable>{body}</T> : null}
    </View>
  );
}

function RequestView({ req, back }: { req: PagerRequest; back: () => void }) {
  const toast = useToast();
  const when = useWhen();
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const generic = GENERIC_REQUEST_TYPES.has(req.type);
  const { detail, actions } = parseRequestPayload(req.payload);
  const title = req.email_subject ?? req.summary;
  const body = [req.summary && req.summary !== title ? req.summary : "", detail ?? ""].filter(Boolean).join("\n\n");
  const high = req.priority === "high";
  const hasDraft = !generic && !!req.proposed_action;
  const shownDraft = draft ?? req.proposed_action ?? "";
  const edited = draft !== null && draft !== req.proposed_action;

  const act = async (status: "approved" | "rejected") => {
    setBusy(true);
    try {
      await answerRequest(req, status, hasDraft ? shownDraft : undefined);
      toast.show(status === "approved" ? (generic ? "Done" : hasDraft ? "Reply sent" : "Approved") : "Dismissed");
      back();
    } catch (e) {
      toast.show(`Couldn't send: ${e instanceof Error ? e.message : String(e)}`, 3000);
      setBusy(false);
    }
  };

  const yesLabel = generic ? "Done" : hasDraft ? "Send reply" : "Approve";

  return (
    <Screen inbox>
      <BackHeader label="Inbox" onBack={back} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={{ gap: 22, paddingTop: 8, paddingHorizontal: 20, paddingBottom: 16 }} keyboardShouldPersistTaps="handled">
          <View style={{ gap: 10 }}>
            <Head
              look={high ? "high" : "question"}
              label={high ? "Question · high priority" : LOOK.question.label}
              color={high ? t.kindHigh : t.kindQuestion}
              time={when(req.created_at)}
              title={title}
              body={body}
            />
            {actions.map((a, i) => (
              <TextBtn key={i} label={`${a.label} ›`} onPress={() => void Linking.openURL(a.url).catch(() => toast.show("Couldn't open link"))} />
            ))}
          </View>

          {hasDraft ? (
            <View>
              <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 6, minHeight: 32 }}>
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
              {req.email_sender ? (
                <View style={s.kv}>
                  <T mono size={15} color={t.white} lines={1} style={{ flexShrink: 1 }} selectable>{req.email_sender}</T>
                </View>
              ) : null}
              <KV k="Via" v={`pager-api · ${req.type}`} />
              <KV k="Received" v={when(req.created_at)} />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      <BottomBar inbox>
        <ButtonPair>
          <BigButton inbox kind="secondary" label="Dismiss" disabled={busy} onPress={() => act("rejected")} />
          <BigButton label={yesLabel} disabled={busy || (hasDraft && !shownDraft.trim())} onPress={() => act("approved")} />
        </ButtonPair>
      </BottomBar>
    </Screen>
  );
}

function PushView({ push, back }: { push: PagerPush; back: () => void }) {
  const toast = useToast();
  const when = useWhen();

  useEffect(() => {
    if (!push.read) void setPushRead(push.id, true).catch(() => undefined);
  }, [push.id, push.read]);

  const markUnread = async () => {
    try {
      await setPushRead(push.id, false);
      back();
    } catch {
      toast.show("Failed");
    }
  };

  return (
    <Screen inbox>
      <BackHeader label="Inbox" onBack={back} right={<TextBtn label="Mark unread" weight="400" size={15} onPress={markUnread} />} />
      <ScrollView contentContainerStyle={{ gap: 24, paddingTop: 8, paddingHorizontal: 20, paddingBottom: 20 }}>
        <Head look="message" label={LOOK.message.label} color={t.kindMessage} time={when(push.created_at)} title={push.title} body={push.body} />
        <View>
          <T size={12} weight="600" color={t.text3} style={{ marginBottom: 6 }}>From</T>
          <View style={{ borderTopWidth: 1, borderTopColor: t.divider }}>
            <View style={s.kv}>
              <T mono size={15}>
                <T mono size={15} color={t.white}>pager</T>
                <T mono size={15} color={t.text3}>:{push.source}</T>
              </T>
            </View>
            <KV k="Received" v={`${when(push.created_at)} · pager-api`} />
          </View>
        </View>
      </ScrollView>
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
