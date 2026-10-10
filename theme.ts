import { Platform } from "react-native";

// Design tokens (Pager UI, 2026-10). System font everywhere; monospace for
// agent / machine names, times and commands. Inbox sits on a slightly darker bg.
export const t = {
  bg: "#1C1C1E",
  bgInbox: "#161618",
  raised: "#222225", // Inbox "waiting on you" cards
  sheet: "#2C2C2E", // bottom sheets, menus
  tabBar: "#232325",
  backdrop: "rgba(0,0,0,0.6)",

  text: "rgba(255,255,255,0.92)",
  text2: "rgba(255,255,255,0.72)",
  text3: "rgba(255,255,255,0.5)",
  dim: "rgba(255,255,255,0.55)",
  faint: "rgba(255,255,255,0.35)",
  white: "#FFFFFF",

  divider: "rgba(255,255,255,0.08)",
  hairline: "rgba(255,255,255,0.06)",
  fill: "rgba(255,255,255,0.06)",
  fill2: "rgba(255,255,255,0.12)",

  running: "#32D74B",
  needs: "#FF9F0A",
  done: "#8E8E93",
  accent: "#0A84FF",
  danger: "#FF6961",

  // Inbox kind icons
  kindPermission: "#0A84FF",
  kindTrust: "#BF5AF2",
  kindQuestion: "#64D2FF",
  kindMessage: "#E5E5EA",
  kindCamera: "#30D158",
  kindHigh: "#FF453A",
  kindAnswered: "#8E8E93",
};

/** Legacy keys still read by the pre-redesign screens (Push log, Requests, Settings). */
export const colors = {
  bg: t.bg,
  surface: t.tabBar,
  surfaceAlt: t.sheet,
  divider: t.hairline,
  border: t.divider,
  borderBright: "rgba(255,255,255,0.16)",
  text: t.text,
  textDim: t.dim,
  textFaint: t.faint,
  accent: t.accent,
  urgent: t.needs,
  alert: "#8E8E93",
  info: "#48484A",
  ok: t.running,
  reject: "#8E8E93",
};

export const fonts = {
  mono: Platform.select({ android: "monospace", default: "Courier" }) as string,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
};
