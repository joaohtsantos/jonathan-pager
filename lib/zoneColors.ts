// Zone colors: client-side only, stored per zone id. Defaults by name; other
// zones take the next unused palette color. Transit / unknown are fixed.
import { useCallback, useMemo } from "react";
import { usePersisted } from "./usePersisted";
import type { Zone } from "../locationSetup";

export const TRANSIT_COLOR = "#8E8E93";
export const UNKNOWN_COLOR = "#48484A";
export const ZONE_PALETTE = ["#0A84FF", "#BF5AF2", "#30D158", "#64D2FF", "#FF9F0A", "#FF375F", "#FFD60A", "#5E5CE6", "#66D4CF", "#AC8E68"];

const BY_NAME: [RegExp, string][] = [
  [/home|casa/i, "#0A84FF"],
  [/office|escrit|work|kayro/i, "#BF5AF2"],
  [/gym|academia/i, "#30D158"],
  [/parent|pais|m[ãa]e|pai\b/i, "#64D2FF"],
];

export function defaultZoneColors(zones: Zone[], saved: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  const used = new Set<string>();
  for (const z of zones) {
    const c = saved[z.id] ?? BY_NAME.find(([re]) => re.test(z.name))?.[1];
    if (c && !used.has(c)) {
      out[z.id] = c;
      used.add(c);
    }
  }
  for (const z of zones) {
    if (out[z.id]) continue;
    const c = ZONE_PALETTE.find((p) => !used.has(p)) ?? ZONE_PALETTE[Object.keys(out).length % ZONE_PALETTE.length];
    out[z.id] = c;
    used.add(c);
  }
  return out;
}

export function useZoneColors(zones: Zone[]) {
  const [saved, setSaved] = usePersisted<Record<string, string>>("ui.zoneColors.v1", {});
  const colors = useMemo(() => defaultZoneColors(zones, saved), [zones, saved]);
  const setColor = useCallback((zoneId: string, color: string) => setSaved({ ...saved, [zoneId]: color }), [saved, setSaved]);
  const colorOf = useCallback(
    (seg: { kind?: string; zone_id?: string | null }) => (seg.kind === "transit" ? TRANSIT_COLOR : seg.zone_id && colors[seg.zone_id] ? colors[seg.zone_id] : UNKNOWN_COLOR),
    [colors]
  );
  return { colors, colorOf, setColor };
}
