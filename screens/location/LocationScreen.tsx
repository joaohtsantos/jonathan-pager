// Location tab (design: LocFinal "L3 + period"). Day / Week / Month / Custom
// with ‹ › to move between periods. Day: "now" card, By place totals, the
// day's timeline (tap to correct, "+ Zone" on Unknown gaps). Other periods:
// totals + "Show the timeline". Data: pager-api /location/* (unchanged).
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useLocation } from "../../locationContext";
import { locationApi, type TimelineSegment } from "../../locationSetup";
import { LargeHeader, Screen, T, alpha } from "../../components/ui";
import { useZoneColors, UNKNOWN_COLOR, TRANSIT_COLOR } from "../../lib/zoneColors";
import { RetconSheet } from "./sheets";
import { RangeSheet } from "./RangeSheet";
import { useZoneEditor } from "./useZoneEditor";
import { clock, customLabel, dayName, daysIn, fmtDur, periodRange, sinceText, type Period } from "./format";
import type { LocationStackParamList } from "../../navigation/types";
import { t } from "../../theme";

const PERIODS: { id: Period; label: string }[] = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "custom", label: "Custom" },
];

const segEmoji = (s: { kind: string; emoji: string | null }) => (s.kind === "transit" ? "🚗" : s.kind === "untagged" ? "❓" : (s.emoji ?? "📍").trim());

interface Total {
  key: string;
  label: string;
  emoji: string;
  color: string;
  ms: number;
}

/** Time per place, from the range's segments (includes corrections and transit). */
function totalsOf(segments: TimelineSegment[], from: number, to: number, colorOf: (s: TimelineSegment) => string): Total[] {
  const by = new Map<string, Total>();
  for (const s of segments) {
    const a = Math.max(from, Date.parse(s.from));
    const b = Math.min(to, s.ongoing ? Date.now() : Date.parse(s.to));
    if (b <= a) continue;
    const key = s.kind === "zone" && s.zone_id ? s.zone_id : s.kind;
    const cur = by.get(key) ?? { key, label: s.kind === "zone" ? s.label : s.kind === "transit" ? "In transit" : "Unknown", emoji: segEmoji(s), color: s.kind === "untagged" ? UNKNOWN_COLOR : colorOf(s), ms: 0 };
    cur.ms += b - a;
    by.set(key, cur);
  }
  return [...by.values()].sort((x, y) => y.ms - x.ms);
}

