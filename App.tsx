import { useEffect, useRef, useState } from "react";
import {
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Handle notifications when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

type Category = "urgent" | "alert" | "info";

interface PagerNotification {
  id: string;
  title: string;
  body: string;
  category: Category;
  timestamp: number;
}

const CATEGORY_CONFIG: Record<
  Category,
  { color: string; icon: string; label: string }
> = {
  urgent: { color: "#EF4444", icon: "🔴", label: "URGENT" },
  alert: { color: "#EAB308", icon: "🟡", label: "ALERT" },
  info: { color: "#3B82F6", icon: "🔵", label: "INFO" },
};

const STORAGE_KEY = "pager_notifications";
const MAX_ITEMS = 100;

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

async function registerForPush(): Promise<string | null> {
  if (!Device.isDevice) {
    console.log("Push notifications require a physical device");
    return null;
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    console.log("Push notification permission not granted");
    return null;
  }

  const tokenData = await Notifications.getExpoPushTokenAsync();
  console.log("Expo push token:", tokenData.data);
  return tokenData.data;
}

async function loadNotifications(): Promise<PagerNotification[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

async function saveNotifications(items: PagerNotification[]) {
  await AsyncStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(items.slice(0, MAX_ITEMS))
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, "0");
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const mins = pad(d.getMinutes());
  return `${month}/${day} ${hours}:${mins}`;
}

export default function App() {
  const [notifications, setNotifications] = useState<PagerNotification[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const notificationListener = useRef<Notifications.EventSubscription>(null);
  const responseListener = useRef<Notifications.EventSubscription>(null);

  useEffect(() => {
    setupChannels();
    loadNotifications().then(setNotifications);
    registerForPush().then(setToken);

    // Listen for incoming notifications
    const notifSub = Notifications.addNotificationReceivedListener(
      (notification) => {
        const data = notification.request.content.data as {
          category?: string;
        };
        const category = (
          ["urgent", "alert", "info"].includes(data?.category ?? "")
            ? data!.category
            : "info"
        ) as Category;

        const item: PagerNotification = {
          id: notification.request.identifier,
          title: notification.request.content.title ?? "No title",
          body: notification.request.content.body ?? "",
          category,
          timestamp: Date.now(),
        };

        setNotifications((prev) => {
          const next = [item, ...prev].slice(0, MAX_ITEMS);
          saveNotifications(next);
          return next;
        });
      }
    );
    notificationListener.current = notifSub;

    // Listen for user tapping on notification
    const responseSub =
      Notifications.addNotificationResponseReceivedListener(() => {
        // Just open the app — history is already visible
      });
    responseListener.current = responseSub;

    return () => {
      notifSub.remove();
      responseSub.remove();
    };
  }, []);

  const clearHistory = async () => {
    setNotifications([]);
    await AsyncStorage.removeItem(STORAGE_KEY);
  };

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>PAGER</Text>
        {notifications.length > 0 && (
          <Pressable onPress={clearHistory} style={styles.clearBtn}>
            <Text style={styles.clearText}>CLEAR</Text>
          </Pressable>
        )}
      </View>

      {/* Token display */}
      {token && (
        <View style={styles.tokenBar}>
          <Text style={styles.tokenText} numberOfLines={1}>
            {token}
          </Text>
        </View>
      )}

      {/* Notification list */}
      {notifications.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>📟</Text>
          <Text style={styles.emptyText}>No notifications yet</Text>
        </View>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const config = CATEGORY_CONFIG[item.category];
            return (
              <View style={[styles.card, { borderLeftColor: config.color }]}>
                <View style={styles.cardHeader}>
                  <View
                    style={[styles.badge, { backgroundColor: config.color }]}
                  >
                    <Text style={styles.badgeText}>
                      {config.icon} {config.label}
                    </Text>
                  </View>
                  <Text style={styles.time}>{formatTime(item.timestamp)}</Text>
                </View>
                <Text style={styles.title}>{item.title}</Text>
                {item.body ? (
                  <Text style={styles.body}>{item.body}</Text>
                ) : null}
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
  clearBtn: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#555",
  },
  clearText: {
    color: "#999",
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 1,
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
  empty: {
    flex: 1,
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
  title: {
    color: "#EEEEEE",
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 4,
  },
  body: {
    color: "#999999",
    fontSize: 14,
    lineHeight: 20,
  },
});
