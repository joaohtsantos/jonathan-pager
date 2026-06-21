import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import * as BackgroundTask from "expo-background-task";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_BASE_URL, API_KEY } from "./constants";

// Per-region last-forwarded state. On every app/OS relaunch, Expo re-reports the
// initial state of EVERY region (enter the one you're in, exit each one you're
// not) — not just real transitions. We persist the last state we forwarded per
// region and only POST when it changes, killing the phantom burst at the source.
const GEO_STATE_PREFIX = "pager-geo-state:";

export const GEOFENCING_TASK = "pager-geofencing";
export const BG_LOCATION_TASK = "pager-bg-location";
export const RESYNC_TASK = "pager-resync-geofences";

export type Zone = {
  id: string;
  name: string;
  emoji: string | null;
  lat: number;
  lon: number;
  radius: number;
};

export type CurrentLocation = {
  in_zone: boolean;
  zone_id?: string;
  zone?: string | null;
  emoji?: string | null;
  since?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  last_ping?: string | null;
};

export type HistoryInterval = {
  zone_id: string;
  zone_name: string | null;
  from: string;
  to: string | null;
  duration_ms: number | null;
};

export type TimelineSegment = {
  kind: "zone" | "untagged";
  zone_id: string | null;
  label: string;
  emoji: string | null;
  from: string;
  to: string;
  duration_ms: number;
  ongoing: boolean;
  neighborhood?: string | null;
  city?: string | null;
  lat?: number | null;
  lon?: number | null;
  corrected?: boolean;
};

// ============================================================================
// API client
// ============================================================================

function authHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${API_KEY}`,
  };
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers ?? {}) },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`${resp.status} ${path}: ${text.slice(0, 200)}`);
  }
  return resp.json() as Promise<T>;
}

export const locationApi = {
  listZones: () => apiFetch<Zone[]>("/location/zones"),
  createZone: (body: Omit<Zone, "id">) =>
    apiFetch<Zone>("/location/zones", { method: "POST", body: JSON.stringify(body) }),
  updateZone: (id: string, body: Partial<Omit<Zone, "id">>) =>
    apiFetch<Zone>(`/location/zones/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteZone: (id: string) =>
    apiFetch<{ ok: true }>(`/location/zones/${id}`, { method: "DELETE" }),
  current: () => apiFetch<CurrentLocation>("/location/current"),
  history: (from?: string, to?: string) => {
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    const q = qs.toString();
    return apiFetch<{ intervals: HistoryInterval[] }>(
      `/location/history${q ? `?${q}` : ""}`
    );
  },
  timeline: (before?: string, limit = 30) => {
    const qs = new URLSearchParams();
    qs.set("limit", String(limit));
    if (before) qs.set("before", before);
    return apiFetch<{ segments: TimelineSegment[]; next_before: string | null }>(
      `/location/timeline?${qs.toString()}`
    );
  },
  // Retcon a time span to a zone (zoneId) or to Unknown (zoneId = null).
  createOverride: (from: string, to: string, zoneId: string | null) =>
    apiFetch<{ id: string }>("/location/overrides", {
      method: "POST",
      body: JSON.stringify({ from, to, zone_id: zoneId }),
    }),
};

// ============================================================================
// Task definitions — registered once at module load, run in headless JS context.
// ============================================================================

type GeofenceTaskData = {
  data: {
    eventType: Location.GeofencingEventType;
    region: Location.LocationRegion;
  };
  error: TaskManager.TaskManagerError | null;
};

