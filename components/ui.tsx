// Presentational building blocks for the Pager UI (designs in
// scratchpad/design/project/*.dc.html). All visual styling lives here and in
// theme.ts so a restyle stays in one place.
import { useEffect, useRef, type ReactNode } from "react";
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fonts, t } from "../theme";

export type FeatherName = React.ComponentProps<typeof Feather>["name"];

/** `#RRGGBB` + alpha → rgba(). */
export function alpha(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ---- text -------------------------------------------------------------------

export function T({
  children,
  size = 14,
  color = t.text,
  weight,
  mono,
  lines,
  selectable,
  style,
  onPress,
}: {
  children?: ReactNode;
  size?: number;
  color?: string;
  weight?: TextStyle["fontWeight"];
  mono?: boolean;
  lines?: number;
  selectable?: boolean;
  style?: StyleProp<TextStyle>;
  onPress?: () => void;
}) {
  return (
    <Text
      numberOfLines={lines}
      selectable={selectable}
      onPress={onPress}
      style={[{ fontSize: size, color, fontWeight: weight, lineHeight: Math.round(size * 1.35) }, mono && { fontFamily: fonts.mono }, style]}
    >
      {children}
    </Text>
  );
}

/** Inline monospace span inside a T. */
export const M = ({ children, color }: { children: ReactNode; color?: string }) => (
  <Text style={[{ fontFamily: fonts.mono }, color ? { color } : null]}>{children}</Text>
);

// ---- screen chrome ------------------------------------------------------------

export function Screen({ children, inbox, style }: { children: ReactNode; inbox?: boolean; style?: StyleProp<ViewStyle> }) {
  const insets = useSafeAreaInsets();
  return <View style={[{ flex: 1, backgroundColor: inbox ? t.bgInbox : t.bg, paddingTop: insets.top }, style]}>{children}</View>;
}

/** Tab-root header: large title, optional mono count, meta and right actions. */
export function LargeHeader({ title, count, meta, right }: { title: string; count?: ReactNode; meta?: ReactNode; right?: ReactNode }) {
  return (
    <View style={s.largeHeader}>
      <Text style={s.largeTitle}>{title}</Text>
      {count !== undefined ? <T size={12} mono color={t.faint}>{count}</T> : null}
      {meta}
      <View style={{ flex: 1 }} />
      {right}
    </View>
  );
}

/** Pushed-screen header: blue back link, optional right content. */
export function BackHeader({ label, onBack, right, mono }: { label: string; onBack: () => void; right?: ReactNode; mono?: boolean }) {
  return (
    <View style={s.backHeader}>
      <Pressable onPress={onBack} hitSlop={8} style={({ pressed }) => [s.backLink, pressed && { opacity: 0.6 }]}>
        <Feather name="chevron-left" size={22} color={t.accent} />
        <T size={16} color={t.accent} mono={mono}>
          {label}
        </T>
      </Pressable>
      <View style={{ flex: 1 }} />
      {right}
    </View>
  );
}

export function PageTitle({ title, sub, row }: { title: string; sub?: string; row?: boolean }) {
  return (
    <View style={[s.pageTitle, row && { flexDirection: "row", alignItems: "baseline", gap: 8 }]}>
      <Text style={s.largeTitle}>{title}</Text>
      {sub ? <T size={row ? 12 : 13} color={t.dim}>{sub}</T> : null}
    </View>
  );
}

// ---- lists ----------------------------------------------------------------------

export function SectionHeader({ children, meta, right, style, size = 14 }: { children: ReactNode; meta?: ReactNode; right?: ReactNode; style?: StyleProp<ViewStyle>; size?: number }) {
  return (
    <View style={[s.sech, style]}>
      {typeof children === "string" ? <T size={size} weight="600">{children}</T> : children}
      {meta !== undefined ? (typeof meta === "string" || typeof meta === "number" ? <T size={11} color={t.faint}>{meta}</T> : meta) : null}
      {right ? <View style={{ marginLeft: "auto", flexDirection: "row", alignItems: "center" }}>{right}</View> : null}
    </View>
  );
}

export function List({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.list, style]}>{children}</View>;
}

export function Row({ children, onPress, onLongPress, style, disabled }: { children: ReactNode; onPress?: () => void; onLongPress?: () => void; style?: StyleProp<ViewStyle>; disabled?: boolean }) {
  if (!onPress && !onLongPress) return <View style={[s.row, style]}>{children}</View>;
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} disabled={disabled} style={({ pressed }) => [s.row, style, pressed && { backgroundColor: t.fill }]}>
      {children}
    </Pressable>
  );
}

