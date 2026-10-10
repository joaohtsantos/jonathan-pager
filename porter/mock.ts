// Dev-only mock data shaped like porter contract v1 (+ the proposed optional
// fields recap / last_decision / draft), so every screen and agent state can be
// viewed without a backend. Toggle: Machines → Settings → Developer.
import type { InboxItem, MachineState, PorterSnapshot } from "./store";
import type { Agent, Notify } from "./types";
import type { Presence } from "./selectors";

export const MOCK_IDS = { mac: "m_mock_personal_mac", pi: "m_mock_pi", work: "m_mock_work_mac" } as const;

export function mockPresence(): Presence {
  return { [MOCK_IDS.mac]: true, [MOCK_IDS.pi]: true, [MOCK_IDS.work]: false };
}

export function mockSnapshot(now = Date.now()): PorterSnapshot {
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const later = (ms: number) => new Date(now + ms).toISOString();
  const S = 1000, M = 60 * S, H = 60 * M, D = 24 * H;

  const agent = (a: Partial<Agent> & { id: string; status: Agent["status"] }): Agent => ({ harness: "claude", ...a });

  const mac: MachineState = {
    machineId: MOCK_IDS.mac,
    name: "personal-mac",
    subscribed: { machine: "personal-mac", topics: ["agents", "status", "trusts"], approver: true, push: true, porter_version: "0.3.0", at: now - 5 * M },
    agentsAt: now - 10 * S,
    status: { host: "personal-mac", os: "macOS 14.6", uptime_s: 3 * 86400 + 4 * 3600, load: 2.14, mem_pct: 64, disk_pct: 71, battery_pct: 82, comms_version: "0.9.2", agents_running: 3, at: ago(20 * S) },
    statusAt: now - 20 * S,
    lastMessageAt: now - 10 * S,
    trusts: {
      tr_m1: { id: "tr_m1", receiver: "personal-mac:pager-refactor", sender: "pi:joana", scope: "session", approved_at: ago(40 * M) },
    },
    agents: Object.fromEntries(
      [
        agent({
          id: "s-pager-refactor", title: "pager-refactor", project: "~/personal/jonathan-pager", status: "needs_you", special: true,
          needs: { kind: "permission", text: "Bash: npm install expo-notifications" }, summary: "Adding push notifications to the Agents tab",
          recap: ["Mapped the current Notifications, Requests and Settings screens", "Added the Agents tab behind a flag; old push list still works", "Decided: pushes come over comms, pager-api keeps location only"],
          started_at: ago(53 * M), status_since: ago(3 * M + 12 * S), running_ms: 41 * M, waiting_ms: 9 * M,
        }),
        agent({
          id: "s-pager-ui", title: "pager-ui", project: "~/notes", status: "running", summary: "Designing the new Pager tabs — agent detail states.",
          recap: ["Built the Agents list and its iterations", "Redrew the app icon as a vector"],
          started_at: ago(20 * M), status_since: ago(12 * M + 5 * S), running_ms: 6 * M,
        }),
        agent({ id: "sub-explore", parent: "s-pager-ui", agent_type: "Explore", status: "running", summary: "Reading LocationScreen.tsx to list the current location features.", started_at: ago(48 * S), status_since: ago(48 * S) }),
        agent({ id: "sub-gp", parent: "s-pager-ui", agent_type: "general-purpose", status: "done", summary: "Summarised the porter contract", started_at: ago(5 * M), status_since: ago(3 * M), running_ms: 2 * M + 10 * S }),
        agent({
          id: "s-comms-release", title: "comms-release", project: "~/fun/comms", status: "running", summary: "Installing the notifications package.",
          last_decision: { choice: "Allow", answered_by: "phone", at: ago(4 * S), text: "npm install expo-notifications" },
          started_at: ago(70 * M), status_since: ago(4 * S), running_ms: 41 * M, waiting_ms: 15 * M,
        }),
        agent({
          id: "s-notes-sync", title: "notes-sync", project: "~/notes", status: "running", summary: "Rebasing the vault onto the Pi copy.",
          last_decision: { choice: "Allow", answered_by: "terminal", at: ago(80 * S), text: "git pull --rebase" },
          started_at: ago(60 * M), status_since: ago(80 * S), running_ms: 42 * M, waiting_ms: 15 * M,
        }),
        agent({
          id: "s-vault-cleanup", title: "vault-cleanup", project: "~/notes", status: "done", summary: "Moved 14 loose notes into projects/ and fixed their backlinks.",
          recap: ["Listed loose notes in the vault root", "Moved them into projects/", "Fixed 31 backlinks"],
          started_at: ago(3 * H), status_since: ago(1 * H), running_ms: 1 * H + 42 * M, waiting_ms: 8 * M,
        }),
        agent({ id: "s-ended-1", title: "comms-docs", project: "~/fun/comms", status: "ended", end_reason: "closed", summary: "Wrote PORTER.md", started_at: ago(2 * D), ended_at: ago(2 * D - 58 * M), running_ms: 48 * M, waiting_ms: 5 * M }),
      ].map((a) => [a.id, a])
    ),
  };

  const pi: MachineState = {
    machineId: MOCK_IDS.pi,
    name: "pi",
    subscribed: { machine: "pi", topics: ["agents", "status", "trusts"], approver: true, push: true, porter_version: "0.3.0", at: now - 5 * M },
    agentsAt: now - 30 * S,
    status: { host: "pi", os: "Debian 12", uptime_s: 18 * 86400, load: 0.42, mem_pct: 48, disk_pct: 91, temp_c: 52.1, comms_version: "0.9.2", agents_running: 1, at: ago(40 * S) },
    statusAt: now - 40 * S,
    lastMessageAt: now - 30 * S,
    trusts: {
      tr_p1: { id: "tr_p1", receiver: "pi:joana", sender: "work-mac:secretary", scope: "always", approved_at: ago(7 * D) },
      tr_p2: { id: "tr_p2", receiver: "pi:joana", sender: "personal-mac:notes", scope: "session", approved_at: ago(50 * M) },
    },
    agents: Object.fromEntries(
      [
        agent({ id: "s-joana", title: "joana", project: "~/joana", identity: { alias: "joana", address: "pi:joana", persistent: true }, status: "running", summary: "Processing inbox capture queue", started_at: ago(3 * H), status_since: ago(2 * H + 4 * M + 51 * S), running_ms: 50 * M }),
        agent({
          id: "s-kb-question", title: "kb-ingestion-retry", project: "~/kayro/kayro-kb", harness: "codex", status: "needs_you",
          needs: { kind: "input", text: "Should I target staging or the local compose?" }, summary: "Retrying last night's failed batch",
          recap: ["Found the failed batch from last night", "Retried 3 of 5 sources successfully"],
          started_at: ago(30 * M), status_since: ago(11 * M + 40 * S), running_ms: 18 * M,
        }),
        agent({ id: "s-spotify", title: "spotify-backup-fix", project: "~/spotify-backup", status: "ended", end_reason: "closed", summary: "Patched the token refresh; tests green.", recap: ["Reproduced the expired-token failure", "Refreshed tokens before each run", "Added a test for the refresh path"], started_at: ago(3 * H), ended_at: ago(2 * H + 20 * M), running_ms: 31 * M + 40 * S }),
        agent({ id: "s-frigate", title: "frigate-zones", project: "~/personal/frigate", status: "ended", end_reason: "closed", started_at: ago(4 * D), ended_at: ago(4 * D - 65 * M), running_ms: 54 * M, waiting_ms: 3 * M + 41 * S }),
      ].map((a) => [a.id, a])
    ),
  };

  const work: MachineState = {
    machineId: MOCK_IDS.work,
    name: "work-mac",
    subscribed: { machine: "work-mac", topics: ["agents", "status"], refused: ["trusts"], approver: false, push: true, porter_version: "0.3.0", at: now - 4 * H },
    agentsAt: now - 3 * H,
    status: { host: "work-mac", os: "macOS 15.0", uptime_s: 6 * 3600, load: 3.8, mem_pct: 77, disk_pct: 58, battery_pct: 41, comms_version: "0.9.1", agents_running: 2, at: ago(3 * H) },
    statusAt: now - 3 * H,
    lastMessageAt: now - 3 * H,
    trusts: {},
    agents: Object.fromEntries(
      [
        agent({
          id: "s-kb-migrate", title: "kb-migrate", project: "~/kayro/kayro-kb", harness: "codex", status: "needs_you",
          needs: { kind: "permission", text: "Bash: psql -f migrations/0042.sql" }, summary: "Applying the schema migration",
          started_at: ago(4 * H), status_since: ago(3 * H + 10 * M), running_ms: 30 * M, waiting_ms: 42 * M,
        }),
        agent({ id: "s-copiloto", title: "copiloto-routing", project: "~/kayro/kayro-web", harness: "cursor", status: "running", summary: "Wiring tool selection into the router", started_at: ago(4 * H), status_since: ago(3 * H + 26 * M), running_ms: 20 * M }),
        agent({ id: "s-kb-schema", title: "kb-schema-notes", project: "~/kayro/kayro-kb", harness: "codex", status: "ended", end_reason: "stale", started_at: ago(2 * D), ended_at: ago(5 * H), running_ms: 2 * H + 5 * M, waiting_ms: 47 * M }),
      ].map((a) => [a.id, a])
    ),
  };

  const n = (fromMachine: string, notify: Notify, receivedAgo: number, extra: Partial<InboxItem> = {}): InboxItem => ({
    id: notify.id,
    fromMachine,
    fromAgent: "a_porter",
    notify: { sent_at: ago(receivedAgo), ...notify },
    receivedAt: now - receivedAgo,
    via: "comms",
    read: false,
    ...extra,
  });

  const inbox: InboxItem[] = [
    n(MOCK_IDS.mac, {
      id: "ntf_perm", kind: "permission", title: "Run npm install expo-notifications", body: "Bash: npm install expo-notifications", reason: "permission prompt",
      priority: "high", ask: ["Allow", "Deny"], expires_at: later(108 * S), link: "agent:personal-mac/s-pager-refactor",
      context: { machine: "personal-mac", agent: "personal-mac:pager-refactor", harness: "claude", session: "s-pager-refactor", title: "pager-refactor", project: "~/personal/jonathan-pager" },
    }, 12 * S),
    n(MOCK_IDS.pi, {
      id: "ntf_trust", kind: "trust", title: "work-mac:secretary wants to give orders", body: "First order from work-mac:secretary to pi:joana: “Add Thursday's class to the calendar.”", reason: "untrusted peer order",
      ask: ["Once", "This session", "Always", "Deny"], expires_at: later(9 * M + 20 * S), trust: { receiver: "pi:joana", sender: "work-mac:secretary" },
      context: { machine: "pi", agent: "pi:joana", harness: "claude", title: "joana", project: "~/joana" },
    }, 40 * S),
    n(MOCK_IDS.pi, {
      id: "ntf_ask", kind: "message", title: "Reply to Sabrina about Thursday?", body: "Sabrina (IB45 tutors) asks if Thursday's 10:00 class can move to 14:00. You're free at 14:00.",
      reason: "you asked to review tutor replies before they go out", ask: ["Send", "Dismiss"], expires_at: later(80 * M),
      draft: "Oi Sabrina! Pode sim, 14h na quinta funciona pra mim. Obrigado!",
      context: { machine: "pi", agent: "pi:joana", harness: "claude", title: "inbox triage", project: "~/joana" },
    }, 2 * M),
    n(MOCK_IDS.pi, {
      id: "ntf_disk", kind: "message", priority: "high", title: "Pi disk at 91%",
      body: "Frigate recordings grew 12 GB since Sunday. At this rate the disk is full in about 4 days. Oldest clips can be pruned with frigate-prune --keep 7d.",
      reason: "disk above 90%", context: { machine: "pi", agent: "pi:joana", harness: "claude", title: "nightly checks", project: "~/joana" },
    }, 20 * M),
    n(MOCK_IDS.mac, {
      id: "ntf_contract", kind: "message", title: "Backend contract v1 ready", body: "Spec in docs/PORTER.md on feat/joao/porter-v2.", reason: "you asked to be told",
      context: { machine: "personal-mac", agent: "personal-mac:pager-refactor", harness: "claude", session: "s-pager-refactor", title: "pager-refactor" },
    }, 32 * M),
    n(MOCK_IDS.pi, {
      id: "ntf_cam", kind: "message", title: "Person at the front door", body: "Front camera · 1 clip", reason: "frigate person event",
      context: { machine: "pi", agent: "pi:frigate", title: "frigate" },
    }, 2 * H + 38 * M, { read: true }),
    n(MOCK_IDS.mac, {
      id: "ntf_done_allow", kind: "permission", title: "Run a command", body: "Bash: npm run typecheck", reason: "permission prompt", ask: ["Allow", "Deny"],
      context: { machine: "personal-mac", agent: "personal-mac:pager-ui", session: "s-pager-ui", title: "pager-ui" },
    }, 4 * H, { read: true, answer: { choice: "Allow", at: now - 4 * H + 30 * S, state: "sent" } }),
    n(MOCK_IDS.work, {
      id: "ntf_done_term", kind: "permission", title: "Edit router.ts", body: "Edit: src/router.ts", reason: "permission prompt", ask: ["Allow", "Deny"],
      context: { machine: "work-mac", agent: "work-mac:copiloto-routing", session: "s-copiloto", title: "copiloto-routing" },
    }, 7 * H, { read: true, cancelled: { resolution: "terminal", at: now - 7 * H + 40 * S } }),
    n(MOCK_IDS.pi, {
      id: "ntf_sleep", kind: "message", title: "Sleep: 7h 12m", body: "Deep 1h 40m · 2 wake-ups", reason: "daily sleep log",
      context: { machine: "pi", agent: "pi:joana", title: "joana" },
    }, 1 * D + 2 * H, { read: true }),
  ];

  return {
    machines: { [mac.machineId]: mac, [pi.machineId]: pi, [work.machineId]: work },
    inbox,
    prefs: { muted: { [`a:${MOCK_IDS.pi}/pi:frigate`]: true }, blocked: {} },
  };
}