// On a real geofence transition, also POST a one-shot GPS fix. Geofence events
// alone leave the server guessing the neighbourhood; a real coordinate at the
// transition lets the backend lock the move to the exact zone + time (and the
// new ping anchors presence even if "significant change" goes quiet afterward).
async function postConfirmingPing(): Promise<void> {
  try {
    let pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null);
    if (!pos) pos = await Location.getLastKnownPositionAsync();
    if (!pos) return;
    await fetch(`${API_BASE_URL}/location/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        timestamp: new Date(pos.timestamp || Date.now()).toISOString(),
      }),
    });
  } catch (err) {
    console.error("[geofence] confirming ping failed", err);
  }
}

TaskManager.defineTask(GEOFENCING_TASK, async ({ data, error }: GeofenceTaskData) => {
  if (error) {
    console.error("[geofence] task error", error.message);
    return;
  }
  const { eventType, region } = data;
  const type = eventType === Location.GeofencingEventType.Enter ? "enter" : "exit";

  // Suppress non-transitions (the relaunch initial-state burst): only forward
  // when this region's state actually changed since we last reported it.
  const stateKey = `${GEO_STATE_PREFIX}${region.identifier}`;
  try {
    const last = await AsyncStorage.getItem(stateKey);
    if (last === type) return;
    await AsyncStorage.setItem(stateKey, type);
  } catch (err) {
    console.error("[geofence] state read/write failed", err);
    // fall through and forward anyway — the server guard is the backstop
  }

  try {
    await fetch(`${API_BASE_URL}/location/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({
        type,
        zoneId: region.identifier,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch (err) {
    console.error("[geofence] post failed", err);
  }

  // Anchor the transition with a real coordinate.
  await postConfirmingPing();
});

type LocationTaskData = {
  data: { locations: Location.LocationObject[] };
  error: TaskManager.TaskManagerError | null;
};

TaskManager.defineTask(BG_LOCATION_TASK, async ({ data, error }: LocationTaskData) => {
  if (error) {
    console.error("[bg-location] task error", error.message);
    return;
  }
  const loc = data.locations?.[0];
  if (!loc) return;
  try {
    await fetch(`${API_BASE_URL}/location/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({
        lat: loc.coords.latitude,
        lon: loc.coords.longitude,
        accuracy: loc.coords.accuracy,
        timestamp: new Date(loc.timestamp).toISOString(),
      }),
    });
  } catch (err) {
    console.error("[bg-location] post failed", err);
  }
});

// Periodic resync — Android maps this to WorkManager, which survives reboot.
// After a phone restart, this task runs within ~15-60 min and brings geofences
// back from /location/zones without needing the app to be opened.
TaskManager.defineTask(RESYNC_TASK, async () => {
  try {
    const resp = await fetch(`${API_BASE_URL}/location/zones`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    if (!resp.ok) {
      console.error("[resync] fetch zones failed", resp.status);
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
    const zones = (await resp.json()) as Zone[];
    await syncGeofences(zones);
    console.log(`[resync] re-registered ${zones.length} geofence(s)`);
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (err) {
    console.error("[resync] failed", err);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

// ============================================================================
// Start/stop helpers
// ============================================================================

export async function syncGeofences(zones: Zone[]): Promise<void> {
  const running = await Location.hasStartedGeofencingAsync(GEOFENCING_TASK).catch(() => false);
  if (running) {
    await Location.stopGeofencingAsync(GEOFENCING_TASK).catch(() => undefined);
  }
  if (zones.length === 0) return;
  await Location.startGeofencingAsync(
    GEOFENCING_TASK,
    zones.map(z => ({
      identifier: z.id,
      latitude: z.lat,
      longitude: z.lon,
      radius: z.radius,
      notifyOnEnter: true,
      notifyOnExit: true,
    }))
  );
}

export async function startBackgroundLocation(): Promise<void> {
  const running = await Location.hasStartedLocationUpdatesAsync(BG_LOCATION_TASK).catch(() => false);
  if (running) return;
  await Location.startLocationUpdatesAsync(BG_LOCATION_TASK, {
    accuracy: Location.Accuracy.Balanced,
    distanceInterval: 500,
    deferredUpdatesInterval: 15 * 60 * 1000,
    showsBackgroundLocationIndicator: false,
    foregroundService: {
      notificationTitle: "Pager — location",
      notificationBody: "Tracking your zone presence",
      notificationColor: "#C2410C",
    },
  });
}

export async function stopAllLocation(): Promise<void> {
  const geo = await Location.hasStartedGeofencingAsync(GEOFENCING_TASK).catch(() => false);
  if (geo) await Location.stopGeofencingAsync(GEOFENCING_TASK).catch(() => undefined);
  const bg = await Location.hasStartedLocationUpdatesAsync(BG_LOCATION_TASK).catch(() => false);
  if (bg) await Location.stopLocationUpdatesAsync(BG_LOCATION_TASK).catch(() => undefined);
}

// Idempotent — re-registers the periodic resync if it's not already scheduled.
// Minimum interval the OS will honour: ~15 min on Android (WorkManager).
export async function ensureResyncTaskRegistered(): Promise<void> {
  const status = await BackgroundTask.getStatusAsync();
  if (status === BackgroundTask.BackgroundTaskStatus.Restricted) {
    console.warn("[resync] background tasks restricted on this device");
    return;
  }
  const already = await TaskManager.isTaskRegisteredAsync(RESYNC_TASK).catch(() => false);
  if (already) return;
  await BackgroundTask.registerTaskAsync(RESYNC_TASK, {
    minimumInterval: 60, // minutes
  });
}

export async function getPermissionState(): Promise<{
  foreground: Location.PermissionStatus;
  background: Location.PermissionStatus;
}> {
  const fg = await Location.getForegroundPermissionsAsync();
  const bg = await Location.getBackgroundPermissionsAsync();
  return { foreground: fg.status, background: bg.status };
}
