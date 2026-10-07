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
