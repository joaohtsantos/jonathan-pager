import { Image } from "react-native";

/** The app icon (assets/icon.png, rendered from the logo SVG). */
export function Logo({ size = 72 }: { size?: number }) {
  return <Image source={require("../../assets/icon.png")} style={{ width: size, height: size }} accessibilityLabel="Monitor" />;
}