export default function LocationScreen() {
  const nav = useNavigation<NativeStackNavigationProp<LocationStackParamList>>();
  const { zones, current, currentError, refreshCurrent, refreshZones, tracking } = useLocation();
  const { colorOf } = useZoneColors(zones);
  const [period, setPeriod] = useState<Period>("day");
  const [offset, setOffset] = useState(0);
  const [custom, setCustom] = useState<{ from: Date; to: Date }>(() => ({ from: new Date(Date.now() - 7 * 86_400_000), to: new Date() }));
  const [segments, setSegments] = useState<TimelineSegment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showTimeline, setShowTimeline] = useState(false);
  const [correcting, setCorrecting] = useState<TimelineSegment | null>(null);
  const [picking, setPicking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const range = useMemo(() => {
    if (period === "custom") return { from: custom.from, to: custom.to, label: customLabel(custom.from, custom.to), meta: daysIn(custom.from, custom.to) };
    return periodRange(period, offset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, offset, custom, refreshing]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await locationApi.timelineRange(range.from.toISOString(), range.to.toISOString());
      setSegments(res.segments);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => setShowTimeline(false), [period, offset, custom]);

  const editor = useZoneEditor(() => void load());

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refreshZones(), refreshCurrent()]);
    setRefreshing(false);
  };

  const correct = async (target: { zone_id?: string | null; kind?: "unknown" | "transit" }) => {
    const seg = correcting;
    if (!seg) return;
    setCorrecting(null);
    try {
      await locationApi.createOverride(seg.from, seg.to, target);
      void load();
    } catch (e) {
      Alert.alert("Couldn't correct", e instanceof Error ? e.message : String(e));
    }
  };

  const totals = totalsOf(segments, range.from.getTime(), range.to.getTime(), colorOf);
  const max = totals[0]?.ms ?? 1;
  const isToday = period === "day" && offset === 0;
  const timelineOpen = period === "day" || showTimeline;
  const newestFirst = [...segments].reverse();

  // "now" card
  const place = current?.in_zone ? current.zone ?? "?" : [current?.neighborhood, current?.city].filter(Boolean).join(", ") || "Out of zone";
  const placeEmoji = current?.in_zone ? current.emoji ?? "📍" : "🧭";
  const since = current?.since ? Date.parse(current.since) : 0;

  return (
    <Screen>
      <LargeHeader
        title="Location"
        right={
          <Pressable onPress={() => nav.navigate("Zones")} style={{ minHeight: 44, paddingHorizontal: 8, flexDirection: "row", alignItems: "center", gap: 4 }}>
            <T size={15} weight="600" color={t.accent}>Zones</T>
            <T size={15} weight="500" color={t.text3}>{zones.length}</T>
          </Pressable>
        }
      />
      <View style={s.segBar} accessibilityRole="tablist">
        {PERIODS.map((p) => (
          <Pressable key={p.id} accessibilityRole="tab" accessibilityState={{ selected: period === p.id }} onPress={() => { setPeriod(p.id); setOffset(0); }} style={[s.segBtn, period === p.id && { backgroundColor: "rgba(255,255,255,0.2)" }]}>
            <T size={14} weight="600" color={period === p.id ? t.white : "rgba(255,255,255,0.65)"}>{p.label}</T>
          </Pressable>
        ))}
      </View>
      {period !== "custom" ? (
        <View style={s.nav}>
          <Pressable accessibilityLabel="Previous" onPress={() => setOffset(offset + 1)} style={s.navBtn}>
            <T size={22} weight="600" color={t.accent}>‹</T>
          </Pressable>
          <T size={15} weight="600">{range.label}</T>
          <Pressable accessibilityLabel="Next" disabled={offset === 0} onPress={() => setOffset(Math.max(0, offset - 1))} style={s.navBtn}>
            <T size={22} weight="600" color={offset === 0 ? "rgba(255,255,255,0.25)" : t.accent}>›</T>
          </Pressable>
        </View>
      ) : null}

      <ScrollView contentContainerStyle={{ gap: 22, paddingTop: 8, paddingBottom: 20 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.faint} colors={[t.accent]} progressBackgroundColor={t.sheet} />}>
        {isToday ? (
          <Pressable onPress={refreshCurrent} style={s.card}>
            <Text style={{ fontSize: 30 }}>{placeEmoji}</Text>
            <View style={{ flex: 1, gap: 3 }}>
              <T size={20} weight="700">{current ? place : "—"}</T>
              {since ? (
                <T size={13} color="rgba(255,255,255,0.6)">
                  since {clock(since)} · <T size={13} mono color="rgba(255,255,255,0.6)">{fmtDur(Date.now() - since)}</T>
                </T>
              ) : null}
              {currentError ? <T size={12} color={t.danger}>{currentError}</T> : null}
            </View>
            <View style={{ alignItems: "flex-end", gap: 3 }}>
              <T size={12} color={tracking ? "#30D158" : t.text3}>{tracking ? "tracking" : "not tracking"}</T>
              {current?.last_ping ? <T size={12} color={t.text3}>ping {sinceText(current.last_ping)}</T> : null}
            </View>
          </Pressable>
        ) : null}

        {period === "custom" ? (
          <Pressable onPress={() => setPicking(true)} style={[s.card, { paddingVertical: 14, gap: 10 }]}>
            <View style={{ flex: 1, gap: 3 }}>
              <T size={12} color={t.text3}>Range</T>
              <T mono size={16}>{range.label}</T>
            </View>
            <T size={15} weight="600" color={t.accent}>Change</T>
          </Pressable>
        ) : null}

        {error ? <T size={12} color={t.danger} style={{ marginHorizontal: 20 }}>{error}</T> : null}

        <View>
          <SecH title="By place" meta={period === "day" ? undefined : range.meta} />
          <View style={s.list}>
            {loading && !totals.length ? <T size={13} color={t.faint} style={{ padding: 18 }}>Loading…</T> : null}
            {!loading && !totals.length ? <T size={13} color={t.faint} style={{ padding: 18 }}>No history for this period.</T> : null}
            {totals.map((x) => (
              <View key={x.key} style={[s.row, { height: 56 }]}>
                <View style={[s.emo, { backgroundColor: alpha(x.color, 0.18) }]}>
                  <Text style={{ fontSize: 15 }}>{x.emoji}</Text>
                </View>
                <View style={{ flex: 1, gap: 6 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <T size={15}>{x.label}</T>
                    <T mono size={14} color="rgba(255,255,255,0.75)">{fmtDur(x.ms)}</T>
                  </View>
                  <View style={s.track}>
                    <View style={{ height: "100%", width: `${Math.max(1, Math.round((x.ms / max) * 100))}%`, backgroundColor: x.color }} />
                  </View>
                </View>
              </View>
            ))}
          </View>
        </View>

        {!timelineOpen && segments.length ? (
          <Pressable onPress={() => setShowTimeline(true)} style={s.showLink}>
            <T size={14} weight="600" color={t.accent}>
              {period === "week" ? "Show the week’s timeline" : period === "month" ? "Show the month’s timeline" : "Show timeline for this range"}
            </T>
          </Pressable>
        ) : null}

        {timelineOpen && segments.length ? (
          <View>
            <SecH title="Timeline" meta="tap to correct" />
            <View style={s.list}>
              {newestFirst.map((seg, i) => {
                const prev = newestFirst[i - 1];
                const day = dayName(new Date(seg.from));
                const showDay = period !== "day" && (!prev || dayName(new Date(prev.from)) !== day);
                const zone = seg.kind === "zone";
                const color = seg.kind === "untagged" ? UNKNOWN_COLOR : seg.kind === "transit" ? TRANSIT_COLOR : colorOf(seg);
                return (
                  <View key={`${seg.from}-${seg.to}-${i}`}>
                    {showDay ? <T size={12} weight="600" color={t.dim} style={{ marginTop: 14, marginBottom: 6, marginHorizontal: 20 }}>{day}</T> : null}
                    <View style={s.row}>
                      <View style={[s.emo, { backgroundColor: alpha(color, 0.18) }]}>
                        <Text style={{ fontSize: 15 }}>{segEmoji(seg)}</Text>
                      </View>
                      <Pressable onPress={() => setCorrecting(seg)} style={{ flex: 1, minWidth: 0, gap: 3, justifyContent: "center", alignSelf: "stretch" }}>
                        <T size={15} weight="500" color={zone ? t.white : "rgba(255,255,255,0.65)"} lines={1}>
                          {seg.label}
                          {seg.corrected ? <T size={12} color={t.text3}>{"  ✎ corrected"}</T> : null}
                        </T>
                        <T mono size={12} color={t.text3}>{clock(seg.from)} → {seg.ongoing ? "now" : clock(seg.to)}</T>
                      </Pressable>
                      {seg.kind === "untagged" && typeof seg.lat === "number" && typeof seg.lon === "number" ? (
                        <Pressable onPress={() => editor.open({ name: seg.neighborhood ?? seg.city ?? "", emoji: "📍", lat: seg.lat ?? undefined, lon: seg.lon ?? undefined, radius: 100 })} style={{ minHeight: 40, paddingHorizontal: 6, justifyContent: "center" }}>
                          <T size={14} weight="600" color={t.accent}>+ Zone</T>
                        </Pressable>
                      ) : null}
                      <T mono size={13} weight={seg.ongoing ? "600" : "400"} color={seg.ongoing ? t.white : "rgba(255,255,255,0.6)"}>{fmtDur(seg.duration_ms)}</T>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}
      </ScrollView>

      <RetconSheet seg={correcting} zones={zones} onPick={correct} onClose={() => setCorrecting(null)} />
      <RangeSheet visible={picking} from={custom.from} to={custom.to} onApply={(from, to) => { setCustom({ from, to }); setPicking(false); }} onClose={() => setPicking(false)} />
      {editor.element}
    </Screen>
  );
}

function SecH({ title, meta }: { title: string; meta?: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "baseline", gap: 7, paddingHorizontal: 20, marginBottom: 8 }}>
      <T size={15} weight="700" color={t.white}>{title}</T>
      {meta ? <T size={12} weight="500" color={t.text3}>{meta}</T> : null}
    </View>
  );
}

const s = StyleSheet.create({
  segBar: { flexDirection: "row", gap: 2, padding: 3, marginTop: 2, marginHorizontal: 14, marginBottom: 8, borderRadius: 10, backgroundColor: t.divider },
  segBtn: { flex: 1, minHeight: 34, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  nav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 8, paddingBottom: 4 },
  navBtn: { width: 44, minHeight: 40, alignItems: "center", justifyContent: "center" },
  card: { marginHorizontal: 14, padding: 16, borderRadius: 14, backgroundColor: "#262629", flexDirection: "row", alignItems: "center", gap: 14 },
  list: { borderTopWidth: 1, borderTopColor: t.divider },
  row: { flexDirection: "row", alignItems: "center", gap: 12, height: 60, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: t.divider },
  emo: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  track: { height: 6, borderRadius: 3, backgroundColor: t.hairline, overflow: "hidden" },
  showLink: { marginTop: -10, height: 48, alignItems: "center", justifyContent: "center", borderBottomWidth: 1, borderBottomColor: t.divider },
});
