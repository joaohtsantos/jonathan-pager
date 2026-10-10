// Pure view-model helpers for the Agents / Inbox / Machines screens.
import type { InboxItem, MachineState, PorterSnapshot } from "./store";
import { isQuestion, notifySenderAgent } from "./store";
import type { Agent } from "./types";

const STATUS_ORDER: Record<string, number> = { needs_you: 0, running: 1, done: 2, ended: 3 };

const ts = (s?: string) => (s ? Date.parse(s) || 0 : 0);

/** Live running/waiting totals: closed periods + the open one. */
export function liveDurations(a: Agent, now = Date.now()) {
  const open = a.status_since ? Math.max(0, now - ts(a.status_since)) : 0;
  return {
    runningMs: (a.running_ms ?? 0) + (a.status === "running" ? open : 0),
    waitingMs: (a.waiting_ms ?? 0) + (a.status === "needs_you" ? open : 0),
    inStatusMs: open,
  };
}

export function compareAgents(a: Agent, b: Agent): number {
  return (
    (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
    Number(!!b.special) - Number(!!a.special) ||
    ts(b.last_active_at ?? b.status_since) - ts(a.last_active_at ?? a.status_since)
  );
}

export interface AgentNode {
  agent: Agent;
  children: Agent[];
}

/** Non-ended agents, subagents nested under their parent (orphans shown top-level). */
export function agentTree(m: MachineState): AgentNode[] {
  const live = Object.values(m.agents).filter((a) => a.status !== "ended");
  const ids = new Set(live.map((a) => a.id));
  const roots = live.filter((a) => !a.parent || !ids.has(a.parent));
  return roots
    .map((agent) => ({
      agent,
      children: live.filter((c) => c.parent === agent.id).sort(compareAgents),
    }))
    .sort((x, y) => {
      // A parent whose subagent needs you floats with it.
      const rank = (n: AgentNode) => Math.min(STATUS_ORDER[n.agent.status] ?? 9, ...n.children.map((c) => STATUS_ORDER[c.status] ?? 9));
      return rank(x) - rank(y) || compareAgents(x.agent, y.agent);
    });
}

export function machineLabel(m: MachineState | undefined, fallback: string) {
  return m?.name || fallback;
}

export interface MachineGroup {
  machine: MachineState;
  nodes: AgentNode[];
  needsYou: number;
  running: number;
}

export function groupedAgents(s: PorterSnapshot, names: Record<string, string> = {}): MachineGroup[] {
  return Object.values(s.machines)
    .map((machine) => {
      const nodes = agentTree(machine);
      const all = nodes.flatMap((n) => [n.agent, ...n.children]);
      return {
        machine: { ...machine, name: machine.name || names[machine.machineId] },
        nodes,
        needsYou: all.filter((a) => a.status === "needs_you").length,
        running: all.filter((a) => a.status === "running").length,
      };
    })
    .sort((a, b) => b.needsYou - a.needsYou || (a.machine.name ?? "").localeCompare(b.machine.name ?? ""));
}

export function graveyard(s: PorterSnapshot): { machine: MachineState; agent: Agent }[] {
  return Object.values(s.machines)
    .flatMap((machine) => Object.values(machine.agents).filter((a) => a.status === "ended").map((agent) => ({ machine, agent })))
    .sort((x, y) => ts(y.agent.ended_at) - ts(x.agent.ended_at));
}

export function lifetimeMs(a: Agent): number {
  const end = ts(a.ended_at) || Date.now();
  return Math.max(0, end - ts(a.started_at));
}

// ---- inbox -----------------------------------------------------------------

export interface InboxFilter {
  machine?: string;
  agent?: string;
}

export function filterInbox(items: InboxItem[], f: InboxFilter): InboxItem[] {
  return items.filter(
    (i) => (!f.machine || i.fromMachine === f.machine) && (!f.agent || notifySenderAgent(i) === f.agent)
  );
}

/** Open questions first (oldest first, they expire), then the timeline. */
export function splitInbox(items: InboxItem[], now = Date.now()) {
  const questions = items.filter((i) => isQuestion(i, now)).sort((a, b) => a.receivedAt - b.receivedAt);
  const rest = items.filter((i) => !isQuestion(i, now));
  return { questions, rest };
}

export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${String(s % 60).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h${String(m % 60).padStart(2, "0")}m`;
  return `${Math.floor(h / 24)}d${String(h % 24).padStart(2, "0")}h`;
}

export function formatAgo(t: number | string | undefined, now = Date.now()): string {
  const ms = typeof t === "string" ? ts(t) : t ?? 0;
  if (!ms) return "—";
  return formatDuration(Math.max(0, now - ms)) + " ago";
}

// ---- redesign helpers (2026-10) ----------------------------------------------

/** Clock-style duration: 3:12, 12:05, 2:04:51. */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Compact prose duration: 41m, 1h 42m, 3d 4h. */
export function formatShort(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h${min % 60 ? ` ${String(min % 60).padStart(2, "0")}m` : ""}`;
  const d = Math.floor(h / 24);
  return `${d}d${h % 24 ? ` ${h % 24}h` : ""}`;
}

export function formatHM(t: number | string | undefined): string {
  const ms = typeof t === "string" ? ts(t) : t ?? 0;
  if (!ms) return "—";
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function startOfDay(ms: number) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "Today" / "Yesterday" / "Sun 5 Oct". */
export function dayLabel(t: number | string, now = Date.now()): string {
  const ms = typeof t === "string" ? ts(t) : t;
  const diff = Math.round((startOfDay(now) - startOfDay(ms)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  const d = new Date(ms);
  return `${WD[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`;
}

/** Groups items (already sorted) by local day, keeping order. */
export function groupByDay<T>(items: T[], at: (x: T) => number, now = Date.now()): { day: string; items: T[] }[] {
  const out: { day: string; items: T[] }[] = [];
  for (const x of items) {
    const day = dayLabel(at(x), now);
    const last = out[out.length - 1];
    if (last && last.day === day) last.items.push(x);
    else out.push({ day, items: [x] });
  }
  return out;
}

/** machine id → online, from the broker directory (/v1/who). Null: unknown. */
export type Presence = Record<string, boolean>;

const STATUS_FRESH_MS = 3 * 60_000; // STATUS is published every 60 s

export interface MachineLiveness {
  online: boolean;
  /** Last sign of life: the last STATUS `at`, else last porter message. */
  seenAt: number;
}

export function machineLiveness(m: MachineState | undefined, presence: Presence | null, now = Date.now()): MachineLiveness {
  const seenAt = ts(m?.status?.at) || m?.statusAt || m?.lastMessageAt || 0;
  if (m && presence && m.machineId in presence) return { online: presence[m.machineId], seenAt };
  return { online: !!seenAt && now - seenAt < STATUS_FRESH_MS, seenAt };
}

export function livenessText(l: MachineLiveness): string {
  return l.online ? "online" : l.seenAt ? `offline · seen ${formatHM(l.seenAt)}` : "offline";
}

/** Does this notify concern that agent (session id or agent: link)? */
function notifyIsFor(i: InboxItem, machineId: string, machineName: string | undefined, agentId: string): boolean {
  if (i.fromMachine !== machineId) return false;
  if (i.notify.context?.session === agentId) return true;
  const m = /^agent:([^/]+)\/(.+)$/.exec(i.notify.link ?? "");
  return !!m && m[2] === agentId && (!machineName || m[1] === machineName || m[1] === machineId);
}

/** The open question (permission / input) waiting for this agent, if the phone got one. */
export function questionForAgent(inbox: InboxItem[], machineId: string, machineName: string | undefined, agentId: string, now = Date.now()): InboxItem | undefined {
  return inbox.filter((i) => isQuestion(i, now) && notifyIsFor(i, machineId, machineName, agentId)).sort((a, b) => b.receivedAt - a.receivedAt)[0];
}

export interface Resolution {
  choice?: string;
  via: "phone" | "terminal" | "timeout" | "answered" | string;
  at: number;
  text?: string;
}

/**
 * How this agent's last ask was resolved: the agent's `last_decision` (proposed
 * field) when present, else the newest answered / cancelled notify for it.
 */
export function lastResolution(inbox: InboxItem[], machineId: string, machineName: string | undefined, a: Agent, selfId?: string): Resolution | undefined {
  const local = inbox
    .filter((i) => (i.answer?.state === "sent" || i.cancelled) && notifyIsFor(i, machineId, machineName, a.id))
    .sort((x, y) => (y.answer?.at ?? y.cancelled?.at ?? 0) - (x.answer?.at ?? x.cancelled?.at ?? 0))[0];
  const fromLocal: Resolution | undefined = local
    ? local.answer?.state === "sent"
      ? { choice: local.answer.choice, via: "phone", at: local.answer.at, text: local.notify.body || local.notify.title }
      : { via: local.cancelled!.resolution, at: local.cancelled!.at, text: local.notify.body || local.notify.title }
    : undefined;
  const d = a.last_decision;
  const via = d ? decisionVia(d, selfId) : undefined;
  const fromAgent: Resolution | undefined = d ? { choice: d.choice, via: via!, at: ts(d.at), text: d.text ?? fromLocal?.text } : undefined;
  if (fromAgent && (!fromLocal || fromAgent.at >= fromLocal.at)) return fromAgent;
  return fromLocal;
}

/** phone (this phone answered) | timeout | terminal ("Answered on <machine>"). */
export function decisionVia(d: NonNullable<Agent["last_decision"]>, selfId?: string): "phone" | "timeout" | "terminal" {
  const by = d.answered_by ?? d.via;
  if (by === "timeout") return "timeout";
  if (by === "phone" || by === "approver") {
    if (d.approver?.id && selfId) return d.approver.id.split(":")[0] === selfId ? "phone" : "terminal";
    return by === "phone" ? "phone" : "terminal";
  }
  return "terminal";
}

/** "Bash: npm install x" → { verb: "Wants to run", text: "npm install x" }. */
export function describeNeed(text: string | undefined, past = false): { verb: string; text: string; mono: boolean } {
  const raw = (text ?? "").trim();
  const m = /^([A-Za-z][\w.-]*):\s+([\s\S]+)$/.exec(raw);
  if (m && m[1] === "Bash") return { verb: past ? "Wanted to run" : "Wants to run", text: m[2], mono: true };
  if (m) return { verb: `${past ? "Wanted" : "Wants"} to use ${m[1]}`, text: m[2], mono: true };
  return { verb: past ? "Wanted" : "Wants", text: raw || "—", mono: true };
}

export function recapLines(a: Agent): string[] {
  if (!a.recap) return [];
  return (Array.isArray(a.recap) ? a.recap : a.recap.split("\n")).map((s) => s.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);
}

/** Applies the saved machine order (+ optional float of machines that need you). */
export function orderGroups(groups: MachineGroup[], order: string[], float: boolean): MachineGroup[] {
  const idx = (id: string) => {
    const i = order.indexOf(id);
    return i < 0 ? order.length : i;
  };
  const sorted = [...groups].sort((a, b) => idx(a.machine.machineId) - idx(b.machine.machineId) || (a.machine.name ?? "").localeCompare(b.machine.name ?? ""));
  return float ? [...sorted.filter((g) => g.needsYou > 0), ...sorted.filter((g) => g.needsYou === 0)] : sorted;
}

// ---- inbox presentation ----------------------------------------------------------

export type NotifyLook = "permission" | "trust" | "question" | "message" | "camera" | "high" | "answered";

export function notifyLook(i: InboxItem, now = Date.now()): NotifyLook {
  const n = i.notify;
  if (n.ask?.length && !isQuestion(i, now)) return "answered";
  if (n.kind === "permission") return "permission";
  if (n.kind === "trust") return "trust";
  if (n.ask?.length) return "question";
  if (n.priority === "high") return "high";
  const who = `${n.context?.agent ?? ""} ${n.context?.title ?? ""}`;
  if (/frigate|camera|\bcam\b/i.test(who)) return "camera";
  return "message";
}

/** Sender as shown: machine first, then the agent alias. */
export function senderParts(i: InboxItem, machineName: string): { machine: string; agent?: string } {
  const c = i.notify.context;
  const addr = c?.agent;
  if (addr && addr.includes(":")) {
    const [m, ...rest] = addr.split(":");
    return { machine: m || machineName, agent: rest.join(":") };
  }
  return { machine: machineName, agent: addr || c?.title };
}

/** One-line outcome of a resolved question. */
export function resolutionText(i: InboxItem, machineName: string): string | undefined {
  if (i.answer) {
    const verb = /^allow/i.test(i.answer.choice) ? "Allowed" : /^deny/i.test(i.answer.choice) ? "Denied" : `Answered “${i.answer.choice}”`;
    if (i.answer.state === "failed") return `Couldn't send ${i.answer.choice}`;
    if (i.answer.state === "sending") return `Sending ${i.answer.choice}…`;
    return `${verb} from this phone`;
  }
  if (i.cancelled) {
    const r = i.cancelled.resolution;
    if (r === "terminal") return `Answered on ${machineName}`;
    if (r === "timeout") return `Timed out → asked on ${machineName}`;
    if (r === "dismissed") return "Dismissed";
    return "Answered elsewhere";
  }
  if (i.notify.expires_at && Date.parse(i.notify.expires_at) < Date.now()) return "Expired";
  return undefined;
}
