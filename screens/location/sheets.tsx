// Location bottom sheets: AppRetcon ("Where were you?") and AppZoneEdit.
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { TimelineSegment, Zone } from "../../locationSetup";
import { MenuSheet, Sheet, T } from "../../components/ui";
import { ZONE_PALETTE } from "../../lib/zoneColors";
import { fonts, t } from "../../theme";
import { clock, fmtDur } from "./format";

export type EditingZone = Partial<Omit<Zone, "id">> & { id?: string; color?: string };

export function RetconSheet({ seg, zones, onPick, onClose }: { seg: TimelineSegment | null; zones: Zone[]; onPick: (target: { zone_id?: string | null; kind?: "unknown" | "transit" }) => void; onClose: () => void }) {
  return (
    <MenuSheet
      visible={!!seg}
      title="Where were you?"
      sub={seg ? `${clock(seg.from)} → ${seg.ongoing ? "now" : clock(seg.to)} · ${fmtDur(seg.duration_ms)} · now ${seg.label}` : undefined}
      onClose={onClose}
      options={[
        ...zones.map((z) => ({ key: z.id, label: z.name, emoji: z.emoji ?? "📍", onPress: () => onPick({ zone_id: z.id }) })),
        { key: "transit", label: "In transit", emoji: "🚗", color: t.dim, onPress: () => onPick({ kind: "transit" }) },
        { key: "unknown", label: "Unknown (untagged)", emoji: "❓", color: t.dim, onPress: () => onPick({ kind: "unknown" }) },
      ]}
    />
  );
}

export function ZoneEditSheet({
  editing,
  onChange,
  onSave,
  onCancel,
  onUseCurrent,
  onDelete,
}: {
  editing: EditingZone | null;
  onChange: (z: EditingZone) => void;
  onSave: () => void;
  onCancel: () => void;
  onUseCurrent: () => void;
  onDelete: () => void;
}) {
  const z = editing ?? {};
  const num = (v: string) => (v.trim() === "" || v === "-" ? undefined : parseFloat(v));
  return (
    <Sheet visible={!!editing} onClose={onCancel}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingBottom: 8, marginTop: -8 }}>
        <Pressable onPress={onCancel} style={s.navBtn}>
          <T size={16} color={t.accent}>Cancel</T>
        </Pressable>
        <T size={16} weight="700" style={{ flex: 1, textAlign: "center" }}>{z.id ? "Edit zone" : "New zone"}</T>
        <Pressable onPress={onSave} style={s.navBtn}>
          <T size={16} weight="700" color={t.accent}>Save</T>
        </Pressable>
      </View>
      <View style={{ borderTopWidth: 1, borderTopColor: t.hairline }}>
        <Field label="Name" value={z.name ?? ""} onChange={(v) => onChange({ ...z, name: v })} />
        <Field label="Emoji" value={z.emoji ?? ""} placeholder="📍" onChange={(v) => onChange({ ...z, emoji: v })} />
        <Field label="Latitude" mono value={z.lat?.toString() ?? ""} keyboard="numbers-and-punctuation" onChange={(v) => onChange({ ...z, lat: num(v) })} />
        <Field label="Longitude" mono value={z.lon?.toString() ?? ""} keyboard="numbers-and-punctuation" onChange={(v) => onChange({ ...z, lon: num(v) })} />
        <Field label="Radius (m)" mono value={z.radius?.toString() ?? ""} keyboard="number-pad" onChange={(v) => onChange({ ...z, radius: num(v) })} />
        <View style={[s.field, { gap: 10 }]}>
          <Text style={s.label}>Color</Text>
          <View style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 8, paddingVertical: 10 }}>
            {ZONE_PALETTE.map((c) => (
              <Pressable key={c} accessibilityLabel={`Color ${c}`} onPress={() => onChange({ ...z, color: c })} style={[s.swatch, { backgroundColor: c }, z.color === c && { borderColor: t.white, borderWidth: 2 }]} />
            ))}
          </View>
        </View>
      </View>
      <Pressable onPress={onUseCurrent} style={({ pressed }) => [s.wide, { backgroundColor: "rgba(10,132,255,0.16)" }, pressed && { opacity: 0.7 }]}>
        <T size={15} weight="600" color={t.accent}>Use current location</T>
      </Pressable>
      {z.id ? (
        <Pressable onPress={onDelete} style={({ pressed }) => [s.wide, { marginTop: 10 }, pressed && { opacity: 0.7 }]}>
          <T size={15} weight="600" color={t.danger}>Delete zone</T>
        </Pressable>
      ) : null}
    </Sheet>
  );
}

function Field({ label, value, onChange, mono, keyboard, placeholder }: { label: string; value: string; onChange: (v: string) => void; mono?: boolean; keyboard?: "default" | "number-pad" | "numbers-and-punctuation"; placeholder?: string }) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType={keyboard ?? "default"}
        placeholder={placeholder}
        placeholderTextColor={t.faint}
        autoCapitalize="none"
        autoCorrect={false}
        style={[s.input, mono && { fontFamily: fonts.mono }]}
      />
    </View>
  );
}

const s = StyleSheet.create({
  navBtn: { minHeight: 44, paddingHorizontal: 10, justifyContent: "center" },
  field: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: t.hairline },
  label: { width: 96, fontSize: 14, color: t.dim },
  input: { flex: 1, color: t.text, fontSize: 15, paddingVertical: 12 },
  swatch: { width: 26, height: 26, borderRadius: 13 },
  wide: { marginTop: 14, marginHorizontal: 18, minHeight: 44, borderRadius: 10, alignItems: "center", justifyContent: "center" },
});
