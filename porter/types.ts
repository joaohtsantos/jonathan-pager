// Porter contract v1 (~/fun/comms docs/PORTER.md). Bodies of ordinary comms
// messages; sender identity always comes from comms auth, never from a body.

export const PORTER_ALIAS = "porter";
export const TOPICS = ["agents", "status", "trusts"] as const;
export type Topic = (typeof TOPICS)[number];

export type AgentStatus = "running" | "needs_you" | "done" | "ended";

export interface Agent {
  id: string;
  harness?: string;
  parent?: string;
  agent_type?: string;
  title?: string;
  project?: string;
  identity?: { alias?: string; address?: string; persistent?: boolean };
  status: AgentStatus;
  needs?: { kind: "permission" | "input" | string; text?: string };
  summary?: string;
  special?: boolean;
  started_at?: string;
  last_active_at?: string;
  status_since?: string;
  running_ms?: number;
  waiting_ms?: number;
  ended_at?: string;
  end_reason?: "closed" | "stale" | string;
}

export interface MachineStatus {
  host?: string;
  os?: string;
  uptime_s?: number;
  load?: number;
  mem_pct?: number;
  disk_pct?: number;
  temp_c?: number;
  battery_pct?: number;
  comms_version?: string;
  agents_running?: number;
  at?: string;
}

export interface Trust {
  id: string;
  receiver: string;
  sender: string;
  sender_id?: string;
  scope: "session" | "always" | string;
  approved_at?: string;
}

export interface Notify {
  type?: "porter.notify";
  v?: number;
  id: string;
  kind?: "message" | "permission" | "trust" | string;
  title: string;
  body?: string;
  reason?: string;
  priority?: "normal" | "high" | string;
  ask?: string[];
  expires_at?: string;
  link?: string;
  context?: { machine?: string; agent?: string; harness?: string; session?: string; title?: string; project?: string };
  trust?: { receiver?: string; sender?: string };
  sent_at?: string;
}

export interface Subscribed {
  type: "porter.subscribed";
  machine?: string;
  topics?: string[];
  refused?: string[];
  approver?: boolean;
  push?: boolean;
  porter_version?: string;
}

/** Incoming porter bodies (v1, plus the pre-v1 shapes porter-comms emitted). */
export type PorterInbound =
  | Subscribed
  | { type: "porter.snapshot"; machine?: string; topic?: Topic; items?: Agent[]; value?: unknown; truncated?: boolean; agents?: Agent[] }
  | { type: "porter.update"; machine?: string; topic: Topic; item?: unknown; value?: unknown }
  | { type: "porter.agent"; machine?: string; agent: Agent }
  | { type: "porter.remove"; machine?: string; topic?: Topic; id: string }
  | ({ type: "porter.notify" } & Notify)
  | { type: "porter.cancel"; id: string; resolution?: string };

/** Plaintext of an encrypted push. Pre-v1 pushes had no `kind` (agent). */
export type PushPlain =
  | { kind: "agent"; machine?: string; agent: string; title?: string; status: AgentStatus; needs?: Agent["needs"]; summary?: string }
  | { kind: "notify"; notify: Notify }
  | { kind: "wake"; id?: string };
