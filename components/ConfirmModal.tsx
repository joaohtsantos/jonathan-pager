import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, fonts, spacing } from "../theme";

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

export default function ConfirmModal({
  visible,
  title,
  body,
  confirmLabel = "CONFIRM",
  cancelLabel = "CANCEL",
  onConfirm,
  onCancel,
  danger = false,
}: ConfirmModalProps) {
  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={styles.cardLeftBar} />
          <View style={styles.inner}>
            <Text style={styles.title}>{title}</Text>
            <View style={styles.divider} />
            <Text style={styles.body}>{body}</Text>
            <View style={styles.buttons}>
              <Pressable
                onPress={onCancel}
                style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
              >
                <Text style={styles.cancelText}>[ {cancelLabel} ]</Text>
              </Pressable>
              <Pressable
                onPress={onConfirm}
                style={({ pressed }) => [
                  styles.btn,
                  styles.confirmBtn,
                  pressed && styles.btnPressed,
                ]}
              >
                <Text
                  style={[
                    styles.confirmText,
                    danger ? { color: colors.urgent } : null,
                  ]}
                >
                  [ {confirmLabel} ]
                </Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  card: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderBright,
    minWidth: 280,
    maxWidth: 400,
  },
  cardLeftBar: {
    width: 3,
    backgroundColor: colors.accent,
  },
  inner: {
    flex: 1,
    padding: spacing.lg,
  },
  title: {
    color: colors.text,
    fontFamily: fonts.mono,
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 3,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
  body: {
    color: colors.textDim,
    fontFamily: fonts.mono,
    fontSize: 12,
    lineHeight: 18,
    marginBottom: spacing.lg,
  },
  buttons: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  btn: {
    flex: 1,
    paddingVertical: spacing.sm + 2,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.borderBright,
    backgroundColor: colors.bg,
  },
  btnPressed: {
    opacity: 0.6,
  },
  confirmBtn: {
    borderColor: colors.accent,
  },
  cancelText: {
    color: colors.textDim,
    fontFamily: fonts.mono,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.5,
  },
  confirmText: {
    color: colors.accent,
    fontFamily: fonts.mono,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.5,
  },
});
