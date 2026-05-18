import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState, Platform } from "react-native";
import * as Location from "expo-location";
import {
  type Zone,
  type CurrentLocation,
  locationApi,
  syncGeofences,
  startBackgroundLocation,
  stopAllLocation,
  getPermissionState,
  ensureResyncTaskRegistered,
} from "./locationSetup";

type PermStatus = Location.PermissionStatus;

interface LocationContextValue {
  // Permissions
  foreground: PermStatus;
  background: PermStatus;
  requestForeground: () => Promise<void>;
  requestBackground: () => Promise<void>;
  refreshPermissions: () => Promise<void>;
  // Zones
  zones: Zone[];
  zonesLoading: boolean;
  zonesError: string | null;
  refreshZones: () => Promise<void>;
  createZone: (z: Omit<Zone, "id">) => Promise<void>;
  updateZone: (id: string, patch: Partial<Omit<Zone, "id">>) => Promise<void>;
  deleteZone: (id: string) => Promise<void>;
  // Current state
  current: CurrentLocation | null;
  currentError: string | null;
  refreshCurrent: () => Promise<void>;
  // Tracking control
  tracking: boolean;
  startTracking: () => Promise<void>;
  stopTracking: () => Promise<void>;
}

const ctx = createContext<LocationContextValue | null>(null);

export function useLocation(): LocationContextValue {
  const v = useContext(ctx);
  if (!v) throw new Error("useLocation must be used within LocationProvider");
  return v;
}

export function LocationProvider({ children }: { children: ReactNode }) {
  const [foreground, setForeground] = useState<PermStatus>(
    Location.PermissionStatus.UNDETERMINED
  );
  const [background, setBackground] = useState<PermStatus>(
    Location.PermissionStatus.UNDETERMINED
  );
  const [zones, setZones] = useState<Zone[]>([]);
  const [zonesLoading, setZonesLoading] = useState(false);
  const [zonesError, setZonesError] = useState<string | null>(null);
  const [current, setCurrent] = useState<CurrentLocation | null>(null);
  const [currentError, setCurrentError] = useState<string | null>(null);
  const [tracking, setTracking] = useState(false);

  const refreshPermissions = useCallback(async () => {
    const { foreground: fg, background: bg } = await getPermissionState();
    setForeground(fg);
    setBackground(bg);
  }, []);

  const requestForeground = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    setForeground(status);
  }, []);

  const requestBackground = useCallback(async () => {
    const { status } = await Location.requestBackgroundPermissionsAsync();
    setBackground(status);
  }, []);

  const refreshZones = useCallback(async () => {
    setZonesLoading(true);
    setZonesError(null);
    try {
      const list = await locationApi.listZones();
      setZones(list);
    } catch (err) {
      setZonesError(err instanceof Error ? err.message : String(err));
    } finally {
      setZonesLoading(false);
    }
  }, []);

  const refreshCurrent = useCallback(async () => {
    setCurrentError(null);
    try {
      const c = await locationApi.current();
      setCurrent(c);
    } catch (err) {
      setCurrentError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const createZone = useCallback(
    async (z: Omit<Zone, "id">) => {
      await locationApi.createZone(z);
      await refreshZones();
    },
    [refreshZones]
  );

  const updateZone = useCallback(
    async (id: string, patch: Partial<Omit<Zone, "id">>) => {
      await locationApi.updateZone(id, patch);
      await refreshZones();
    },
    [refreshZones]
  );

  const deleteZone = useCallback(
    async (id: string) => {
      await locationApi.deleteZone(id);
      await refreshZones();
    },
    [refreshZones]
  );

  // Re-sync OS geofences whenever the zones list changes (and we have permission).
  const lastSyncKey = useRef<string>("");
  useEffect(() => {
    const key = zones.map(z => `${z.id}:${z.lat}:${z.lon}:${z.radius}`).sort().join("|");
    if (key === lastSyncKey.current) return;
    if (background !== Location.PermissionStatus.GRANTED) return;
    lastSyncKey.current = key;
    syncGeofences(zones).catch(err => console.error("syncGeofences failed", err));
  }, [zones, background]);

  const startTracking = useCallback(async () => {
    if (background !== Location.PermissionStatus.GRANTED) return;
    await syncGeofences(zones);
    if (Platform.OS === "android") {
      await startBackgroundLocation().catch(err => console.error("startBg failed", err));
    }
    setTracking(true);
  }, [zones, background]);

  const stopTracking = useCallback(async () => {
    await stopAllLocation();
    setTracking(false);
  }, []);

  // Bootstrap: check permissions, load zones + current, schedule the
  // periodic resync task (Android WorkManager — survives reboot).
  useEffect(() => {
    refreshPermissions();
    refreshZones();
    refreshCurrent();
    ensureResyncTaskRegistered().catch(err =>
      console.error("ensureResyncTaskRegistered failed", err)
    );
  }, [refreshPermissions, refreshZones, refreshCurrent]);

  // Re-check permissions when the app returns to foreground (user may have
  // toggled them in Settings).
  useEffect(() => {
    const sub = AppState.addEventListener("change", state => {
      if (state === "active") {
        refreshPermissions();
        refreshCurrent();
      }
    });
    return () => sub.remove();
  }, [refreshPermissions, refreshCurrent]);

  // Auto-start tracking once we have background permission + at least one zone.
  useEffect(() => {
    if (background === Location.PermissionStatus.GRANTED && zones.length > 0 && !tracking) {
      startTracking().catch(err => console.error("auto startTracking failed", err));
    }
  }, [background, zones.length, tracking, startTracking]);

  return (
    <ctx.Provider
      value={{
        foreground,
        background,
        requestForeground,
        requestBackground,
        refreshPermissions,
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
        startTracking,
        stopTracking,
      }}
    >
      {children}
    </ctx.Provider>
  );
}
