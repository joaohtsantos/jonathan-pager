// Location formatting + period math (Day / Week / Month / Custom).
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const clock = (iso: string | number) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/** 39m · 3h 47m · 118h 10m (hours never roll into days: totals read better). */
export function fmtDur(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m`;
}

export function sinceText(iso: string | null | undefined): string {
  if (!iso) return "—";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  return h < 24 ? `${h}h ${mins % 60}m ago` : `${Math.floor(h / 24)}d ago`;
}

export const dayName = (d: Date) => `${WD[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`;
const short = (d: Date) => `${d.getDate()} ${MON[d.getMonth()]}`;

export type Period = "day" | "week" | "month" | "custom";
export interface Range {
  from: Date;
  to: Date;
  label: string;
  /** "7 days", "October so far" … for the By place header. */
  meta?: string;
}

export function periodRange(p: Exclude<Period, "custom">, offset: number, now = new Date()): Range {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  if (p === "day") {
    const from = new Date(midnight);
    from.setDate(from.getDate() - offset);
    const to = new Date(from);
    to.setDate(to.getDate() + 1);
    const label = offset === 0 ? `Today · ${dayName(from)}` : offset === 1 ? `Yesterday · ${dayName(from)}` : dayName(from);
    return { from, to: to > now ? now : to, label };
  }
  if (p === "week") {
    // Seven days ending today (the server's "week" shortcut too), stepped by 7.
    const to = new Date(midnight);
    to.setDate(to.getDate() + 1 - offset * 7);
    const from = new Date(to);
    from.setDate(from.getDate() - 7);
    const last = new Date(to.getTime() - 1);
    const span = from.getMonth() === last.getMonth() ? `${from.getDate()}–${short(last)}` : `${short(from)}–${short(last)}`;
    return { from, to: to > now ? now : to, label: offset === 0 ? `This week · ${span}` : span, meta: "7 days" };
  }
  const from = new Date(midnight.getFullYear(), midnight.getMonth() - offset, 1);
  const to = new Date(from.getFullYear(), from.getMonth() + 1, 1);
  return { from, to: to > now ? now : to, label: `${MONTH[from.getMonth()]} ${from.getFullYear()}`, meta: offset === 0 ? `${MONTH[from.getMonth()]} so far` : MONTH[from.getMonth()] };
}

export function customLabel(from: Date, to: Date, now = new Date()): string {
  const f = `${short(from)} ${clock(from.getTime())}`;
  const tt = Math.abs(now.getTime() - to.getTime()) < 120_000 ? `${short(to)} now` : `${short(to)} ${clock(to.getTime())}`;
  return `${f} → ${tt}`;
}

export function daysIn(from: Date, to: Date) {
  const d = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000));
  return `${d} day${d === 1 ? "" : "s"}`;
}

/** "2026-09-28 00:00" ⇄ Date (local). */
export const toLocalInput = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${clock(d.getTime())}`;
export function fromLocalInput(s: string): Date | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(s.trim());
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
  return Number.isNaN(d.getTime()) ? null : d;
}
