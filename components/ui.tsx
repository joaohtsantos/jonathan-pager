// Small presentational building blocks shared by the Agents / Inbox / Machines
// screens. All styling lives here (on theme.ts tokens) so the upcoming visual
// design can be applied in one place.
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from "react-native";
import { colors, fonts, spacing } from "../theme";

export function ScreenHeader({ title, status, right }: { title: string; status?: ReactNode; right?: ReactNode }) {
  return (
    <View style={s.header}>
      <View style={s.headerBar} />
      <View style={{ flex: 1 }}>
        <View style={s.headerTop}>
          <Text style={s.headerTitle}>{title}</Text>
          {right}
        </View>
        <View style={s.divider} />
        {typeof status === "string" ? <Text style={s.headerStatus}>{status}</Text> : status}
      </View>
    </View>
  );
}

export function Block({ title, right, children, accent, style }: { title?: string; right?: ReactNode; children?: ReactNode; accent?: string; style?: ViewStyle }) {
  return (
    <View style={[s.block, accent ? { borderLeftColor: accent } : null, style]}>
      {title || right ? (
        <>
          <View style={s.row}>
            <Text style={s.blockTitle}>{title}</Text>
            {right}
          </View>
          <View style={s.divider} />
        </>
      ) : null}
      {children}
    </View>
  );
}

export function Btn({
  label,
  onPress,
  disabled,
  tone = "accent",
  small,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: "accent" | "dim" | "danger";
  small?: boolean;
}) {
  const color = tone === "dim" ? colors.textDim : tone === "danger" ? colors.urgent : colors.accent;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      style={({ pressed }) => [s.btn, { borderColor: tone === "dim" ? colors.borderBright : color }, small && s.btnSmall, (disabled || pressed) && { opacity: disabled ? 0.4 : 0.7 }]}
    >
      <Text style={[s.btnText, { color }]}>[ {label} ]</Text>
    </Pressable>
  );
}

export function Badge({ label, color = colors.borderBright, filled }: { label: string; color?: string; filled?: boolean }) {
  return (
    <View style={[s.badge, { borderColor: color }, filled && { backgroundColor: color }]}>
      <Text style={[s.badgeText, { color: filled ? "#FFF" : color }]}>{label}</Text>
    </View>
  );
}

export function Mono({ children, dim, faint, bold, size = 12, style, lines, selectable }: { children: ReactNode; dim?: boolean; faint?: boolean; bold?: boolean; size?: number; style?: object; lines?: number; selectable?: boolean }) {
  return (
    <Text
      numberOfLines={lines}
      selectable={selectable}
      style={[{ fontFamily: fonts.mono, fontSize: size, color: faint ? colors.textFaint : dim ? colors.textDim : colors.text, fontWeight: bold ? "700" : "400" }, style]}
    >
      {children}
    </Text>
  );
}

export function KV({ label, value }: { label: string; value: ReactNode }) {
  return (
    <View style={s.kv}>
      <Text style={s.kvLabel}>{label}</Text>
      {typeof value === "string" || typeof value === "number" ? <Text style={s.kvValue} selectable>{value}</Text> : value}
    </View>
  );
}

export function Field(props: TextInputProps & { label?: string }) {
  const { label, style, ...rest } = props;
  return (
    <View style={{ marginBottom: spacing.sm }}>
      {label ? <Text style={s.kvLabel}>{label}</Text> : null}
      <TextInput placeholderTextColor={colors.textFaint} autoCapitalize="none" autoCorrect={false} style={[s.input, style]} {...rest} />
    </View>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={s.empty}>
      <Text style={s.emptyTitle}>{title}</Text>
      {hint ? <Text style={s.emptyHint}>{hint}</Text> : null}
    </View>
  );
}

export function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.chip, active && { borderColor: colors.accent }]}>
      <Text style={[s.chipText, active && { color: colors.accent }]}>{label}</Text>
    </Pressable>
  );
}

export const statusColor = (status: string) =>
  status === "needs_you" ? colors.urgent : status === "running" ? colors.text : status === "done" ? colors.alert : colors.info;

export const ui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: spacing.xxl * 2 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  rowGap: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  sectionLabel: { color: colors.textFaint, fontFamily: fonts.mono, fontSize: 10, fontWeight: "700", letterSpacing: 2, marginTop: spacing.md, marginBottom: spacing.sm },
  error: { color: colors.urgent, fontFamily: fonts.mono, fontSize: 11 },
});

const s = StyleSheet.create({
  header: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    paddingTop: 56,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerBar: { width: 3, backgroundColor: colors.accent, marginRight: spacing.md, alignSelf: "stretch" },
  headerTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  headerTitle: { color: colors.text, fontFamily: fonts.mono, fontSize: 20, fontWeight: "700", letterSpacing: 4 },
  headerStatus: { color: colors.textDim, fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.5 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  block: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.border,
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderTopColor: colors.border,
    borderRightColor: colors.border,
    borderBottomColor: colors.border,
  },
  blockTitle: { color: colors.textFaint, fontFamily: fonts.mono, fontSize: 10, fontWeight: "700", letterSpacing: 2, flexShrink: 1 },
  btn: { paddingVertical: 6, paddingHorizontal: 10, borderWidth: 1, alignSelf: "flex-start" },
  btnSmall: { paddingVertical: 3, paddingHorizontal: 6 },
  btnText: { fontFamily: fonts.mono, fontSize: 11, fontWeight: "700", letterSpacing: 1.2 },
  badge: { borderWidth: 1, paddingHorizontal: 5, paddingVertical: 1 },
  badgeText: { fontFamily: fonts.mono, fontSize: 9, fontWeight: "700", letterSpacing: 1 },
  kv: { flexDirection: "row", paddingVertical: 3, gap: spacing.sm },
  kvLabel: { color: colors.textFaint, fontFamily: fonts.mono, fontSize: 10, fontWeight: "700", letterSpacing: 1, width: 96 },
  kvValue: { color: colors.text, fontFamily: fonts.mono, fontSize: 12, flex: 1 },
  input: {
    color: colors.text,
    fontFamily: fonts.mono,
    fontSize: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    marginTop: 4,
  },
  empty: { alignItems: "center", justifyContent: "center", paddingVertical: spacing.xxl * 2 },
  emptyTitle: { color: colors.textFaint, fontFamily: fonts.mono, fontSize: 14, fontWeight: "700", letterSpacing: 3 },
  emptyHint: { color: colors.textFaint, fontFamily: fonts.mono, fontSize: 11, marginTop: spacing.sm, textAlign: "center", paddingHorizontal: spacing.lg },
  chip: { borderWidth: 1, borderColor: colors.border, paddingHorizontal: 8, paddingVertical: 3 },
  chipText: { color: colors.textDim, fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1 },
});
