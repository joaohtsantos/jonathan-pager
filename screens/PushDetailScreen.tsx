import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { PushStackParamList } from "./PushListScreen";
import { API_BASE_URL, API_KEY } from "../constants";

type Category = "urgent" | "alert" | "info";

interface PushDetail {
  id: string;
  category: Category;
  title: string;
  body: string | null;
  source: string;
  read: 0 | 1;
  created_at: string;
  read_at: string | null;
}

const CATEGORY_CONFIG: Record<Category, { color: string; icon: string; label: string }> = {
  urgent: { color: "#EF4444", icon: "\u{1F534}", label: "URGENT" },
  alert: { color: "#EAB308", icon: "\u{1F7E1}", label: "ALERT" },
  info: { color: "#3B82F6", icon: "\u{1F535}", label: "INFO" },
};

const headers = {
  Authorization: `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} at ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function PushDetailScreen() {
  const route = useRoute<RouteProp<PushStackParamList, "PushDetail">>();
  const navigation = useNavigation();
  const { id } = route.params;

  const [push, setPush] = useState<PushDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        // Fetch the push
        const res = await fetch(`${API_BASE_URL}/pushes/${id}`, { headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: PushDetail = await res.json();
        setPush(data);

        // Mark as read
        if (!data.read) {
          await fetch(`${API_BASE_URL}/pushes/${id}`, {
            method: "PATCH",
            headers,
            body: JSON.stringify({ read: true }),
          });
        }
      } catch (e) {
        console.error("Failed to fetch push:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const markUnread = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/pushes/${id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ read: false }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      navigation.goBack();
    } catch (e) {
      console.error("Failed to mark unread:", e);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#666" size="large" />
      </View>
    );
  }

  if (!push) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Failed to load notification</Text>
      </View>
    );
  }

  const config = CATEGORY_CONFIG[push.category] ?? CATEGORY_CONFIG.info;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.badge, { backgroundColor: config.color }]}>
          <Text style={styles.badgeText}>
            {config.icon} {config.label}
          </Text>
        </View>

        <Text style={styles.title}>{push.title}</Text>

        {push.body ? <Text style={styles.body}>{push.body}</Text> : null}

        <View style={styles.metaSection}>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Source</Text>
            <Text style={styles.metaValue}>{push.source}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Received</Text>
            <Text style={styles.metaValue}>{formatDateTime(push.created_at)}</Text>
          </View>
          {push.read_at && (
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Read at</Text>
              <Text style={styles.metaValue}>{formatDateTime(push.read_at)}</Text>
            </View>
          )}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable style={styles.unreadBtn} onPress={markUnread}>
          <Text style={styles.unreadBtnText}>Mark as unread</Text>
        </Pressable>
      </View>
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
  errorText: {
    color: "#999",
    fontSize: 16,
  },
  content: {
    padding: 20,
    paddingTop: 24,
  },
  badge: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 4,
    alignSelf: "flex-start",
    marginBottom: 16,
  },
  badgeText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  title: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 16,
    lineHeight: 30,
  },
  body: {
    color: "#CCCCCC",
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 24,
  },
  metaSection: {
    backgroundColor: "#1A1A1A",
    borderRadius: 8,
    padding: 14,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#222",
  },
  metaLabel: {
    color: "#666",
    fontSize: 13,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  metaValue: {
    color: "#CCC",
    fontSize: 13,
  },
  footer: {
    padding: 20,
    paddingBottom: Platform.OS === "ios" ? 36 : 20,
    borderTopWidth: 1,
    borderTopColor: "#222",
    backgroundColor: "#1A1A1A",
  },
  unreadBtn: {
    backgroundColor: "#333",
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
  },
  unreadBtnText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
  },
});
