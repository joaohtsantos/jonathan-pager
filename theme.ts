import { Platform } from "react-native";

export const colors = {
  bg: "#0A0A0A",
  surface: "#141414",
  surfaceAlt: "#1A1A1A",
  divider: "#222",
  border: "#2A2A2A",
  borderBright: "#3A3A3A",
  text: "#E5E5E5",
  textDim: "#888",
  textFaint: "#555",
  accent: "#C2410C",  // deep orange — top bar, mark-all action, primary highlights
  urgent: "#C2410C",  // deep orange — the one category that gets the loud highlight
  alert: "#6B6B6B",   // mid gray — readable but quiet
  info: "#3A3A3A",    // darker gray — barely there
  ok: "#C2410C",      // deep orange (rare use; status text mostly carries it now)
  reject: "#6B6B6B",  // mid gray — defer if Requests reject needs more distinction

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
