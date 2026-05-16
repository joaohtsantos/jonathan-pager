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
import { colors, fonts, spacing } from "../theme";

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

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  return `${months[d.getMonth()]} ${pad(d.getDate())}  ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
        const res = await fetch(`${API_BASE_URL}/pushes/${id}`, { headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: PushDetail = await res.json();
        setPush(data);

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
        <ActivityIndicator color={colors.textFaint} size="large" />
      </View>
    );
  }

  if (!push) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>:: FAILED TO LOAD ::</Text>
      </View>
    );
  }

  const config = CATEGORY_CONFIG[push.category] ?? CATEGORY_CONFIG.info;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* HEADER FRAME */}
        <View style={styles.frame}>
          <View style={[styles.frameBar, { backgroundColor: config.color }]} />
          <View style={styles.frameInner}>
            <Text style={styles.frameTitle}>TRANSMISSION</Text>
            <View style={styles.frameDivider} />
            <Text style={styles.frameSubtitle}>
              <Text style={{ color: config.color }}>{config.label}</Text>
              <Text style={styles.dim}>  ·  </Text>
              <Text style={styles.dim}>{push.source}</Text>
            </Text>
          </View>
        </View>

        {/* BODY */}
        <View style={styles.bodyBlock}>
          <Text style={styles.title}>{push.title}</Text>
          {push.body ? (
            <>
              <View style={styles.bodyDivider} />
              <Text style={styles.body}>{push.body}</Text>
            </>
          ) : null}
        </View>

        {/* META */}
        <View style={styles.metaBlock}>
          <Text style={styles.metaHeader}>META</Text>
          <View style={styles.metaDivider} />
          <MetaRow label="SOURCE" value={push.source} />
          <MetaRow label="RECEIVED" value={formatDateTime(push.created_at)} />
          {push.read_at && (
            <MetaRow label="READ AT" value={formatDateTime(push.read_at)} />
          )}
          <MetaRow label="STATUS" value={push.read ? "READ" : "UNREAD"} />
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable style={styles.unreadBtn} onPress={markUnread}>
          <Text style={styles.unreadBtnText}>[ ◌  MARK UNREAD ]</Text>
        </Pressable>
      </View>
    </View>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
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
  errorText: {
    color: colors.urgent,
    fontFamily: fonts.mono,
    fontSize: 13,
    letterSpacing: 2,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  dim: {
    color: colors.textFaint,
  },

  // HEADER FRAME
  frame: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderTopColor: colors.border,
    borderRightColor: colors.border,
    borderBottomColor: colors.border,
    marginBottom: spacing.xl,
  },
  frameBar: {
    width: 3,
  },
  frameInner: {
    flex: 1,
    padding: spacing.md,
  },
  frameTitle: {
    color: colors.text,
    fontFamily: fonts.mono,
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 3,
  },
  frameDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.sm,
  },
  frameSubtitle: {
    fontFamily: fonts.mono,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
  },

  // BODY
  bodyBlock: {
    marginBottom: spacing.xl,
    paddingHorizontal: spacing.xs,
  },
  title: {
    color: colors.text,
    fontFamily: fonts.mono,
    fontSize: 18,
    fontWeight: "700",
    lineHeight: 26,
  },
  bodyDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
  body: {
    color: colors.textDim,
    fontFamily: fonts.mono,
    fontSize: 13,
    lineHeight: 20,
  },

  // META
  metaBlock: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.border,
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderTopColor: colors.border,
    borderRightColor: colors.border,
    borderBottomColor: colors.border,
  },
  metaHeader: {
    color: colors.textFaint,
    fontFamily: fonts.mono,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 2,
  },
  metaDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.sm,
  },
  metaRow: {
    flexDirection: "row",
    paddingVertical: spacing.xs,
  },
  metaLabel: {
    color: colors.textFaint,
    fontFamily: fonts.mono,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    width: 90,
  },
  metaValue: {
    color: colors.text,
    fontFamily: fonts.mono,
    fontSize: 12,
    flex: 1,
  },

  // FOOTER
  footer: {
    padding: spacing.lg,
    paddingBottom: Platform.OS === "ios" ? 36 : spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    backgroundColor: colors.surface,
  },
  unreadBtn: {
    backgroundColor: colors.bg,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderBright,
    alignItems: "center",
  },
  unreadBtnText: {
    color: colors.text,
    fontFamily: fonts.mono,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 2,
  },
});
