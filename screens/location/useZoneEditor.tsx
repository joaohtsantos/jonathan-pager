// Zone create / edit / delete (AppZoneEdit sheet + delete confirm), shared by
// the Location and Zones screens.
import { useState } from "react";
import { Alert } from "react-native";
import * as Location from "expo-location";
import { useLocation } from "../../locationContext";
import type { Zone } from "../../locationSetup";
import ConfirmModal from "../../components/ConfirmModal";
import { useZoneColors } from "../../lib/zoneColors";
import { ZoneEditSheet, type EditingZone } from "./sheets";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function useZoneEditor(onChanged?: () => void) {
  const { zones, createZone, updateZone, deleteZone } = useLocation();
  const { colors, setColor } = useZoneColors(zones);
  const [editing, setEditing] = useState<EditingZone | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Zone | null>(null);

  const open = (z?: Partial<EditingZone>) => setEditing({ radius: 100, ...(z ?? {}), color: z?.id ? colors[z.id] : z?.color });

  const useCurrent = async () => {
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setEditing((p) => ({ ...(p ?? {}), lat: Number(loc.coords.latitude.toFixed(6)), lon: Number(loc.coords.longitude.toFixed(6)) }));
    } catch (e) {
      Alert.alert("Couldn't get current location", errText(e));
    }
  };

  const save = async () => {
    if (!editing) return;
    const { name, emoji, lat, lon, radius, id, color } = editing;
    if (!name || typeof lat !== "number" || Number.isNaN(lat) || typeof lon !== "number" || Number.isNaN(lon) || typeof radius !== "number" || Number.isNaN(radius)) {
      Alert.alert("Missing fields", "Name, latitude, longitude and radius are required.");
      return;
    }
    try {
      if (id) {
        await updateZone(id, { name, emoji: emoji || null, lat, lon, radius });
        if (color) setColor(id, color);
      } else {
        await createZone({ name, emoji: emoji || null, lat, lon, radius });
        // The new id is only known after the context refreshes; match by name.
      }
      setEditing(null);
      onChanged?.();
    } catch (e) {
      Alert.alert("Save failed", errText(e));
    }
  };

  const element = (
    <>
      <ZoneEditSheet
        editing={editing}
        onChange={setEditing}
        onSave={save}
        onCancel={() => setEditing(null)}
        onUseCurrent={useCurrent}
        onDelete={() => {
          const z = zones.find((x) => x.id === editing?.id);
          if (z) setPendingDelete(z);
        }}
      />
      <ConfirmModal
        visible={pendingDelete !== null}
        title="Delete zone"
        body={`Remove "${pendingDelete?.name ?? ""}"? Geofence will stop firing for this location.`}
        confirmLabel="Delete"
        danger
        onCancel={() => setPendingDelete(null)}
        onConfirm={async () => {
          const z = pendingDelete;
          setPendingDelete(null);
          setEditing(null);
          if (!z) return;
          try {
            await deleteZone(z.id);
            onChanged?.();
          } catch (e) {
            Alert.alert("Delete failed", errText(e));
          }
        }}
      />
    </>
  );

  return { open, askDelete: setPendingDelete, element, colors };
}
