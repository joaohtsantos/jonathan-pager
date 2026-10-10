// Agent detail — the D6 states (StateRunning, StatePermission, StateQuestion,
// StateAnswered, StateElsewhere, StateDone, StateOffline, StateEnded,
// StateSubagent). The bottom bar is pinned only when there is something to act on.
import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { usePorter, usePorterState, useTick } from "../../porter/PorterProvider";
import {
  describeNeed,
  formatClock,
  formatHM,
  formatShort,
  lastResolution,
  lifetimeMs,
  liveDurations,
  machineLiveness,
  questionForAgent,
  recapLines,
  type Resolution,
  displayStatus,
  subagentVisible,
} from "../../porter/selectors";
import type { Agent } from "../../porter/types";
import type { AgentDetailParams } from "../../navigation/types";
import { BackHeader, BigButton, BottomBar, ButtonPair, Empty, M, Note, Screen, StatusDot, T, statusColor } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { errorLine, statusLabel } from "./AgentsScreen";
import { t } from "../../theme";

type Nav = NativeStackNavigationProp<{ AgentDetail: AgentDetailParams; AgentsList: undefined; InboxList: undefined }>;

/** A resolution counts as "just happened" for this long after it, while running. */
const RECENT_MS = 15 * 60_000;

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <T size={12} color={t.faint}>{label}</T>
      {children}
    </View>
  );
}

function Recap({ lines }: { lines: string[] }) {
  if (!lines.length) return null;
  return (
    <View style={{ gap: 8 }}>
      <T size={12} color={t.faint}>So far</T>
      <View style={{ gap: 6 }}>
        {lines.map((l, i) => (
          <View key={i} style={{ flexDirection: "row", gap: 8, paddingLeft: 4 }}>
            <T color="rgba(255,255,255,0.8)">•</T>
            <T color="rgba(255,255,255,0.8)" style={{ flex: 1, lineHeight: 20 }}>
              {l}
            </T>
          </View>
        ))}
      </View>
    </View>
  );
}

function resolutionNote(r: Resolution, machineName: string): { tone: "green" | "neutral"; body: ReactNode } {
  if (r.via === "phone") {
    const verb = /^allow/i.test(r.choice ?? "") ? "Allowed" : /^deny/i.test(r.choice ?? "") ? "Denied" : `Answered “${r.choice ?? "?"}”`;
    return {
      tone: "green",
      body: (
        <T size={13} color={t.dim} style={{ lineHeight: 19 }}>
          {"✓ "}
          {verb} {r.text ? <M>{r.text}</M> : null} from this phone · {formatHM(r.at)}
        </T>
      ),
    };
  }
  if (r.via === "timeout") return { tone: "neutral", body: `Timed out → asked on ${machineName}.` };
  if (r.via === "terminal") return { tone: "neutral", body: `Answered on ${machineName} before you did.` };
  return { tone: "neutral", body: "Answered elsewhere before you did." };
}

