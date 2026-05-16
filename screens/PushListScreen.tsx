import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Notifications from "expo-notifications";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { API_BASE_URL, API_KEY } from "../constants";
import { colors, fonts, spacing } from "../theme";
import ConfirmModal from "../components/ConfirmModal";
import { useToast } from "../components/Toast";

type Category = "urgent" | "alert" | "info";

interface Push {
  id: string;
  category: Category;
  title: string;
  body: string | null;
  source: string;
  read: 0 | 1;
  created_at: string;
  read_at: string | null;
}

export type PushStackParamList = {
  PushList: undefined;
  PushDetail: { id: string };
};

const CATEGORY_CONFIG: Record<Category, { color: string; label: string }> = {
  urgent: { color: colors.urgent, label: "URGENT" },
  alert: { color: colors.alert, label: "ALERT" },
  info: { color: colors.info, label: "INFO" },
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

export default function PushListScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<PushStackParamList>>();
  const [pushes, setPushes] = useState<Push[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [clock, setClock] = useState<string>(() => formatClock(new Date()));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const toast = useToast();
  const notificationListener = useRef<Notifications.EventSubscription>(null);

  const fetchPushes = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/pushes?limit=50`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: Push[] = await res.json();
      setPushes(data);
    } catch (e) {
      console.error("Failed to fetch pushes:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/pushes?read=false`, { headers });
      if (!res.ok) return;
      const data: Push[] = await res.json();
      const count = data.length;
      navigation.getParent()?.setOptions({
        tabBarBadge: count > 0 ? count : undefined,
      });
    } catch {
      // ignore
    }
  }, [navigation]);

  useEffect(() => {
    fetchPushes();
    fetchUnreadCount();

    const notifSub = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data as { category?: string; id?: string; source?: string };
      const category = (
        ["urgent", "alert", "info"].includes(data?.category ?? "")
          ? data!.category
          : "info"
      ) as Category;

      const item: Push = {
        id: data?.id ?? notification.request.identifier,
        category,
        title: notification.request.content.title ?? "No title",
        body: notification.request.content.body ?? null,
        source: data?.source ?? "system",
        read: 0,
        created_at: new Date().toISOString(),
        read_at: null,
      };

      setPushes((prev) => [item, ...prev.filter((p) => p.id !== item.id)]);
      fetchUnreadCount();
    });
    notificationListener.current = notifSub;

    const responseSub = Notifications.addNotificationResponseReceivedListener(() => {});

    return () => {
      notifSub.remove();
      responseSub.remove();
    };
  }, [fetchPushes, fetchUnreadCount]);

  useEffect(() => {
    const tick = () => setClock(formatClock(new Date()));
    const interval = setInterval(tick, 30_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", () => {
      fetchPushes();
      fetchUnreadCount();
    });
    return unsubscribe;
  }, [navigation, fetchPushes, fetchUnreadCount]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchPushes();
    fetchUnreadCount();
  }, [fetchPushes, fetchUnreadCount]);

  const unreadCount = pushes.filter((p) => !p.read).length;

  const markAllRead = () => {
    if (unreadCount === 0) return;
    setConfirmOpen(true);
  };

  const confirmMarkAllRead = async () => {
    setConfirmOpen(false);
    try {
      const res = await fetch(`${API_BASE_URL}/pushes/read-all`, {
        method: "POST",
        headers,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const now = new Date().toISOString();
      setPushes((prev) =>
        prev.map((p) => (p.read ? p : { ...p, read: 1, read_at: now }))
      );
      fetchUnreadCount();
      toast.show("MARKED ALL READ");
    } catch (e) {
      console.error("Failed to mark all read:", e);
    }
  };

  const toggleRead = async (push: Push) => {
    const newRead = push.read ? 0 : 1;
    try {
      const res = await fetch(`${API_BASE_URL}/pushes/${push.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ read: !!newRead }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPushes((prev) =>
        prev.map((p) =>
          p.id === push.id
            ? { ...p, read: newRead, read_at: newRead ? new Date().toISOString() : null }
            : p
        )
      );
      fetchUnreadCount();
      toast.show(newRead ? "MARKED READ" : "MARKED UNREAD");
    } catch (e) {
      console.error("Failed to toggle read:", e);
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
      {/* HEADER ─ pager-style status frame */}
      <View style={styles.header}>
        <View style={styles.headerLeftBar} />
        <View style={styles.headerInner}>
          <View style={styles.headerTopRow}>
            <Text style={styles.headerTitle}>PAGER</Text>
            {unreadCount > 0 ? (
              <Pressable onPress={markAllRead} hitSlop={8}>
                <Text style={styles.headerAction}>[ MARK ALL · {unreadCount} ]</Text>
              </Pressable>
            ) : null}
          </View>
          <View style={styles.headerDivider} />
          <Text style={styles.headerStatusLine}>
            {clock} <Text style={styles.headerDim}>·</Text> SYNC OK <Text style={styles.headerDim}>·</Text> TX {pushes.length}
          </Text>
        </View>
      </View>

      {/* LIST */}
      {pushes.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>{"\u{1F4DF}"}</Text>
          <Text style={styles.emptyText}>NO TRAFFIC</Text>
          <Text style={styles.emptyHint}>pull down to sync</Text>
        </View>
      ) : (
        <FlatList
          data={pushes}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.textFaint}
              colors={[colors.textFaint]}
            />
          }
          renderItem={({ item }) => {
            const config = CATEGORY_CONFIG[item.category] ?? CATEGORY_CONFIG.info;
            const isUnread = !item.read;
            return (
              <Pressable
                onPress={() => navigation.navigate("PushDetail", { id: item.id })}
                onLongPress={() => toggleRead(item)}
              >
                <View style={[styles.card, { borderLeftColor: config.color }]}>
                  <View style={styles.cardTopRow}>
                    <View style={[styles.badge, { backgroundColor: config.color }]}>
                      <Text style={styles.badgeText}>{config.label}</Text>
                    </View>
                    <Text style={styles.cardDashes} numberOfLines={1}>
                      {"────────────────────"}
                    </Text>
                    <Text style={styles.cardTime}>{formatDate(item.created_at)}</Text>
                  </View>
                  <Text
                    style={[styles.cardTitle, !isUnread && styles.cardTitleRead]}
                    numberOfLines={1}
                  >
                    {isUnread ? "> " : "  "}
                    {item.title}
                  </Text>
                  {item.body ? (
                    <Text style={styles.cardBody} numberOfLines={2}>
                      {item.body}
                    </Text>
                  ) : null}
                  <Text style={styles.cardSource}>:: {item.source}</Text>
                </View>
              </Pressable>
            );
          }}
        />
      )}

      <ConfirmModal
        visible={confirmOpen}
        title="MARK ALL READ"
        body={`Mark ${unreadCount} push${unreadCount === 1 ? "" : "es"} as read?`}
        confirmLabel="MARK ALL"
        cancelLabel="CANCEL"
        onConfirm={confirmMarkAllRead}
        onCancel={() => setConfirmOpen(false)}
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
  headerTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  headerTitle: {
    color: colors.text,
    fontFamily: fonts.mono,
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: 4,
  },
  headerAction: {
    color: colors.accent,
    fontFamily: fonts.mono,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
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
  headerDim: {
    color: colors.textFaint,
  },

  // EMPTY
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  emptyText: {
    color: colors.textFaint,
    fontFamily: fonts.mono,
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 3,
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
  cardTitle: {
    color: colors.text,
    fontFamily: fonts.mono,
    fontSize: 14,
    fontWeight: "700",
    marginBottom: spacing.xs,
  },
  cardTitleRead: {
    color: colors.textDim,
    fontWeight: "400",
  },
  cardBody: {
    color: colors.textDim,
    fontFamily: fonts.mono,
    fontSize: 12,
    lineHeight: 18,
    marginBottom: spacing.xs,
  },
  cardSource: {
    color: colors.textFaint,
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 0.5,
    marginTop: spacing.xs,
  },
});
