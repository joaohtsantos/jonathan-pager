import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Location from "expo-location";
import { Feather } from "@expo/vector-icons";
import { colors, fonts, spacing } from "../theme";
import { useLocation } from "../locationContext";
import { locationApi, type TimelineSegment, type Zone } from "../locationSetup";
import ConfirmModal from "../components/ConfirmModal";

type EditingZone = Partial<Omit<Zone, "id">> & { id?: string };

function formatSince(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatDuration(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h < 24) return `${h}h${m > 0 ? ` ${m}m` : ""}`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

const SHORT_WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function clockLabel(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
function dayLabel(iso: string): string {
  const d = new Date(iso);
  return `${SHORT_WD[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
}

const PAGE_SIZE = 30;

export default function LocationScreen() {
  const {
    zones,
    zonesLoading,
    zonesError,
    refreshZones,
    createZone,
    updateZone,
    deleteZone,
    current,
    currentError,
    refreshCurrent,
    tracking,
  } = useLocation();

  const [editing, setEditing] = useState<EditingZone | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Zone | null>(null);
  const [correcting, setCorrecting] = useState<TimelineSegment | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [segments, setSegments] = useState<TimelineSegment[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // Load the newest page (reset) or, with a cursor, append the next older page.
  const loadTimeline = useCallback(async (before?: string) => {
    if (before) setLoadingMore(true);
    else setInitialLoading(true);
    setTimelineError(null);
    try {
      const res = await locationApi.timeline(before, PAGE_SIZE);
      const desc = res.segments.slice().reverse(); // newest first
      setSegments(prev => {
        if (!before) return desc;
        const seen = new Set(prev.map(s => `${s.from}-${s.to}`));
        return [...prev, ...desc.filter(s => !seen.has(`${s.from}-${s.to}`))];
      });
      setNextBefore(res.next_before);
    } catch (err) {
      setTimelineError(err instanceof Error ? err.message : String(err));
    } finally {
      setInitialLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    loadTimeline();
  }, [loadTimeline]);

  const loadMore = () => {
    if (loadingMore || initialLoading || !nextBefore) return;
    loadTimeline(nextBefore);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refreshZones(), refreshCurrent(), loadTimeline()]);
    setRefreshing(false);
  };

  const useCurrentCoords = async () => {
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setEditing(prev => ({
        ...(prev ?? {}),
        lat: Number(loc.coords.latitude.toFixed(6)),
        lon: Number(loc.coords.longitude.toFixed(6)),
      }));
    } catch (err) {
      Alert.alert("Couldn't get current location", err instanceof Error ? err.message : String(err));
    }
  };

  const addZoneFromGap = (seg: TimelineSegment) => {
    setEditing({
      name: seg.neighborhood ?? seg.city ?? "",
      emoji: "📍",
      lat: typeof seg.lat === "number" ? seg.lat : undefined,
      lon: typeof seg.lon === "number" ? seg.lon : undefined,
      radius: 100,
    });
  };

  const correctSegment = async (target: { zone_id?: string | null; kind?: "unknown" | "transit" }) => {
    const seg = correcting;
    if (!seg) return;
    setCorrecting(null);
    try {
      await locationApi.createOverride(seg.from, seg.to, target);
      loadTimeline();
    } catch (err) {
      Alert.alert("Couldn't correct", err instanceof Error ? err.message : String(err));
    }
  };

  const submitZone = async () => {
    if (!editing) return;
    const { name, emoji, lat, lon, radius, id } = editing;
    if (!name || typeof lat !== "number" || typeof lon !== "number" || typeof radius !== "number") {
      Alert.alert("Missing fields", "name, lat, lon, radius are required.");
      return;
    }
    try {
      if (id) await updateZone(id, { name, emoji: emoji ?? null, lat, lon, radius });
      else await createZone({ name, emoji: emoji ?? null, lat, lon, radius });
      setEditing(null);
      loadTimeline(); // a new zone reshapes the timeline
    } catch (err) {
      Alert.alert("Save failed", err instanceof Error ? err.message : String(err));
    }
  };

  const currentLine = useMemo(() => {
    if (!current) return "—";
    if (current.in_zone) {
      return `${current.emoji ?? "📍"} ${current.zone ?? "?"} · since ${formatSince(current.since)}`;
    }
    const parts = [current.neighborhood, current.city, current.state].filter(Boolean);
    if (parts.length === 0) return "out of zone";
    return parts.join(", ");
  }, [current]);

  const ListHeader = (
    <View>
      {/* CURRENT */}
      <View style={styles.block}>
        <View style={styles.blockHeaderRow}>
          <Text style={styles.blockHeader}>CURRENT</Text>
          <Pressable onPress={refreshCurrent} hitSlop={8}>
            <Feather name="refresh-cw" size={12} color={colors.textFaint} />
          </Pressable>
        </View>
        <View style={styles.blockDivider} />
        <Text style={styles.currentText}>{currentLine}</Text>
        {current?.last_ping ? (
          <Text style={styles.dim}>last ping {formatSince(current.last_ping)}</Text>
        ) : null}
        {currentError ? <Text style={styles.errorText}>ERROR: {currentError}</Text> : null}
      </View>

      {/* ZONES */}
      <View style={styles.block}>
        <View style={styles.blockHeaderRow}>
          <Text style={styles.blockHeader}>ZONES</Text>
          <Pressable onPress={() => setEditing({ radius: 100 })} hitSlop={8} style={styles.addBtn}>
            <Feather name="plus" size={12} color={colors.accent} />
            <Text style={styles.addBtnText}>ADD</Text>
          </Pressable>
        </View>
        <View style={styles.blockDivider} />
        {zonesError ? <Text style={styles.errorText}>ERROR: {zonesError}</Text> : null}
        {zonesLoading && zones.length === 0 ? (
          <Text style={styles.dim}>Loading…</Text>
        ) : zones.length === 0 ? (
          <Text style={styles.dim}>No zones yet. Add one above.</Text>
        ) : (
          zones.map((z, idx) => (
            <Pressable
              key={z.id}
              onPress={() => setEditing(z)}
              onLongPress={() => setPendingDelete(z)}
              style={({ pressed }) => [styles.zoneRow, idx === 0 && { borderTopWidth: 0 }, pressed && { opacity: 0.6 }]}
            >
              <Text style={styles.zoneEmoji}>{z.emoji ?? "📍"}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.zoneName}>{z.name}</Text>
                <Text style={styles.zoneCoords}>
                  {z.lat.toFixed(4)}, {z.lon.toFixed(4)} · r={Math.round(z.radius)}m
                </Text>
              </View>
              <Feather name="chevron-right" size={14} color={colors.textFaint} />
            </Pressable>
          ))
        )}
      </View>

      {/* TIMELINE header */}
      <View style={styles.timelineHeaderRow}>
        <Text style={styles.blockHeader}>TIMELINE</Text>
        <Text style={styles.dim}>most recent first</Text>
      </View>
      {timelineError ? <Text style={styles.errorText}>ERROR: {timelineError}</Text> : null}
      {initialLoading ? <Text style={styles.dim}>Loading…</Text> : null}
      {!initialLoading && segments.length === 0 ? (
        <Text style={styles.dim}>No history yet.</Text>
      ) : null}
    </View>
  );

  const renderSegment = ({ item, index }: { item: TimelineSegment; index: number }) => {
    const prev = segments[index - 1];
    const showDay = !prev || dayLabel(prev.from) !== dayLabel(item.from);
    const isZone = item.kind === "zone";
    const untagged = item.kind === "untagged";
    const prefix = item.kind === "transit" ? "🚗 " : untagged ? "❓ " : `${(item.emoji ?? "📍").trim()} `;
    return (
      <View>
        {showDay ? <Text style={styles.dayHeader}>{dayLabel(item.from)}</Text> : null}
        <Pressable
          onPress={() => setCorrecting(item)}
          style={({ pressed }) => [styles.segRow, !isZone && styles.segRowUntagged, pressed && { opacity: 0.6 }]}
        >
          <View style={[styles.segBar, { backgroundColor: isZone ? colors.accent : colors.border }]} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.segLabel, !isZone && styles.segLabelUntagged]}>
              {prefix}
              {item.label}
              {item.corrected ? <Text style={styles.correctedMark}>  ✎</Text> : null}
            </Text>
            <Text style={styles.segTime}>
              {clockLabel(item.from)} → {item.ongoing ? "now" : clockLabel(item.to)}
            </Text>
          </View>
          {untagged && typeof item.lat === "number" && typeof item.lon === "number" ? (
            <Pressable onPress={() => addZoneFromGap(item)} hitSlop={8} style={styles.gapAddBtn}>
              <Feather name="plus" size={11} color={colors.accent} />
              <Text style={styles.gapAddText}>ADD</Text>
            </Pressable>
          ) : null}
          <Text style={[styles.segDuration, item.ongoing && { color: colors.accent }]}>
            {formatDuration(item.duration_ms)}
          </Text>
        </Pressable>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeftBar} />
        <View style={styles.headerInner}>
          <Text style={styles.headerTitle}>LOCATION</Text>
          <View style={styles.headerDivider} />
          <Text style={styles.headerStatusLine}>
            {tracking ? <Text style={{ color: colors.accent }}>● TRACKING</Text> : <Text style={styles.dim}>○ IDLE</Text>}
            <Text style={styles.dim}> · </Text>
            {zones.length} {zones.length === 1 ? "zone" : "zones"}
          </Text>
        </View>
      </View>

      <FlatList
        data={segments}
        keyExtractor={(s, i) => `${s.from}-${s.to}-${i}`}
        renderItem={renderSegment}
        ListHeaderComponent={ListHeader}
        contentContainerStyle={styles.content}
        onEndReached={loadMore}
        onEndReachedThreshold={0.6}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
        ListFooterComponent={
          loadingMore ? (
            <ActivityIndicator color={colors.accent} style={{ marginVertical: spacing.lg }} />
          ) : segments.length > 0 && !nextBefore ? (
            <Text style={[styles.dim, styles.endText]}>— start of history —</Text>
          ) : null
        }
      />

      {/* EDIT/CREATE MODAL */}
      <Modal visible={editing !== null} transparent animationType="fade" onRequestClose={() => setEditing(null)} statusBarTranslucent>
        <Pressable style={styles.backdrop} onPress={() => setEditing(null)}>
          <Pressable style={styles.editCard} onPress={() => {}}>
            <View style={styles.cardLeftBar} />
            <View style={styles.editInner}>
              <Text style={styles.editTitle}>{editing?.id ? "EDIT ZONE" : "NEW ZONE"}</Text>
              <View style={styles.divider} />
              <Field label="NAME" value={editing?.name ?? ""} onChange={v => setEditing(p => ({ ...(p ?? {}), name: v }))} />
              <Field label="EMOJI" value={editing?.emoji ?? ""} onChange={v => setEditing(p => ({ ...(p ?? {}), emoji: v }))} placeholder="🏠" />
              <Field label="LAT" value={editing?.lat?.toString() ?? ""} onChange={v => setEditing(p => ({ ...(p ?? {}), lat: parseFloat(v) }))} keyboardType="numbers-and-punctuation" />
              <Field label="LON" value={editing?.lon?.toString() ?? ""} onChange={v => setEditing(p => ({ ...(p ?? {}), lon: parseFloat(v) }))} keyboardType="numbers-and-punctuation" />
              <Field label="RADIUS (m)" value={editing?.radius?.toString() ?? ""} onChange={v => setEditing(p => ({ ...(p ?? {}), radius: parseFloat(v) }))} keyboardType="number-pad" />

              <Pressable onPress={useCurrentCoords} style={styles.useHere}>
                <Feather name="crosshair" size={12} color={colors.accent} />
                <Text style={styles.useHereText}>USE CURRENT LOCATION</Text>
              </Pressable>

              <View style={styles.buttons}>
                <Pressable onPress={() => setEditing(null)} style={styles.btn}>
                  <Text style={styles.cancelText}>[ CANCEL ]</Text>
                </Pressable>
                <Pressable onPress={submitZone} style={[styles.btn, styles.confirmBtn]}>
                  <Text style={styles.confirmText}>[ SAVE ]</Text>
                </Pressable>
              </View>

              {editing?.id ? (
                <Pressable
                  onPress={() => {
                    const z = zones.find(x => x.id === editing.id);
                    if (z) setPendingDelete(z);
                  }}
                  style={styles.deleteRow}
                >
                  <Feather name="trash-2" size={12} color={colors.urgent} />
                  <Text style={styles.deleteText}>DELETE ZONE</Text>
                </Pressable>
              ) : null}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* CORRECT SEGMENT MODAL */}
      <Modal visible={correcting !== null} transparent animationType="fade" onRequestClose={() => setCorrecting(null)} statusBarTranslucent>
        <Pressable style={styles.backdrop} onPress={() => setCorrecting(null)}>
          <Pressable style={styles.editCard} onPress={() => {}}>
            <View style={styles.cardLeftBar} />
            <View style={styles.editInner}>
              <Text style={styles.editTitle}>WHERE WERE YOU?</Text>
              {correcting ? (
                <Text style={styles.dim}>
                  {clockLabel(correcting.from)} → {correcting.ongoing ? "now" : clockLabel(correcting.to)} · {formatDuration(correcting.duration_ms)}
                </Text>
              ) : null}
              <View style={styles.divider} />
              {zones.map((z, idx) => (
                <Pressable
                  key={z.id}
                  onPress={() => correctSegment({ zone_id: z.id })}
                  style={({ pressed }) => [styles.pickRow, idx === 0 && { borderTopWidth: 0 }, pressed && { opacity: 0.6 }]}
                >
                  <Text style={styles.zoneEmoji}>{z.emoji ?? "📍"}</Text>
                  <Text style={styles.pickLabel}>{z.name}</Text>
                </Pressable>
              ))}
              <Pressable
                onPress={() => correctSegment({ kind: "transit" })}
                style={({ pressed }) => [styles.pickRow, pressed && { opacity: 0.6 }]}
              >
                <Text style={styles.zoneEmoji}>🚗</Text>
                <Text style={[styles.pickLabel, { color: colors.textDim }]}>In transit</Text>
              </Pressable>
              <Pressable
                onPress={() => correctSegment({ kind: "unknown" })}
                style={({ pressed }) => [styles.pickRow, pressed && { opacity: 0.6 }]}
              >
                <Text style={styles.zoneEmoji}>❓</Text>
                <Text style={[styles.pickLabel, { color: colors.textDim }]}>Unknown (untagged)</Text>
              </Pressable>
              <Pressable onPress={() => setCorrecting(null)} style={[styles.btn, { marginTop: spacing.md }]}>
                <Text style={styles.cancelText}>[ CANCEL ]</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <ConfirmModal
        visible={pendingDelete !== null}
        title="DELETE ZONE"
        body={`Remove "${pendingDelete?.name ?? ""}"? Geofence will stop firing for this location.`}
        confirmLabel="DELETE"
        danger
        onCancel={() => setPendingDelete(null)}
        onConfirm={async () => {
          const z = pendingDelete;
          setPendingDelete(null);
          setEditing(null);
          if (z) {
            try {
              await deleteZone(z.id);
              loadTimeline();
            } catch (err) {
              Alert.alert("Delete failed", err instanceof Error ? err.message : String(err));
            }
          }
        }}
      />
    </View>
  );
}

function Field({
  label,
  value,
  onChange,
  keyboardType,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  keyboardType?: "default" | "number-pad" | "numbers-and-punctuation";
  placeholder?: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType={keyboardType ?? "default"}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        style={styles.fieldInput}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  dim: { color: colors.textFaint, fontFamily: fonts.mono, fontSize: 11 },

  header: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    paddingTop: 56,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerLeftBar: { width: 3, backgroundColor: colors.accent, marginRight: spacing.md, alignSelf: "stretch" },
  headerInner: { flex: 1 },
  headerTitle: { color: colors.text, fontFamily: fonts.mono, fontSize: 20, fontWeight: "700", letterSpacing: 4 },
  headerDivider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  headerStatusLine: { color: colors.textDim, fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.5 },

  content: { padding: spacing.lg },
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
  blockHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  blockHeader: { color: colors.textFaint, fontFamily: fonts.mono, fontSize: 10, fontWeight: "700", letterSpacing: 2 },
  blockDivider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },

  currentText: { color: colors.text, fontFamily: fonts.mono, fontSize: 14, marginBottom: 4 },
  errorText: { color: colors.urgent, fontFamily: fonts.mono, fontSize: 11, marginTop: 4 },

  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 4, paddingHorizontal: 8, borderWidth: 1, borderColor: colors.accent },
  addBtnText: { color: colors.accent, fontFamily: fonts.mono, fontSize: 10, fontWeight: "700", letterSpacing: 1.5 },

  zoneRow: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.sm, gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  zoneEmoji: { fontSize: 18 },
  zoneName: { color: colors.text, fontFamily: fonts.mono, fontSize: 13, fontWeight: "700" },
  zoneCoords: { color: colors.textFaint, fontFamily: fonts.mono, fontSize: 10, marginTop: 2 },

  timelineHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm },

  dayHeader: {
    color: colors.textDim,
    fontFamily: fonts.mono,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.5,
    marginTop: spacing.md,
    marginBottom: spacing.xs ?? 4,
  },
  segRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, backgroundColor: colors.surface, paddingHorizontal: spacing.sm, marginTop: 2 },
  segRowUntagged: { backgroundColor: "transparent" },
  segBar: { width: 3, alignSelf: "stretch" },
  segLabel: { color: colors.text, fontFamily: fonts.mono, fontSize: 13, fontWeight: "700" },
  segLabelUntagged: { color: colors.textDim, fontWeight: "400" },
  segTime: { color: colors.textFaint, fontFamily: fonts.mono, fontSize: 10, marginTop: 2 },
  segDuration: { color: colors.textDim, fontFamily: fonts.mono, fontSize: 12, fontWeight: "700", letterSpacing: 0.5 },
  gapAddBtn: { flexDirection: "row", alignItems: "center", gap: 3, paddingVertical: 3, paddingHorizontal: 6, borderWidth: 1, borderColor: colors.accent },
  gapAddText: { color: colors.accent, fontFamily: fonts.mono, fontSize: 9, fontWeight: "700", letterSpacing: 1 },
  correctedMark: { color: colors.accent, fontSize: 11 },
  endText: { textAlign: "center", marginVertical: spacing.lg },

  pickRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm + 2, borderTopWidth: 1, borderTopColor: colors.border },
  pickLabel: { color: colors.text, fontFamily: fonts.mono, fontSize: 13, fontWeight: "700" },

  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  editCard: { flexDirection: "row", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderBright, width: "100%", maxWidth: 420 },
  cardLeftBar: { width: 3, backgroundColor: colors.accent },
  editInner: { flex: 1, padding: spacing.lg },
  editTitle: { color: colors.text, fontFamily: fonts.mono, fontSize: 14, fontWeight: "700", letterSpacing: 3 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.md },

  field: { marginBottom: spacing.sm },
  fieldLabel: { color: colors.textFaint, fontFamily: fonts.mono, fontSize: 10, fontWeight: "700", letterSpacing: 1.5, marginBottom: 4 },
  fieldInput: {
    color: colors.text,
    fontFamily: fonts.mono,
    fontSize: 13,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 8,
    paddingHorizontal: spacing.sm,
  },

  useHere: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6, marginBottom: spacing.sm },
  useHereText: { color: colors.accent, fontFamily: fonts.mono, fontSize: 10, fontWeight: "700", letterSpacing: 1.5 },

  buttons: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  btn: { flex: 1, paddingVertical: spacing.sm + 2, alignItems: "center", borderWidth: 1, borderColor: colors.borderBright, backgroundColor: colors.bg },
  confirmBtn: { borderColor: colors.accent },
  cancelText: { color: colors.textDim, fontFamily: fonts.mono, fontSize: 12, fontWeight: "700", letterSpacing: 1.5 },
  confirmText: { color: colors.accent, fontFamily: fonts.mono, fontSize: 12, fontWeight: "700", letterSpacing: 1.5 },

  deleteRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  deleteText: { color: colors.urgent, fontFamily: fonts.mono, fontSize: 10, fontWeight: "700", letterSpacing: 1.5 },
});
