import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { API_BASE_URL, API_KEY } from "../constants";
import { colors, fonts, spacing } from "../theme";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type AgentStatus = "online" | "busy" | "idle" | "offline";

interface Agent {
  id: string;
  name: string;
  status: AgentStatus;
  task?: string | null;
  last_seen?: string | null;
}

interface Comm {
  id: string;
  from: string;
  to?: string | null;
  channel?: string | null;
  message: string;
  created_at: string;
}

interface PagerRequest {
  id: string;
  type: string;
  email_subject: string;
  email_sender: string;
  summary: string;
  proposed_action: string;
  priority: "low" | "medium" | "high";
  status: string;
  created_at: string;
}

// "ok" = data loaded · "empty" = reachable but nothing / route absent · "error" = fetch failed
type FetchState = "ok" | "empty" | "error";

type Tab = "agents" | "comms" | "pipeline";

const TABS: { key: Tab; label: string; icon: keyof typeof Feather.glyphMap }[] = [
  { key: "agents", label: "AGENTS", icon: "cpu" },
  { key: "comms", label: "COMMS", icon: "radio" },
  { key: "pipeline", label: "PIPELINE", icon: "check-square" },
];

const STATUS_CONFIG: Record<AgentStatus, { color: string; label: string }> = {
  online: { color: colors.accent, label: "ONLINE" },
  busy: { color: colors.alert, label: "BUSY" },
  idle: { color: colors.textDim, label: "IDLE" },
  offline: { color: colors.textFaint, label: "OFFLINE" },
};

const PRIORITY_CONFIG: Record<
  PagerRequest["priority"],
  { color: string; label: string }
> = {
  high: { color: colors.urgent, label: "HIGH" },
  medium: { color: colors.alert, label: "MED" },
  low: { color: colors.info, label: "LOW" },
};

