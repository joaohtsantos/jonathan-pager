// Zones (design: LocZones): list, + to add, tap to edit, long-press to delete.
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { useLocation } from "../../locationContext";
import { BackHeader, Chevron, PageTitle, Screen, T, alpha } from "../../components/ui";
import { useZoneEditor } from "./useZoneEditor";
import { t } from "../../theme";

export default function ZonesScreen() {
  const nav = useNavigation();
  const { zones, zonesLoading, zonesError } = useLocation();
  const editor = useZoneEditor();

  return (
    <Screen>
      <BackHeader
        label="Location"
        onBack={() => nav.goBack()}
        right={
          <Pressable accessibilityLabel="Add zone" onPress={() => editor.open()} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
            <Feather name="plus" size={24} color={t.accent} />
          </Pressable>
        }
      />
      <PageTitle title="Zones" />
      <ScrollView contentContainerStyle={{ gap: 14, paddingBottom: 20 }}>
        {zonesError ? <T size={12} color={t.danger} style={{ marginHorizontal: 20 }}>{zonesError}</T> : null}
        <View style={{ borderTopWidth: 1, borderTopColor: t.divider }}>
          {zonesLoading && !zones.length ? <T size={13} color={t.faint} style={{ padding: 18 }}>Loading…</T> : null}
          {!zonesLoading && !zones.length ? <T size={13} color={t.faint} style={{ padding: 18 }}>No zones yet. Tap + to add one.</T> : null}
          {zones.map((z) => (
            <Pressable key={z.id} onPress={() => editor.open(z)} onLongPress={() => editor.askDelete(z)} style={({ pressed }) => [s.row, pressed && { backgroundColor: t.fill }]}>
              <View style={[s.emo, { backgroundColor: alpha(editor.colors[z.id] ?? "#48484A", 0.18) }]}>
                <Text style={{ fontSize: 15 }}>{z.emoji ?? "📍"}</Text>
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <T size={15} weight="500">{z.name}</T>
                <T mono size={12} color={t.text3}>{z.lat.toFixed(4)}, {z.lon.toFixed(4)} · r={Math.round(z.radius)}m</T>
              </View>
              <Chevron />
            </Pressable>
          ))}
        </View>
        <T size={13} color={t.text3} style={{ marginHorizontal: 20 }}>Long-press a zone to delete it.</T>
      </ScrollView>
      {editor.element}
    </Screen>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, height: 60, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: t.divider },
  emo: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
});
