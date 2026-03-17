import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { API_BASE_URL, API_KEY } from "../constants";

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
  high: { color: "#EF4444", label: "HIGH" },
  medium: { color: "#EAB308", label: "MEDIUM" },
  low: { color: "#3B82F6", label: "LOW" },
};

const headers = {
  Authorization: `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function RequestsScreen() {
  const [requests, setRequests] = useState<PagerRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actioning, setActioning] = useState<Set<string>>(new Set());

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

  // Initial fetch
  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  // Refetch when app comes to foreground
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") fetchRequests();
    });
    return () => sub.remove();
  }, [fetchRequests]);

  // Poll every 15s while screen is mounted
  useEffect(() => {
    const interval = setInterval(fetchRequests, 15000);
    return () => clearInterval(interval);
  }, [fetchRequests]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchRequests();
  }, [fetchRequests]);

  const handleAction = async (id: string, status: "approved" | "rejected") => {
    setActioning((prev) => new Set(prev).add(id));
    try {
      const res = await fetch(`${API_BASE_URL}/requests/${id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status }),
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
        <ActivityIndicator color="#666" size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {requests.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyIcon}>📋</Text>
          <Text style={styles.emptyText}>No pending requests</Text>
        </View>
      ) : (
        <FlatList
          data={requests}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#666"
              colors={["#666"]}
            />
          }
          renderItem={({ item }) => {
            const priority = PRIORITY_CONFIG[item.priority];
            const isActioning = actioning.has(item.id);
            return (
              <View
                style={[styles.card, { borderLeftColor: priority.color }]}
              >
                <View style={styles.cardHeader}>
                  <View
                    style={[
                      styles.badge,
                      { backgroundColor: priority.color },
                    ]}
                  >
                    <Text style={styles.badgeText}>{priority.label}</Text>
                  </View>
                  <Text style={styles.time}>
                    {formatDate(item.created_at)}
                  </Text>
                </View>
                <Text style={styles.summary} numberOfLines={2}>{item.email_subject}</Text>
                <Text style={styles.detail}>
                  📧 {item.email_sender}
                </Text>
                <Text style={styles.bodyText} numberOfLines={3}>
                  {item.summary}
                </Text>
                <View style={styles.actionBox}>
                  <Text style={styles.actionLabel}>Proposed action:</Text>
                  <Text style={styles.actionText}>
                    {item.proposed_action}
                  </Text>
                </View>
                <View style={styles.buttons}>
                  <Pressable
                    style={[styles.btn, styles.approveBtn]}
                    onPress={() => handleAction(item.id, "approved")}
                    disabled={isActioning}
                  >
                    <Text style={styles.btnText}>
                      {isActioning ? "..." : "Approve"}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[styles.btn, styles.rejectBtn]}
                    onPress={() => handleAction(item.id, "rejected")}
                    disabled={isActioning}
                  >
                    <Text style={styles.btnText}>
                      {isActioning ? "..." : "Reject"}
                    </Text>
                  </Pressable>
                </View>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#111111",
  },
  centered: {
    flex: 1,
    backgroundColor: "#111111",
    alignItems: "center",
    justifyContent: "center",
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyText: {
    color: "#555",
    fontSize: 16,
  },
  list: {
    padding: 12,
  },
  card: {
    backgroundColor: "#1A1A1A",
    borderRadius: 8,
    padding: 14,
    marginBottom: 10,
    borderLeftWidth: 4,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  badge: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 4,
  },
  badgeText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
  },
  time: {
    color: "#666",
    fontSize: 12,
  },
  summary: {
    color: "#EEEEEE",
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 6,
  },
  detail: {
    color: "#999",
    fontSize: 13,
    marginBottom: 4,
  },
  bodyText: {
    color: "#BBBBBB",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 4,
  },
  actionBox: {
    backgroundColor: "#222",
    borderRadius: 6,
    padding: 10,
    marginTop: 8,
    marginBottom: 10,
  },
  actionLabel: {
    color: "#666",
    fontSize: 11,
    fontWeight: "600",
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  actionText: {
    color: "#CCC",
    fontSize: 14,
    lineHeight: 20,
  },
  buttons: {
    flexDirection: "row",
    gap: 10,
  },
  btn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: "center",
  },
  approveBtn: {
    backgroundColor: "#16A34A",
  },
  rejectBtn: {
    backgroundColor: "#DC2626",
  },
  btnText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
});