const headers = {
  Authorization: `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
};

const POLL_MS = 60_000;

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatClock(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function relative(iso?: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

/**
 * Resilient GET. Agent/comms routes may not exist on the backend yet, so a 404
 * (or any non-ok) is treated as "empty" rather than a hard error; only network
 * failures surface as "error". Returns parsed data when available.
 */
async function tryFetch<T>(
  path: string
): Promise<{ state: FetchState; data: T[] }> {
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, { headers });
    if (!res.ok) return { state: "empty", data: [] };
    const json = await res.json();
    const data: T[] = Array.isArray(json)
      ? json
      : Array.isArray((json as any)?.items)
        ? (json as any).items
        : [];
    return { state: data.length > 0 ? "ok" : "empty", data };
  } catch {
    return { state: "error", data: [] };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Screen
// ─────────────────────────────────────────────────────────────────────────────

export default function AgentMonitorScreen() {
  const [tab, setTab] = useState<Tab>("agents");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [clock, setClock] = useState<string>(() => formatClock(new Date()));

  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentsState, setAgentsState] = useState<FetchState>("empty");

  const [comms, setComms] = useState<Comm[]>([]);
  const [commsState, setCommsState] = useState<FetchState>("empty");

  const [requests, setRequests] = useState<PagerRequest[]>([]);
  const [actioning, setActioning] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editingIds, setEditingIds] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Record<string, string>>({});

  // ── data ──────────────────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    const [a, c] = await Promise.all([
      tryFetch<Agent>("/agents"),
      tryFetch<Comm>("/agent-comms"),
    ]);
    setAgents(a.data);
    setAgentsState(a.state);
    setComms(
      [...c.data].sort(
        (x, y) =>
          new Date(y.created_at).getTime() - new Date(x.created_at).getTime()
      )
    );
    setCommsState(c.state);

    // Pipeline uses the existing, known-good requests endpoint.
    try {
      const res = await fetch(`${API_BASE_URL}/requests?status=pending`, {
        headers,
      });
      if (res.ok) setRequests(await res.json());
    } catch (e) {
      console.error("Failed to fetch requests:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") fetchAll();
    });
    return () => sub.remove();
  }, [fetchAll]);

  useEffect(() => {
    const interval = setInterval(fetchAll, POLL_MS);
    return () => clearInterval(interval);
  }, [fetchAll]);

  useEffect(() => {
    const tick = () => setClock(formatClock(new Date()));
    const interval = setInterval(tick, 30_000);
    return () => clearInterval(interval);
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchAll();
  }, [fetchAll]);

  // ── pipeline interactions (preserved from the Requests screen) ─────────────
  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleEditing = (id: string, original: string) => {
    setEditingIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        setEdits((prevEdits) =>
          prevEdits[id] === undefined ? { ...prevEdits, [id]: original } : prevEdits
        );
      }
      return next;
    });
  };

  const resetEdit = (id: string, original: string) => {
    setEdits((prev) => ({ ...prev, [id]: original }));
  };

  const handleAction = async (id: string, status: "approved" | "rejected") => {
    setActioning((prev) => new Set(prev).add(id));
    const original = requests.find((r) => r.id === id)?.proposed_action ?? "";
    const edited = edits[id];
    const sendEdit =
      status === "approved" &&
      typeof edited === "string" &&
      edited.trim().length > 0 &&
      edited !== original;
    try {
      const res = await fetch(`${API_BASE_URL}/requests/${id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify(
          sendEdit ? { status, proposed_action: edited } : { status }
        ),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRequests((prev) => prev.filter((r) => r.id !== id));
    } catch (e) {
      console.error(`Failed to ${status} request:`, e);
    } finally {
      setActioning((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  // ── derived header status line ─────────────────────────────────────────────
  const onlineCount = agents.filter((a) => a.status !== "offline").length;
  const statusLine =
    tab === "agents"
      ? `${onlineCount}/${agents.length} LIVE`
      : tab === "comms"
        ? `${comms.length} MSGS`
        : `${requests.length} PENDING`;

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.textFaint} size="large" />
      </View>
    );
  }

  const refreshControl = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor={colors.textFaint}
      colors={[colors.textFaint]}
    />
  );

  return (
    <View style={styles.container}>
      {/* HEADER */}
      <View style={styles.header}>
        <View style={styles.headerLeftBar} />
        <View style={styles.headerInner}>
          <Text style={styles.headerTitle}>AGENT MONITOR</Text>
          <View style={styles.headerDivider} />
          <Text style={styles.headerStatusLine}>
            {clock} <Text style={styles.dim}>·</Text> {statusLine}{" "}
            <Text style={styles.dim}>·</Text> POLL 60s
          </Text>
        </View>
      </View>

      {/* SEGMENTED TABS */}
      <View style={styles.tabBar}>
        {TABS.map((t) => {
          const active = tab === t.key;
          const count =
            t.key === "agents"
              ? agents.length
              : t.key === "comms"
                ? comms.length
                : requests.length;
          return (
            <Pressable
              key={t.key}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => setTab(t.key)}
            >
              <Feather
                name={t.icon}
                size={12}
                color={active ? colors.accent : colors.textFaint}
              />
              <Text style={[styles.tabText, active && styles.tabTextActive]}>
                {t.label}
              </Text>
              {count > 0 ? (
                <Text style={[styles.tabCount, active && styles.tabTextActive]}>
                  {count}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      {/* ── AGENTS ─────────────────────────────────────────────────────────── */}
      {tab === "agents" ? (
        <FlatList
          data={agents}
          keyExtractor={(item) => item.id}
          contentContainerStyle={
            agents.length === 0 ? styles.listEmpty : styles.list
          }
          refreshControl={refreshControl}
          ListEmptyComponent={
            <EmptyState
              state={agentsState}
              icon="cpu"
              emptyText="NO AGENTS REPORTING"
              hint="agent telemetry not yet wired up"
            />
          }
          renderItem={({ item }) => {
            const cfg = STATUS_CONFIG[item.status] ?? STATUS_CONFIG.offline;
            return (
              <View style={[styles.card, { borderLeftColor: cfg.color }]}>
                <View style={styles.cardTopRow}>
                  <View style={[styles.statusDot, { backgroundColor: cfg.color }]} />
                  <Text style={styles.agentName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <View style={styles.flexFill} />
                  <Text style={[styles.statusLabel, { color: cfg.color }]}>
                    {cfg.label}
                  </Text>
                </View>
                {item.task ? (
                  <Text style={styles.agentTask} numberOfLines={2}>
                    <Text style={styles.senderLabel}>TASK  </Text>
                    {item.task}
                  </Text>
                ) : null}
                <Text style={styles.agentMeta}>
                  last seen {relative(item.last_seen)}
                </Text>
              </View>
            );
          }}
        />
      ) : null}

      {/* ── COMMS (timeline) ───────────────────────────────────────────────── */}
      {tab === "comms" ? (
        comms.length === 0 ? (
          <ScrollView
            contentContainerStyle={styles.listEmpty}
            refreshControl={refreshControl}
          >
            <EmptyState
              state={commsState}
              icon="radio"
              emptyText="NO COMMS YET"
              hint="inter-agent messages will stream here"
            />
          </ScrollView>
        ) : (
          <FlatList
            data={comms}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            refreshControl={refreshControl}
            renderItem={({ item, index }) => (
              <View style={styles.commRow}>
                {/* rail */}
                <View style={styles.commRail}>
                  <View style={styles.commDot} />
                  {index < comms.length - 1 ? (
                    <View style={styles.commLine} />
                  ) : null}
                </View>
                {/* card */}
                <View style={styles.commCard}>
                  <View style={styles.commHeaderRow}>
                    <Text style={styles.commFrom} numberOfLines={1}>
                      {item.from}
                      {item.to ? (
                        <Text style={styles.commArrow}>{`  →  ${item.to}`}</Text>
                      ) : null}
                    </Text>
                    <Text style={styles.commTime}>{formatDate(item.created_at)}</Text>
                  </View>
                  {item.channel ? (
                    <Text style={styles.commChannel}>#{item.channel}</Text>
                  ) : null}
                  <Text style={styles.commMessage}>{item.message}</Text>
                </View>
              </View>
            )}
          />
        )
      ) : null}

      {/* ── PIPELINE (permission requests) ─────────────────────────────────── */}
      {tab === "pipeline" ? (
        <FlatList
          data={requests}
          keyExtractor={(item) => item.id}
          contentContainerStyle={
            requests.length === 0 ? styles.listEmpty : styles.list
          }
          refreshControl={refreshControl}
          ListEmptyComponent={
            <EmptyState
              state="empty"
              icon="inbox"
              emptyText="NO PENDING REQUESTS"
              hint="pull down to sync"
            />
          }
          renderItem={({ item }) => {
            const priority = PRIORITY_CONFIG[item.priority] ?? PRIORITY_CONFIG.low;
            const isActioning = actioning.has(item.id);
            const isExpanded = expanded.has(item.id);
            return (
              <View style={[styles.card, { borderLeftColor: priority.color }]}>
                <View style={styles.cardTopRow}>
                  <View style={[styles.badge, { backgroundColor: priority.color }]}>
                    <Text style={styles.badgeText}>{priority.label}</Text>
                  </View>
                  <Text style={styles.cardDashes} numberOfLines={1}>
                    {"────────────────────"}
                  </Text>
                  <Text style={styles.cardTime}>{formatDate(item.created_at)}</Text>
                </View>

                <Pressable onPress={() => toggleExpanded(item.id)}>
                  <Text style={styles.subject} numberOfLines={isExpanded ? undefined : 2}>
                    {item.email_subject}
                  </Text>
                  <Text style={styles.sender} numberOfLines={isExpanded ? undefined : 1}>
                    <Text style={styles.senderLabel}>FROM  </Text>
                    {item.email_sender}
                  </Text>

                  {item.summary ? (
                    <>
                      <View style={styles.innerDivider} />
                      <Text
                        style={styles.summaryText}
                        numberOfLines={isExpanded ? undefined : 4}
                      >
                        {item.summary}
                      </Text>
                    </>
                  ) : null}

                  {item.proposed_action ? (
                    <View style={styles.proposedBlock}>
                      <View style={styles.proposedHeaderRow}>
                        <Text style={styles.proposedLabel}>
                          {">  PROPOSED"}
                          {edits[item.id] !== undefined &&
                          edits[item.id] !== item.proposed_action ? (
                            <Text style={styles.editedTag}>  [edited]</Text>
                          ) : null}
                        </Text>
                        <View style={styles.proposedActions}>
                          {editingIds.has(item.id) &&
                          edits[item.id] !== undefined &&
                          edits[item.id] !== item.proposed_action ? (
                            <Pressable
                              onPress={() => resetEdit(item.id, item.proposed_action)}
                              hitSlop={8}
                            >
                              <View style={styles.miniBtn}>
                                <Feather name="rotate-ccw" size={11} color={colors.textFaint} />
                                <Text style={styles.miniBtnText}>RESET</Text>
                              </View>
                            </Pressable>
                          ) : null}
                          <Pressable
                            onPress={() => toggleEditing(item.id, item.proposed_action)}
                            hitSlop={8}
                          >
                            <View style={styles.miniBtn}>
                              <Feather
                                name={editingIds.has(item.id) ? "check" : "edit-2"}
                                size={11}
                                color={colors.accent}
                              />
                              <Text style={[styles.miniBtnText, { color: colors.accent }]}>
                                {editingIds.has(item.id) ? "DONE" : "EDIT"}
                              </Text>
                            </View>
                          </Pressable>
                        </View>
                      </View>
                      {editingIds.has(item.id) ? (
                        <TextInput
                          style={[styles.proposedText, styles.proposedInput]}
                          value={edits[item.id] ?? item.proposed_action}
                          onChangeText={(t) =>
                            setEdits((prev) => ({ ...prev, [item.id]: t }))
                          }
                          multiline
                          autoFocus
                          selectionColor={colors.accent}
                        />
                      ) : (
                        <Text
                          style={styles.proposedText}
                          numberOfLines={isExpanded ? undefined : 3}
                        >
                          {edits[item.id] ?? item.proposed_action}
                        </Text>
                      )}
                    </View>
                  ) : null}

                  <View style={styles.expandHintRow}>
                    <Feather
                      name={isExpanded ? "chevron-up" : "chevron-down"}
                      size={12}
                      color={colors.textFaint}
                    />
                    <Text style={styles.expandHintText}>
                      {isExpanded ? "LESS" : "MORE"}
                    </Text>
                  </View>
                </Pressable>

                <View style={styles.buttons}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.btn,
                      styles.approveBtn,
                      pressed && styles.btnPressed,
                    ]}
                    onPress={() => handleAction(item.id, "approved")}
                    disabled={isActioning}
                  >
                    <Text style={styles.approveBtnText}>
                      {isActioning ? "[ ... ]" : "[  ✓  APPROVE  ]"}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [
                      styles.btn,
                      styles.rejectBtn,
                      pressed && styles.btnPressed,
                    ]}
                    onPress={() => handleAction(item.id, "rejected")}
                    disabled={isActioning}
                  >
                    <Text style={styles.rejectBtnText}>
                      {isActioning ? "[ ... ]" : "[  ✕  REJECT  ]"}
                    </Text>
                  </Pressable>
                </View>
              </View>
            );
          }}
        />
      ) : null}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Empty / error state
// ─────────────────────────────────────────────────────────────────────────────

function EmptyState({
  state,
  icon,
  emptyText,
  hint,
}: {
  state: FetchState;
  icon: keyof typeof Feather.glyphMap;
  emptyText: string;
  hint: string;
}) {
  const isError = state === "error";
  return (
    <View style={styles.empty}>
      <Feather
        name={isError ? "wifi-off" : icon}
        size={42}
        color={colors.textFaint}
      />
      <Text style={styles.emptyText}>
        {isError ? "CONNECTION ERROR" : emptyText}
      </Text>
      <Text style={styles.emptyHint}>
        {isError ? "could not reach the pager backend" : hint}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  dim: { color: colors.textFaint },
  flexFill: { flex: 1 },

  // HEADER
  header: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    paddingTop: 56,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerLeftBar: {
    width: 3,
    backgroundColor: colors.accent,
    marginRight: spacing.md,
    alignSelf: "stretch",
  },
  headerInner: { flex: 1 },
  headerTitle: {
    color: colors.text,
    fontFamily: fonts.mono,
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: 4,
  },
  headerDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.sm,
  },
  headerStatusLine: {
    color: colors.textDim,
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 0.5,
  },

  // TABS
  tabBar: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabActive: {
    borderBottomColor: colors.accent,
    backgroundColor: colors.bg,
  },
  tabText: {
    color: colors.textFaint,
    fontFamily: fonts.mono,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.5,
  },
  tabTextActive: { color: colors.accent },
  tabCount: {
    color: colors.textFaint,
    fontFamily: fonts.mono,
    fontSize: 10,
    fontWeight: "700",
  },

  // EMPTY
  listEmpty: { flexGrow: 1 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyText: {
    color: colors.textFaint,
    fontFamily: fonts.mono,
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 2,
    marginTop: spacing.md,
    textAlign: "center",
  },
  emptyHint: {
    color: colors.textFaint,
    fontFamily: fonts.mono,
    fontSize: 11,
    marginTop: spacing.sm,
    letterSpacing: 0.5,
    textAlign: "center",
  },

  // LIST + CARDS (shared)
  list: { padding: spacing.md },
  card: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderLeftWidth: 3,
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderTopColor: colors.border,
    borderRightColor: colors.border,
    borderBottomColor: colors.border,
  },
  cardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.sm,
  },

  // AGENTS
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: spacing.sm },
  agentName: {
    color: colors.text,
    fontFamily: fonts.mono,
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 1,
  },
  statusLabel: {
    fontFamily: fonts.mono,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.5,
  },
  agentTask: {
    color: colors.textDim,
    fontFamily: fonts.mono,
    fontSize: 12,
    lineHeight: 18,
    marginBottom: spacing.xs,
  },
  agentMeta: {
    color: colors.textFaint,
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 0.5,
  },

  // COMMS TIMELINE
  commRow: { flexDirection: "row" },
  commRail: { width: 18, alignItems: "center" },
  commDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    marginTop: 6,
    backgroundColor: colors.accent,
  },
  commLine: {
    flex: 1,
    width: 1,
    backgroundColor: colors.border,
    marginTop: 2,
  },
  commCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
    marginLeft: spacing.sm,
  },
  commHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.xs,
  },
  commFrom: {
    flex: 1,
    color: colors.text,
    fontFamily: fonts.mono,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  commArrow: { color: colors.textDim, fontWeight: "400" },
  commTime: {
    color: colors.textFaint,
    fontFamily: fonts.mono,
    fontSize: 10,
    marginLeft: spacing.sm,
  },
  commChannel: {
    color: colors.accent,
    fontFamily: fonts.mono,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
    marginBottom: spacing.xs,
  },
  commMessage: {
    color: colors.textDim,
    fontFamily: fonts.mono,
    fontSize: 12,
    lineHeight: 18,
  },

  // PIPELINE (preserved from Requests)
  badge: { paddingVertical: 2, paddingHorizontal: spacing.sm },
  badgeText: {
    color: "#FFFFFF",
    fontFamily: fonts.mono,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
  },
  cardDashes: {
    color: colors.border,
    fontFamily: fonts.mono,
    fontSize: 11,
    marginHorizontal: spacing.sm,
    flex: 1,
    overflow: "hidden",
  },
  cardTime: {
    color: colors.textFaint,
    fontFamily: fonts.mono,
    fontSize: 11,
  },
  subject: {
    color: colors.text,
    fontFamily: fonts.mono,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
    marginBottom: spacing.xs,
  },
  sender: {
    color: colors.textDim,
    fontFamily: fonts.mono,
    fontSize: 11,
    marginBottom: spacing.xs,
  },
  senderLabel: {
    color: colors.textFaint,
    fontWeight: "700",
    letterSpacing: 1,
  },
  innerDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.sm,
  },
  summaryText: {
    color: colors.textDim,
    fontFamily: fonts.mono,
    fontSize: 12,
    lineHeight: 18,
  },
  proposedBlock: {
    marginTop: spacing.md,
    paddingLeft: spacing.sm,
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
  },
  proposedHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.xs,
  },
  proposedActions: { flexDirection: "row", gap: spacing.sm },
  miniBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: colors.borderBright,
  },
  miniBtnText: {
    color: colors.textFaint,
    fontFamily: fonts.mono,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.5,
  },
  editedTag: {
    color: colors.textFaint,
    fontFamily: fonts.mono,
    fontSize: 9,
    fontWeight: "400",
    letterSpacing: 1,
  },
  proposedLabel: {
    color: colors.accent,
    fontFamily: fonts.mono,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.5,
  },
  proposedText: {
    color: colors.text,
    fontFamily: fonts.mono,
    fontSize: 12,
    lineHeight: 18,
  },
  proposedInput: { padding: 0, marginTop: 2, textAlignVertical: "top" },
  expandHintRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    marginTop: spacing.sm,
    paddingVertical: spacing.xs,
  },
  expandHintText: {
    color: colors.textFaint,
    fontFamily: fonts.mono,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 2,
  },
  buttons: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  btn: {
    flex: 1,
    paddingVertical: spacing.sm + 2,
    alignItems: "center",
    borderWidth: 1,
    backgroundColor: colors.bg,
  },
  btnPressed: { opacity: 0.6 },
  approveBtn: { borderColor: colors.accent },
  rejectBtn: { borderColor: colors.borderBright },
  approveBtnText: {
    color: colors.accent,
    fontFamily: fonts.mono,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.5,
  },
  rejectBtnText: {
    color: colors.textDim,
    fontFamily: fonts.mono,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.5,
  },
});