export function KVRow({ label, value, mono, onPress, right, sub }: { label: ReactNode; value?: ReactNode; mono?: boolean; onPress?: () => void; right?: ReactNode; sub?: ReactNode }) {
  const body = (
    <>
      <View style={{ flexShrink: 1, gap: 2 }}>
        {typeof label === "string" ? <T color={t.dim}>{label}</T> : label}
        {sub ? (typeof sub === "string" ? <T size={12} color={t.faint}>{sub}</T> : sub) : null}
      </View>
      <View style={{ flexShrink: 1, flexDirection: "row", alignItems: "center", gap: 8, marginLeft: "auto" }}>
        {value !== undefined ? (
          typeof value === "string" || typeof value === "number" ? (
            <T size={mono ? 13 : 14} mono={mono} lines={1} selectable>
              {value}
            </T>
          ) : (
            value
          )
        ) : null}
        {right}
      </View>
    </>
  );
  return onPress ? (
    <Pressable onPress={onPress} style={({ pressed }) => [s.kv, pressed && { backgroundColor: t.fill }]}>
      {body}
    </Pressable>
  ) : (
    <View style={s.kv}>{body}</View>
  );
}

// ---- controls ---------------------------------------------------------------------

export function TextBtn({ label, onPress, tone = "accent", disabled, size = 14, weight = "600" }: { label: string; onPress: () => void; tone?: "accent" | "danger" | "dim"; disabled?: boolean; size?: number; weight?: TextStyle["fontWeight"] }) {
  const color = tone === "danger" ? t.danger : tone === "dim" ? t.dim : t.accent;
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={6} style={({ pressed }) => [s.textBtn, (pressed || disabled) && { opacity: disabled ? 0.35 : 0.6 }]}>
      <T size={size} weight={weight} color={color}>
        {label}
      </T>
    </Pressable>
  );
}

export function BigButton({ label, onPress, kind = "primary", disabled, inbox }: { label: string; onPress: () => void; kind?: "primary" | "secondary"; disabled?: boolean; inbox?: boolean }) {
  const primary = kind === "primary";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        s.bigBtn,
        { backgroundColor: primary ? (disabled ? alpha(t.accent, 0.35) : t.accent) : t.fill2 },
        pressed && { opacity: 0.75 },
      ]}
    >
      <T size={17} weight={primary ? "700" : "500"} color={primary ? (disabled ? "rgba(255,255,255,0.5)" : t.white) : inbox ? t.white : t.text}>
        {label}
      </T>
    </Pressable>
  );
}

/** Pinned action area at the bottom of a detail screen. */
export function BottomBar({ children, note, inbox }: { children: ReactNode; note?: ReactNode; inbox?: boolean }) {
  return (
    <View style={[s.bottomBar, { backgroundColor: inbox ? t.bgInbox : t.bg, borderTopColor: inbox ? t.divider : t.hairline }]}>
      {note ? (typeof note === "string" ? <T size={12} color={t.faint} style={{ textAlign: "center" }}>{note}</T> : note) : null}
      {children}
    </View>
  );
}

export function ButtonPair({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: "row", gap: 10 }}>{children}</View>;
}

export function Note({ children, tone = "neutral", style }: { children: ReactNode; tone?: "neutral" | "green" | "orange"; style?: StyleProp<ViewStyle> }) {
  const bg = tone === "green" ? alpha(t.running, 0.1) : tone === "orange" ? alpha(t.needs, 0.1) : "rgba(255,255,255,0.05)";
  return (
    <View style={[s.note, { backgroundColor: bg }, style]}>
      {typeof children === "string" ? <T size={13} color={t.dim}>{children}</T> : children}
    </View>
  );
}

