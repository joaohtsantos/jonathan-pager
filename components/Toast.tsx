import { Animated, StyleSheet, Text, View } from "react-native";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, fonts, spacing } from "../theme";

interface ToastApi {
  show: (message: string, durationMs?: number) => void;
}

const ToastContext = createContext<ToastApi>({ show: () => {} });

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();
  // Sit above the tab bar (56px visual + bottom inset) with breathing room.
  const bottom = 56 + insets.bottom + 12;

  const show = useCallback(
    (msg: string, durationMs = 1500) => {
      setMessage(msg);
      opacity.stopAnimation();
      opacity.setValue(0);
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.delay(durationMs),
        Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (finished) setMessage(null);
      });
    },
    [opacity]
  );

  const api = useMemo(() => ({ show }), [show]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      opacity.stopAnimation();
    };
  }, [opacity]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {message !== null ? (
        <Animated.View pointerEvents="none" style={[styles.wrap, { opacity, bottom }]}>
          <View style={styles.toast}>
            <View style={styles.bar} />
            <Text style={styles.text}>{message}</Text>
          </View>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  toast: {
    flexDirection: "row",
    alignItems: "stretch",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderBright,
    minHeight: 36,
  },
  bar: {
    width: 3,
    backgroundColor: colors.accent,
  },
  text: {
    color: colors.text,
    fontFamily: fonts.mono,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 2,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
});
