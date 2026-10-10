import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { t } from "../theme";

interface ConfirmModalProps {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
}

/** Centered confirm dialog (alert style). */
export default function ConfirmModal({ visible, title, body, confirmLabel = "Confirm", cancelLabel = "Cancel", onConfirm, onCancel, danger = false }: ConfirmModalProps) {
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={styles.inner}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.body}>{body}</Text>
          </View>
          <View style={styles.buttons}>
            <Pressable onPress={onCancel} style={({ pressed }) => [styles.btn, pressed && styles.pressed]}>
              <Text style={styles.cancelText}>{cancelLabel}</Text>
            </Pressable>
            <View style={styles.sep} />
            <Pressable onPress={onConfirm} style={({ pressed }) => [styles.btn, pressed && styles.pressed]}>
              <Text style={[styles.confirmText, danger && { color: t.danger }]}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: t.backdrop, alignItems: "center", justifyContent: "center", padding: 40 },
  card: { width: "100%", maxWidth: 320, backgroundColor: t.sheet, borderRadius: 14, overflow: "hidden" },
  inner: { padding: 18, gap: 6, alignItems: "center" },
  title: { color: t.white, fontSize: 17, fontWeight: "700", textAlign: "center" },
  body: { color: t.dim, fontSize: 14, lineHeight: 19, textAlign: "center" },
  buttons: { flexDirection: "row", borderTopWidth: 1, borderTopColor: t.divider },
  btn: { flex: 1, minHeight: 46, alignItems: "center", justifyContent: "center" },
  pressed: { backgroundColor: t.fill },
  sep: { width: 1, backgroundColor: t.divider },
  cancelText: { color: t.accent, fontSize: 16 },
  confirmText: { color: t.accent, fontSize: 16, fontWeight: "700" },
});