export function Segmented<V extends string>({ options, value, onChange }: { options: { value: V; label: string; color?: string }[]; value: V; onChange: (v: V) => void }) {
  return (
    <View style={s.seg} accessibilityRole="radiogroup">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} accessibilityRole="radio" accessibilityState={{ checked: on }} style={[s.segBtn, on && { backgroundColor: "rgba(255,255,255,0.18)" }]}>
            <T weight="600" color={on ? t.white : o.color ?? "rgba(255,255,255,0.75)"}>
              {o.label}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Toggle({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return <Switch value={value} onValueChange={onChange} disabled={disabled} trackColor={{ false: t.fill2, true: t.accent }} thumbColor={t.white} />;
}

export function Check({ value, onChange, label, sub }: { value: boolean; onChange: (v: boolean) => void; label: string; sub?: string }) {
  return (
    <Pressable onPress={() => onChange(!value)} style={s.check} accessibilityRole="checkbox" accessibilityState={{ checked: value }}>
      <View style={[s.checkBox, value && { backgroundColor: t.accent, borderColor: t.accent }]}>{value ? <Feather name="check" size={14} color={t.white} /> : null}</View>
      <T size={15}>{label}</T>
      {sub ? <T size={12} color={t.faint}>{sub}</T> : null}
    </Pressable>
  );
}

export function Input(props: TextInputProps & { mono?: boolean }) {
  const { style, mono, ...rest } = props;
  return (
    <TextInput
      placeholderTextColor={t.faint}
      autoCapitalize="none"
      autoCorrect={false}
      style={[s.input, mono && { fontFamily: fonts.mono, fontSize: 12 }, style]}
      {...rest}
    />
  );
}

// ---- status -------------------------------------------------------------------------

export const statusColor = (status: string) => (status === "needs_you" ? t.needs : status === "running" ? t.running : status === "idle" ? t.idle : status === "away" ? t.away : status === "error" ? t.error : t.done);

function Pulse({ color, size }: { color: string; size: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration: 1300, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [v]);
  return (
    <Animated.View
      style={{
        position: "absolute",
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 1.5,
        borderColor: color,
        opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.85, 0] }),
        transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 2.3] }) }],
      }}
    />
  );
}

/** Agent status dot: running pulses, needs/running glow, done flat gray, ended a ring. */
export function StatusDot({ status, size = 8, style }: { status: string; size?: number; style?: StyleProp<ViewStyle> }) {
  const color = statusColor(status);
  const ended = status === "ended";
  return (
    <View style={[{ width: size, height: size, alignItems: "center", justifyContent: "center" }, style]}>
      {status === "running" || status === "away" ? <Pulse color={color} size={size} /> : null}
      <View
        style={[
          { width: size, height: size, borderRadius: size / 2 },
          ended ? { borderWidth: 1.5, borderColor: t.done } : { backgroundColor: color },
          (status === "running" || status === "away" || status === "needs_you" || status === "error") && { shadowColor: color, shadowOpacity: 1, shadowRadius: 4, shadowOffset: { width: 0, height: 0 }, elevation: 2 },
        ]}
      />
    </View>
  );
}

export function IconTile({ name, color, dim, size = 36 }: { name: FeatherName; color: string; dim?: boolean; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: alpha(color, dim ? 0.08 : 0.14) }}>
      <Feather name={name} size={18} color={dim ? alpha(color, 0.6) : color} />
    </View>
  );
}

// ---- sheets ---------------------------------------------------------------------------

export function Sheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={[s.sheet, { paddingBottom: 24 + insets.bottom }]} onPress={() => {}}>
          <View style={s.grabber} />
          <ScrollView keyboardShouldPersistTaps="handled" bounces={false}>
            {children}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export interface MenuOption {
  key: string;
  label: string;
  emoji?: string;
  color?: string;
  checked?: boolean;
  onPress: () => void;
}

/** Bottom-sheet picker (AppRetcon shape): title, subtitle, options, Cancel. */
export function MenuSheet({ visible, title, sub, options, onClose }: { visible: boolean; title: string; sub?: string; options: MenuOption[]; onClose: () => void }) {
  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={{ paddingHorizontal: 20, paddingBottom: 14, gap: 4 }}>
        <T size={20} weight="700">{title}</T>
        {sub ? <T size={13} mono color={t.dim}>{sub}</T> : null}
      </View>
      <View style={{ borderTopWidth: 1, borderTopColor: t.hairline }}>
        {options.map((o) => (
          <Pressable
            key={o.key}
            onPress={() => {
              onClose();
              o.onPress();
            }}
            style={({ pressed }) => [s.opt, pressed && { backgroundColor: t.fill }]}
          >
            {o.emoji ? <Text style={s.emo}>{o.emoji}</Text> : null}
            <T size={15} color={o.color ?? t.text} style={{ flex: 1 }}>
              {o.label}
            </T>
            {o.checked ? <Feather name="check" size={18} color={t.accent} /> : null}
          </Pressable>
        ))}
      </View>
      <Pressable onPress={onClose} style={({ pressed }) => [s.sheetCancel, pressed && { opacity: 0.7 }]}>
        <T size={15} weight="600">Cancel</T>
      </Pressable>
    </Sheet>
  );
}

