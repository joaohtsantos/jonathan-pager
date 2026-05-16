import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { API_BASE_URL, API_KEY } from "../constants";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

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

const CATEGORY_CONFIG: Record<Category, { color: string; icon: string; label: string }> = {
  urgent: { color: "#EF4444", icon: "\u{1F534}", label: "URGENT" },
  alert: { color: "#EAB308", icon: "\u{1F7E1}", label: "ALERT" },
  info: { color: "#3B82F6", icon: "\u{1F535}", label: "INFO" },
};

const headers = {
  Authorization: `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
};

async function setupChannels() {
  if (Platform.OS !== "android") return;

  await Notifications.setNotificationChannelAsync("urgent", {
    name: "Urgent",
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 500, 200, 500, 200, 500],
    lightColor: "#EF4444",
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    sound: "default",
  });

  await Notifications.setNotificationChannelAsync("alert", {
    name: "Alert",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 400, 200, 400],
    lightColor: "#EAB308",
    sound: "default",
  });

  await Notifications.setNotificationChannelAsync("info", {
    name: "Info",
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 200],
    lightColor: "#3B82F6",
    sound: "default",
  });
}

async function registerForPush(): Promise<string> {
  if (!Device.isDevice) {
    throw new Error("Push notifications require a physical device");
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    throw new Error(`Permission not granted (status: ${finalStatus})`);
  }

  const tokenData = await Notifications.getExpoPushTokenAsync({
    projectId: "00f38f4e-21a0-43da-b440-20c6a09679a4",
  });
  return tokenData.data;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function PushListScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<PushStackParamList>>();
  const [pushes, setPushes] = useState<Push[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
    setupChannels();
    registerForPush().then(setToken).catch((e) => setError(String(e)));
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

  // Refetch when screen comes back into focus (e.g. after marking read in detail)
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

  const toggleRead = async (push: Push) => {
    const newRead = push.read ? 0 : 1;
    const label = newRead ? "Mark as read" : "Mark as unread";
    Alert.alert(label, `${label} "${push.title}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: label,
        onPress: async () => {
          try {
            const res = await fetch(`${API_BASE_URL}/pushes/${push.id}`, {
              method: "PATCH",
              headers,
              body: JSON.stringify({ read: !!newRead }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            setPushes((prev) =>
              prev.map((p) =>
                p.id === push.id ? { ...p, read: newRead, read_at: newRead ? new Date().toISOString() : null } : p
              )
            );
            fetchUnreadCount();
          } catch (e) {
            console.error("Failed to toggle read:", e);
          }
        },
      },
    ]);
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
      <View style={styles.header}>
        <Text style={styles.headerTitle}>PAGER</Text>
      </View>

      <Pressable
        style={styles.tokenBar}
        onPress={() => {
          if (token) {
            Clipboard.setStringAsync(token);
            Alert.alert("Copied!", "Push token copied to clipboard");
          }
        }}
      >
        <Text style={styles.tokenText} numberOfLines={4} selectable>
          {error ? `ERROR: ${error}` : token ?? "Waiting for push token..."}
        </Text>
        {token && <Text style={styles.copyHint}>TAP TO COPY</Text>}
      </Pressable>

      {pushes.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyIcon}>{"\u{1F4DF}"}</Text>
          <Text style={styles.emptyText}>No notifications yet</Text>
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
              tintColor="#666"
              colors={["#666"]}
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
                  <View style={styles.cardRow}>
                    {isUnread && <View style={styles.unreadDot} />}
                    <View style={styles.cardContent}>
                      <View style={styles.cardHeader}>
                        <View style={[styles.badge, { backgroundColor: config.color }]}>
                          <Text style={styles.badgeText}>
                            {config.icon} {config.label}
                          </Text>
                        </View>
                        <Text style={styles.time}>{formatDate(item.created_at)}</Text>
                      </View>
                      <Text
                        style={[styles.title, { color: isUnread ? "#FFFFFF" : "#999", fontWeight: isUnread ? "700" : "400" }]}
                        numberOfLines={1}
                      >
                        {item.title}
                      </Text>
                      {item.body ? (
                        <Text style={styles.body} numberOfLines={2}>
                          {item.body}
                        </Text>
                      ) : null}
                      <Text style={styles.source}>{item.source}</Text>
                    </View>
                  </View>
                </View>
              </Pressable>
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 56,
    paddingBottom: 16,
    paddingHorizontal: 20,
    backgroundColor: "#1A1A1A",
    borderBottomWidth: 1,
    borderBottomColor: "#333",
  },
  headerTitle: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: 4,
  },
  tokenBar: {
    backgroundColor: "#1A1A1A",
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#222",
  },
  tokenText: {
    color: "#555",
    fontSize: 10,
    fontFamily: Platform.OS === "android" ? "monospace" : "Courier",
  },
  copyHint: {
    color: "#3B82F6",
    fontSize: 9,
    fontWeight: "600",
    marginTop: 4,
    letterSpacing: 1,
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
  cardRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#3B82F6",
    marginTop: 6,
    marginRight: 10,
  },
  cardContent: {
    flex: 1,
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
  title: {
    fontSize: 16,
    marginBottom: 4,
  },
  body: {
    color: "#999999",
    fontSize: 14,
    lineHeight: 20,
  },
  source: {
    color: "#555",
    fontSize: 11,
    marginTop: 6,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
});
