// Shared inbox presentation: kind → icon/color/label, sender line.
import { View } from "react-native";
import { Feather } from "@expo/vector-icons";
import type { NotifyLook } from "../../porter/selectors";
import { IconTile, T, type FeatherName } from "../../components/ui";
import { t } from "../../theme";

export const LOOK: Record<NotifyLook, { icon: FeatherName; color: string; label: string }> = {
  permission: { icon: "shield", color: t.kindPermission, label: "Permission" },
  trust: { icon: "link", color: t.kindTrust, label: "Trust" },
  question: { icon: "help-circle", color: t.kindQuestion, label: "Question" },
  message: { icon: "bell", color: t.kindMessage, label: "Message" },
  camera: { icon: "video", color: t.kindCamera, label: "Camera" },
  high: { icon: "alert-triangle", color: t.kindHigh, label: "Alert · high priority" },
  answered: { icon: "check", color: t.kindAnswered, label: "Answered" },
};

export function KindIcon({ look, dim }: { look: NotifyLook; dim?: boolean }) {
  const l = LOOK[look];
  return <IconTile name={l.icon} color={l.color} dim={dim || look === "answered"} />;
}

/** "machine:agent" — machine in white first, agent in gray. */
export function Sender({ machine, agent, read, size = 12 }: { machine: string; agent?: string; read?: boolean; size?: number }) {
  return (
    <View style={{ flexDirection: "row", flexShrink: 1 }}>
      <T mono size={size} color={read ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.85)"} lines={1}>
        {machine}
      </T>
      {agent ? (
        <T mono size={size} color="rgba(255,255,255,0.45)" lines={1} style={{ flexShrink: 1 }}>
          :{agent}
        </T>
      ) : null}
    </View>
  );
}

/** Round selection checkbox shown left of rows in selection mode. */
export function SelectCircle({ on }: { on: boolean }) {
  return (
    <View
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      style={{ width: 22, height: 22, borderRadius: 11, borderWidth: on ? 0 : 1.5, borderColor: t.faint, backgroundColor: on ? t.accent : "transparent", alignItems: "center", justifyContent: "center" }}
    >
      {on ? <Feather name="check" size={14} color={t.white} /> : null}
    </View>
  );
}

/** Shown instead of a checkbox on rows that can't be bulk-selected (permission/trust asks). */
export function LockedCircle() {
  return (
    <View accessibilityLabel="Not selectable" style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderStyle: "dashed", borderColor: t.faint, alignItems: "center", justifyContent: "center" }}>
      <Feather name="lock" size={11} color={t.faint} />
    </View>
  );
}
