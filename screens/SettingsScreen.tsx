import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import Constants from "expo-constants";
import * as Location from "expo-location";
import { Feather } from "@expo/vector-icons";
import { colors, fonts, spacing } from "../theme";
import { useToken } from "../tokenContext";
import { useLocation } from "../locationContext";
import { useToast } from "../components/Toast";

export default function SettingsScreen() {
  const { token, error } = useToken();
  const {
    foreground,
    background,
    requestForeground,
    requestBackground,
    tracking,
    startTracking,
    stopTracking,
  } = useLocation();
  const toast = useToast();
  const version = (Constants.expoConfig?.version ?? "?") as string;

  const fgGranted = foreground === Location.PermissionStatus.GRANTED;
  const bgGranted = background === Location.PermissionStatus.GRANTED;

  const copyToken = async () => {
    if (!token) return;
    await Clipboard.setStringAsync(token);
    // Android 13+ shows a system-wide clipboard toast automatically; ours would duplicate it.
    if (Platform.OS !== "android") {
      toast.show("TOKEN COPIED");
    }
  };

  return (
    <View style={styles.container}>
      {/* HEADER */}
      <View style={styles.header}>
        <View style={styles.headerLeftBar} />
        <View style={styles.headerInner}>
          <Text style={styles.headerTitle}>SETTINGS</Text>
          <View style={styles.headerDivider} />
          <Text style={styles.headerStatusLine}>
            v{version} <Text style={styles.dim}>·</Text> {Platform.OS.toUpperCase()}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* PUSH TOKEN */}
        <View style={styles.block}>
          <View style={styles.blockHeaderRow}>
            <Text style={styles.blockHeader}>PUSH TOKEN</Text>
            {token ? (
              <Pressable onPress={copyToken} hitSlop={8}>
                <View style={styles.copyBtn}>
                  <Feather name="copy" size={12} color={colors.accent} />
                  <Text style={styles.copyBtnText}>COPY</Text>
                </View>
              </Pressable>
            ) : null}
          </View>
          <View style={styles.blockDivider} />

          {error ? (
            <Text style={styles.errorText}>ERROR: {error}</Text>
          ) : token ? (
            <Pressable onPress={copyToken}>
              <Text style={styles.tokenText} selectable>
                {token}
              </Text>
            </Pressable>
          ) : (
            <Text style={styles.dim}>Waiting for token…</Text>
          )}
        </View>

        {/* LOCATION — PERMISSIONS */}
        <View style={styles.block}>
          <Text style={styles.blockHeader}>LOCATION · PERMISSIONS</Text>
          <View style={styles.blockDivider} />
          <PermissionRow
            label="FOREGROUND"
            status={foreground}
            onRequest={requestForeground}
          />
          <PermissionRow
            label="BACKGROUND"
            status={background}
            onRequest={requestBackground}
            disabled={!fgGranted}
          />
          {(foreground === Location.PermissionStatus.DENIED ||
            background === Location.PermissionStatus.DENIED) && (
            <Pressable onPress={() => Linking.openSettings()} style={styles.linkBtn}>
              <Text style={styles.linkBtnText}>[ OPEN SYSTEM SETTINGS ]</Text>
            </Pressable>
          )}
          {!fgGranted ? (
            <Text style={styles.dim}>Foreground required to add zones via "use current location".</Text>
          ) : null}
        </View>

        {/* LOCATION — TRACKING */}
        {bgGranted ? (
          <View style={styles.block}>
            <View style={styles.blockHeaderRow}>
              <Text style={styles.blockHeader}>LOCATION · TRACKING</Text>
              <Pressable
                onPress={tracking ? stopTracking : startTracking}
                style={[styles.toggle, tracking && styles.toggleOn]}
              >
                <Text style={[styles.toggleText, tracking && styles.toggleTextOn]}>
                  [ {tracking ? "STOP" : "START"} ]
                </Text>
              </Pressable>
            </View>
            <View style={styles.blockDivider} />
            <Text style={styles.dim}>
              {tracking
                ? "Background geofence + significant location changes active."
                : "Press START to begin tracking. Stops after app reinstall or manual stop."}
            </Text>
          </View>
        ) : null}

        {/* INFO */}
        <View style={styles.block}>
          <Text style={styles.blockHeader}>DEVICE</Text>
          <View style={styles.blockDivider} />
          <InfoRow label="PLATFORM" value={Platform.OS} />
          <InfoRow label="APP" value={`v${version}`} />
        </View>
      </ScrollView>
    </View>
  );
}

function PermissionRow({
  label,
  status,
  onRequest,
  disabled,
}: {
  label: string;
  status: Location.PermissionStatus;
  onRequest: () => Promise<void>;
  disabled?: boolean;
}) {
  const granted = status === Location.PermissionStatus.GRANTED;
  return (
    <View style={styles.permRow}>
      <Text style={styles.permLabel}>{label}</Text>
      <Text style={[styles.permStatus, granted && { color: colors.accent }]}>
        {granted
          ? "✓ GRANTED"
          : status === Location.PermissionStatus.DENIED
          ? "✗ DENIED"
          : "○ NOT SET"}
      </Text>
      {!granted ? (
        <Pressable
          onPress={onRequest}
          disabled={disabled}
          style={[styles.permBtn, disabled && { opacity: 0.4 }]}
        >
          <Text style={styles.permBtnText}>[ REQUEST ]</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  dim: {
    color: colors.textFaint,
    fontFamily: fonts.mono,
    fontSize: 11,
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

  // CONTENT
  content: {
    padding: spacing.lg,
  },
  block: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderLeftWidth: 3,
    borderLeftColor: colors.border,
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderTopColor: colors.border,
    borderRightColor: colors.border,
    borderBottomColor: colors.border,
  },
  blockHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  blockHeader: {
    color: colors.textFaint,
    fontFamily: fonts.mono,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 2,
  },
  blockDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.sm,
  },

  copyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  copyBtnText: {
    color: colors.accent,
    fontFamily: fonts.mono,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.5,
  },

  tokenText: {
    color: colors.text,
    fontFamily: fonts.mono,
    fontSize: 11,
    lineHeight: 16,
  },
  errorText: {
    color: colors.urgent,
    fontFamily: fonts.mono,
    fontSize: 11,
  },

  infoRow: {
    flexDirection: "row",
    paddingVertical: 4,
  },
  infoLabel: {
    color: colors.textFaint,
    fontFamily: fonts.mono,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    width: 90,
  },
  infoValue: {
    color: colors.text,
    fontFamily: fonts.mono,
    fontSize: 12,
  },

  permRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    gap: spacing.sm,
  },
  permLabel: {
    color: colors.textDim,
    fontFamily: fonts.mono,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    width: 110,
  },
  permStatus: {
    color: colors.textFaint,
    fontFamily: fonts.mono,
    fontSize: 11,
    flex: 1,
  },
  permBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  permBtnText: {
    color: colors.accent,
    fontFamily: fonts.mono,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.5,
  },
  linkBtn: { marginTop: spacing.sm, alignSelf: "flex-start", paddingVertical: 4 },
  linkBtnText: {
    color: colors.accent,
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 1,
  },

  toggle: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: colors.borderBright,
  },
  toggleOn: { borderColor: colors.accent },
  toggleText: {
    color: colors.textDim,
    fontFamily: fonts.mono,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.5,
  },
  toggleTextOn: { color: colors.accent },
});