export default function AgentDetailScreen() {
  const { params } = useRoute<RouteProp<{ AgentDetail: AgentDetailParams }, "AgentDetail">>();
  const nav = useNavigation<Nav>();
  const { actions, presence, rt, phoneOffline } = usePorter();
  const state = usePorterState();
  const now = useTick(1000);
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const machine = state.machines[params.machine];
  const agent: Agent | undefined = machine?.agents[params.agent];
  const backLabel = params.from ?? "Agents";
  const back = () => (nav.canGoBack() ? nav.goBack() : nav.navigate("AgentsList"));

  if (!machine || !agent) {
    return (
      <Screen>
        <BackHeader label={backLabel} onBack={back} />
        <Empty title="Agent gone" hint="Its machine no longer reports it." />
      </Screen>
    );
  }

  const name = machine.name ?? machine.machineId.slice(0, 10);
  const live = machineLiveness(machine, presence, now);
  const parent = agent.parent ? machine.agents[agent.parent] : undefined;
  const isSub = !!agent.parent;
  const children = Object.values(machine.agents).filter((a) => a.parent === agent.id && subagentVisible(a));
  const approver = machine.subscribed?.approver === true;
  const d = liveDurations(agent, now);
  const question = agent.status === "needs_you" ? questionForAgent(state.inbox, machine.machineId, machine.name, agent.id, now) : undefined;
  const resolution = agent.status === "running" ? lastResolution(state.inbox, machine.machineId, machine.name, agent, rt?.node.machineId) : undefined;
  const recentResolution = resolution && now - resolution.at < RECENT_MS && resolution.at >= Date.parse(agent.status_since ?? "") - 5000 ? resolution : undefined;
  const recap = recapLines(agent);

  const toggleStar = async () => {
    if (!approver) {
      toast.show("Only an approver of this machine can star agents");
      return;
    }
    setBusy(true);
    try {
      await actions.setSpecial(machine.machineId, agent.id, !agent.special);
      toast.show(agent.special ? "Unstar sent" : "Star sent");
    } catch (e) {
      toast.show(`Failed: ${e instanceof Error ? e.message : String(e)}`, 3000);
    } finally {
      setBusy(false);
    }
  };

  const answer = async (choice: string) => {
    if (!question) return;
    setBusy(true);
    try {
      await actions.answer(question, choice);
    } catch (e) {
      toast.show(`Couldn't send: ${e instanceof Error ? e.message : String(e)}`, 3000);
    } finally {
      setBusy(false);
    }
  };

  // ---- status line ------------------------------------------------------------
  const ended = agent.status === "ended";
  const stale = !live.online && (agent.status === "needs_you" || agent.status === "running");
  const statusText = ended ? `ended · ${agent.end_reason ?? "closed"}` : agent.status === "needs_you" && agent.needs?.kind !== "permission" ? "has a question" : agent.status === "error" ? errorLine(agent) : statusLabel(agent, now);
  const clock = ended
    ? agent.ended_at
      ? `${new Date(agent.ended_at).toDateString() === new Date(now).toDateString() ? "today" : new Date(agent.ended_at).toLocaleDateString()} ${formatHM(agent.ended_at)}`
      : ""
    : stale
      ? "last known"
      : agent.status === "done"
        ? `stopped ${formatShort(d.inStatusMs)} ago`
        : formatClock(d.inStatusMs);

  // ---- body by state ----------------------------------------------------------------
  const need = agent.status === "needs_you" ? describeNeed(agent.needs?.text, stale) : undefined;
  const isPermission = agent.needs?.kind === "permission";

  const header = (
    <BackHeader
      label={isSub && parent ? parent.title || parent.id.slice(0, 8) : backLabel}
      mono={isSub && !!parent}
      onBack={isSub && parent ? () => nav.push("AgentDetail", { machine: machine.machineId, agent: parent.id, from: backLabel }) : back}
      right={
        isSub || ended ? undefined : (
          <Pressable onPress={toggleStar} disabled={busy} accessibilityLabel={`Special: ${agent.special ? "on" : "off"}`} accessibilityState={{ selected: !!agent.special }} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center", opacity: approver ? 1 : 0.5 }}>
            <Ionicons name={agent.special ? "star" : "star-outline"} size={22} color={agent.special ? t.accent : "rgba(255,255,255,0.55)"} />
          </Pressable>
        )
      }
    />
  );

  let bottom: ReactNode = null;
  if (agent.status === "needs_you" && !isSub) {
    if (isPermission && (question || stale)) {
      const exp = question?.notify.expires_at ? Date.parse(question.notify.expires_at) : 0;
      const left = exp ? Math.max(0, exp - now) : 0;
      const choices = question?.notify.ask ?? ["Deny", "Allow"];
      const deny = choices.find((c) => /deny|no|reject/i.test(c)) ?? choices[choices.length - 1];
      const allow = choices.find((c) => c !== deny) ?? choices[0];
      const disabled = !live.online || phoneOffline || busy || !question || question.answer?.state === "sending";
      bottom = (
        <BottomBar
          note={
            !live.online
              ? `Can't reach ${name} — buttons come back when it does`
              : phoneOffline
                ? "No connection — buttons come back when it does"
              : question?.answer?.state === "failed"
                ? `Couldn't send: ${question.answer.error ?? "error"} — try again`
                : exp
                  ? `No answer in ${formatClock(left)} → asks on ${name} instead`
                  : undefined
          }
        >
          <ButtonPair>
            <BigButton kind="secondary" label={deny} disabled={disabled} onPress={() => answer(deny)} />
            <BigButton label={allow} disabled={disabled} onPress={() => answer(allow)} />
          </ButtonPair>
        </BottomBar>
      );
    } else if (live.online) {
      bottom = (
        <BottomBar>
          <View style={{ minHeight: 52, borderRadius: 12, backgroundColor: t.fill, alignItems: "center", justifyContent: "center" }}>
            <T size={15} color={t.dim}>
              Answer it on <M color={t.text}>{name}</M>
            </T>
          </View>
        </BottomBar>
      );
    }
  }

  const note = resolutionNote;

  return (
    <Screen>
      {header}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, gap: 20, paddingTop: 4, paddingHorizontal: 20, paddingBottom: 16 }}>
        <View style={{ gap: 8 }}>
          <T mono size={24} weight="600">{isSub ? agent.agent_type || agent.title || agent.id.slice(0, 8) : agent.title || agent.id.slice(0, 8)}</T>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
            <StatusDot status={ended ? "ended" : displayStatus(agent, now)} />
            <T color={ended || displayStatus(agent, now) === "inactive" ? t.dim : statusColor(displayStatus(agent, now))}>{statusText}</T>
            <T mono color={t.faint}>{clock}</T>
          </View>
          {isSub && parent ? (
            <T size={13} color={t.dim} onPress={() => nav.push("AgentDetail", { machine: machine.machineId, agent: parent.id, from: backLabel })}>
              subagent of <M color={t.accent}>{parent.title || parent.id.slice(0, 8)}</M>
            </T>
          ) : null}
        </View>

        {stale && agent.status === "needs_you" ? (
          <Note tone="orange">
            <T size={13} color={t.dim} style={{ lineHeight: 19 }}>
              <T size={13}>{name} is offline</T>
              {live.seenAt ? ` · seen ${formatHM(live.seenAt)}` : ""}. This is the last known state; it may already be answered.
            </T>
          </Note>
        ) : null}
        {stale && agent.status === "running" ? (
          <Note>{`${name} is offline${live.seenAt ? ` · seen ${formatHM(live.seenAt)}` : ""}. This is the last known state.`}</Note>
        ) : null}

        {recentResolution ? (() => {
          const n = note(recentResolution, name);
          return <Note tone={n.tone}>{n.body}</Note>;
        })() : null}

        {need ? (
          isPermission ? (
            <Section label={need.verb}>
              <T mono size={19} style={{ lineHeight: 26 }} selectable>
                {need.text}
              </T>
              {agent.summary ? <T size={13} color={t.dim}>{agent.summary}</T> : null}
            </Section>
          ) : (
            <Section label="Asks">
              <T size={18} weight="500" style={{ lineHeight: 24 }} selectable>
                “{agent.needs?.text || "Waiting for your input"}”
              </T>
            </Section>
          )
        ) : agent.summary ? (
          <Section label={agent.status === "done" || ended ? "Last result" : "Doing now"}>
            <T size={18} weight="500" style={{ lineHeight: 24 }} selectable>
              {agent.summary}
            </T>
          </Section>
        ) : null}

        {isSub ? (
          <Note>
            <T size={13} color={t.dim} style={{ lineHeight: 19 }}>
              Subagents follow their parent: the star and pushes are set on <M>{parent?.title || "the parent"}</M>.
            </T>
          </Note>
        ) : null}

        {children.length ? (
          <View style={{ gap: 8 }}>
            <T size={12} color={t.faint}>Subagents</T>
            {children.map((c) => (
              <Pressable key={c.id} onPress={() => nav.push("AgentDetail", { machine: machine.machineId, agent: c.id, from: backLabel })} style={{ flexDirection: "row", alignItems: "center", gap: 8, opacity: c.status === "done" ? 0.6 : 1, minHeight: 28 }}>
                <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: statusColor(displayStatus(c, now)) }} />
                <T mono>{c.agent_type || c.title || c.id.slice(0, 8)}</T>
                <T color={t.dim} lines={1} style={{ flex: 1 }}>
                  · {c.status === "done" ? "done" : c.status === "needs_you" ? c.needs?.text || "needs you" : c.summary || c.status}
                </T>
                <T mono size={12} color={t.faint}>
                  {formatClock(c.status === "done" ? liveDurations(c, now).runningMs : liveDurations(c, now).inStatusMs)}
                </T>
              </Pressable>
            ))}
          </View>
        ) : null}

        {!isSub && !(stale && agent.status === "needs_you") ? <Recap lines={recap} /> : null}

        {agent.status === "done" ? <Note>{`Still open on ${name}. It moves to the Graveyard when closed, or after 24h of silence.`}</Note> : null}

        <View style={{ flex: 1 }} />
        <View style={{ gap: 4 }}>
          <T mono size={12} color={t.faint}>
            {[isSub ? agent.harness ?? parent?.harness : agent.harness, name, agent.project].filter(Boolean).join(" · ")}
          </T>
          <T size={12} color={t.faint}>
            {ended
              ? `Lived ${formatShort(lifetimeMs(agent))} · ran ${formatShort(d.runningMs)} · waited on you ${formatShort(d.waitingMs)} · removed after 7 days`
              : isSub
                ? agent.started_at
                  ? `Started ${formatHM(agent.started_at)}`
                  : ""
                : [agent.started_at ? `Started ${formatHM(agent.started_at)}` : "", agent.status !== "running" || d.runningMs > 60_000 ? `ran ${formatShort(d.runningMs)}` : "", `waited on you ${formatShort(d.waitingMs)}`].filter(Boolean).join(" · ")}
          </T>
        </View>
      </ScrollView>
      {bottom}
    </Screen>
  );
}

