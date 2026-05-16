import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { API_BASE_URL, API_KEY } from "../constants";
import { colors, fonts, spacing } from "../theme";

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

export default function RequestsScreen() {
  const [requests, setRequests] = useState<PagerRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actioning, setActioning] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editingIds, setEditingIds] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [clock, setClock] = useState<string>(() => formatClock(new Date()));

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
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
        // Seed the edit buffer with the original text on first entry.
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

  const fetchRequests = useCallback(async () => {
    try {
      const res = await fetch(
        `${API_BASE_URL}/requests?status=pending`,
        { headers }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: PagerRequest[] = await res.json();
      setRequests(data);
    } catch (e) {
      console.error("Failed to fetch requests:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") fetchRequests();
    });
    return () => sub.remove();
  }, [fetchRequests]);

  useEffect(() => {
    const interval = setInterval(fetchRequests, 60000);
    return () => clearInterval(interval);
  }, [fetchRequests]);

  useEffect(() => {
    const tick = () => setClock(formatClock(new Date()));
    const interval = setInterval(tick, 30_000);
    return () => clearInterval(interval);
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchRequests();
  }, [fetchRequests]);

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
        body: JSON.stringify(sendEdit ? { status, proposed_action: edited } : { status }),
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

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.textFaint} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* HEADER */}
      <View style={styles.header}>
        <View style={styles.headerLeftBar} />
        <View style={styles.headerInner}>
          <Text style={styles.headerTitle}>REQUESTS</Text>
          <View style={styles.headerDivider} />
          <Text style={styles.headerStatusLine}>
            {clock} <Text style={styles.dim}>·</Text> {requests.length} PENDING <Text style={styles.dim}>·</Text> POLL 60s
          </Text>
        </View>
      </View>

      <FlatList
        data={requests}
        keyExtractor={(item) => item.id}
        contentContainerStyle={requests.length === 0 ? styles.listEmpty : styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.textFaint}
            colors={[colors.textFaint]}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Feather name="inbox" size={42} color={colors.textFaint} />
            <Text style={styles.emptyText}>NO PENDING REQUESTS</Text>
            <Text style={styles.emptyHint}>pull down to sync</Text>
          </View>
        }
        renderItem={({ item }) => {
          const priority = PRIORITY_CONFIG[item.priority] ?? PRIORITY_CONFIG.low;
          const isActioning = actioning.has(item.id);
          const isExpanded = expanded.has(item.id);
          return (
            <View style={[styles.card, { borderLeftColor: priority.color }]}>
              {/* TOP ROW */}
              <View style={styles.cardTopRow}>
                <View style={[styles.badge, { backgroundColor: priority.color }]}>
                  <Text style={styles.badgeText}>{priority.label}</Text>
                </View>
                <Text style={styles.cardDashes} numberOfLines={1}>
                  {"────────────────────"}
                </Text>
                <Text style={styles.cardTime}>{formatDate(item.created_at)}</Text>
              </View>

              {/* CONTENT — tap to expand/collapse */}
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
                        {edits[item.id] !== undefined && edits[item.id] !== item.proposed_action ? (
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

              {/* ACTIONS */}
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  centered: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  dim: {
    color: colors.textFaint,
  },

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

  // EMPTY
  listEmpty: { flexGrow: 1 },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    color: colors.textFaint,
    fontFamily: fonts.mono,
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 2,
    marginTop: spacing.md,
  },
  emptyHint: {
    color: colors.textFaint,
    fontFamily: fonts.mono,
    fontSize: 11,
    marginTop: spacing.sm,
    letterSpacing: 0.5,
  },

  // LIST + CARDS
  list: {
    padding: spacing.md,
  },
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
  badge: {
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
  },
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
  proposedActions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
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
  proposedInput: {
    padding: 0,
    marginTop: 2,
    textAlignVertical: "top",
  },

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

  buttons: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  btn: {
    flex: 1,
    paddingVertical: spacing.sm + 2,
    alignItems: "center",
    borderWidth: 1,
    backgroundColor: colors.bg,
  },
  btnPressed: {
    opacity: 0.6,
  },
  approveBtn: {
    borderColor: colors.accent,
  },
  rejectBtn: {
    borderColor: colors.borderBright,
  },
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