/** Centered empty state: icon tile, title, one line, optional button. */
export function Empty({ title, hint, icon, action }: { title: string; hint?: string; icon?: FeatherName; action?: { label: string; onPress: () => void } }) {
  return (
    <View style={s.empty}>
      {icon ? (
        <View style={s.emptyIcon}>
          <Feather name={icon} size={26} color="rgba(255,255,255,0.6)" />
        </View>
      ) : null}
      <T size={18} weight="700" color={t.white} style={{ textAlign: "center" }}>{title}</T>
      {hint ? <T size={14} color="rgba(255,255,255,0.6)" style={{ textAlign: "center", lineHeight: 20 }}>{hint}</T> : null}
      {action ? (
        <Pressable onPress={action.onPress} style={({ pressed }) => [s.emptyBtn, pressed && { opacity: 0.7 }]}>
          <T size={15} weight="600" color={t.accent}>{action.label}</T>
        </Pressable>
      ) : null}
    </View>
  );
}

/** "No connection · showing what was true at HH:MM · retrying" under a tab header. */
export function OfflineBanner({ offline, since }: { offline: boolean; since: number }) {
  if (!offline) return null;
  const d = since ? new Date(since) : null;
  const hm = d ? `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : "";
  return (
    <View accessibilityRole="alert" style={s.banner}>
      <Feather name="wifi-off" size={16} color="rgba(255,255,255,0.7)" />
      <T size={13} color="rgba(255,255,255,0.85)" style={{ flex: 1 }} lines={2}>
        {hm ? `No connection · showing what was true at ${hm}` : "No connection"}
      </T>
      <T size={13} color={t.text3}>retrying</T>
    </View>
  );
}

export function Chevron({ color = t.faint, size = 14 }: { color?: string; size?: number }) {
  return <Feather name="chevron-right" size={size} color={color} />;
}

export const ui = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { paddingBottom: 24, gap: 22 },
  rowGap: { flexDirection: "row", alignItems: "center", gap: 8 },
  emo: { width: 22, textAlign: "center", fontSize: 16 },
});

const s = StyleSheet.create({
  largeHeader: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 18, paddingRight: 10, paddingBottom: 10, paddingLeft: 18, minHeight: 72 },
  largeTitle: { fontSize: 24, fontWeight: "700", color: t.text },
  backHeader: { flexDirection: "row", alignItems: "center", paddingTop: 10, paddingHorizontal: 10, minHeight: 54 },
  backLink: { flexDirection: "row", alignItems: "center", minHeight: 44, paddingHorizontal: 2, gap: 0 },
  pageTitle: { paddingTop: 2, paddingHorizontal: 20, paddingBottom: 14, gap: 4 },
  sech: { flexDirection: "row", alignItems: "baseline", gap: 7, paddingHorizontal: 20, marginBottom: 6 },
  list: { borderTopWidth: 1, borderTopColor: t.hairline },
  row: { flexDirection: "row", gap: 10, alignItems: "flex-start", paddingVertical: 11, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: t.hairline },
  kv: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44, paddingHorizontal: 18, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: t.hairline },
  textBtn: { minHeight: 40, paddingHorizontal: 6, justifyContent: "center" },
  bigBtn: { flex: 1, minHeight: 52, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  bottomBar: { paddingTop: 12, paddingHorizontal: 20, paddingBottom: 14, borderTopWidth: 1, gap: 8 },
  note: { borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14 },
  seg: { flexDirection: "row", gap: 4, padding: 3, borderRadius: 10, backgroundColor: t.divider },
  segBtn: { flex: 1, minHeight: 40, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  check: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: t.hairline },
  checkBox: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: t.faint, alignItems: "center", justifyContent: "center" },
  input: { color: t.text, fontSize: 15, borderRadius: 10, backgroundColor: t.fill, paddingHorizontal: 12, paddingVertical: 10 },
  backdrop: { flex: 1, backgroundColor: t.backdrop, justifyContent: "flex-end" },
  sheet: { backgroundColor: t.sheet, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingTop: 8, maxHeight: "90%" },
  grabber: { width: 36, height: 5, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.25)", alignSelf: "center", marginBottom: 14 },
  opt: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: t.hairline },
  emo: { width: 22, textAlign: "center", fontSize: 16 },
  sheetCancel: { marginTop: 16, marginHorizontal: 18, minHeight: 44, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.1)", alignItems: "center", justifyContent: "center" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 48, paddingHorizontal: 40 },
  emptyIcon: { width: 56, height: 56, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.07)", alignItems: "center", justifyContent: "center" },
  emptyBtn: { marginTop: 6, minHeight: 44, paddingHorizontal: 18, borderRadius: 10, backgroundColor: "rgba(10,132,255,0.16)", justifyContent: "center" },
  banner: { marginHorizontal: 12, marginBottom: 6, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: t.sheet, flexDirection: "row", alignItems: "center", gap: 10 },
});
