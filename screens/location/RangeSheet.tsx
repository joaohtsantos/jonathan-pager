// Custom range picker (design: LocRange). No native date picker is bundled, so
// From / To are typed as "YYYY-MM-DD HH:MM"; quick ranges cover the usual cases.
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { Sheet, T } from "../../components/ui";
import { fonts, t } from "../../theme";
import { fromLocalInput, toLocalInput } from "./format";

export function RangeSheet({ visible, from, to, onApply, onClose }: { visible: boolean; from: Date; to: Date; onApply: (from: Date, to: Date) => void; onClose: () => void }) {
  const [f, setF] = useState(toLocalInput(from));
  const [tt, setT] = useState(toLocalInput(to));
  useEffect(() => {
    if (visible) {
      setF(toLocalInput(from));
      setT(toLocalInput(to));
    }
  }, [visible, from, to]);
  const pf = fromLocalInput(f);
  const pt = fromLocalInput(tt);
  const valid = !!pf && !!pt && pt > pf;

  const quick = (label: string, make: () => [Date, Date]) => (
    <Pressable key={label} onPress={() => { const [a, b] = make(); onApply(a, b); }} style={({ pressed }) => [s.quick, pressed && { opacity: 0.7 }]}>
      <T size={14} color={t.white}>{label}</T>
    </Pressable>
  );
  const now = () => new Date();
  const ago = (d: number) => new Date(Date.now() - d * 86_400_000);

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 8, marginTop: -8, marginBottom: 14 }}>
        <Pressable onPress={onClose} style={s.navBtn}><T size={16} color={t.accent}>Cancel</T></Pressable>
        <T size={16} weight="700" style={{ flex: 1, textAlign: "center" }}>Range</T>
        <Pressable disabled={!valid} onPress={() => valid && onApply(pf!, pt!)} style={s.navBtn}><T size={16} weight="700" color={valid ? t.accent : t.faint}>Apply</T></Pressable>
      </View>
      <View style={{ borderTopWidth: 1, borderTopColor: t.divider }}>
        {[["From", f, setF, pf], ["To", tt, setT, pt]].map(([label, val, set, parsed]) => (
          <View key={label as string} style={s.field}>
            <T color="rgba(255,255,255,0.65)" style={{ width: 56 }}>{label as string}</T>
            <TextInput value={val as string} onChangeText={set as (v: string) => void} placeholder="YYYY-MM-DD HH:MM" placeholderTextColor={t.faint} autoCapitalize="none" autoCorrect={false} style={[s.input, !parsed && { color: t.danger }]} />
          </View>
        ))}
      </View>
      <View style={{ paddingHorizontal: 18, gap: 8, marginTop: 14 }}>
        <T size={12} weight="600" color={t.text3}>Quick ranges</T>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {quick("Last 24 hours", () => [new Date(Date.now() - 86_400_000), now()])}
          {quick("Last 7 days", () => [ago(7), now()])}
          {quick("Last 30 days", () => [ago(30), now()])}
          {quick("This year", () => [new Date(new Date().getFullYear(), 0, 1), now()])}
        </View>
      </View>
    </Sheet>
  );
}

const s = StyleSheet.create({
  navBtn: { minHeight: 44, paddingHorizontal: 10, justifyContent: "center" },
  field: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: t.divider },
  input: { flex: 1, color: t.white, fontSize: 15, fontFamily: fonts.mono, paddingVertical: 12 },
  quick: { flexBasis: "47%", flexGrow: 1, minHeight: 44, borderRadius: 10, backgroundColor: t.divider, alignItems: "center", justifyContent: "center" },
});
