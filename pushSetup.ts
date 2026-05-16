import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Platform } from "react-native";
import { colors } from "./theme";

// Foreground display behavior — runs once at module load.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function setupChannels() {
  if (Platform.OS !== "android") return;

  await Notifications.setNotificationChannelAsync("urgent", {
    name: "Urgent",
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 500, 200, 500, 200, 500],
    lightColor: colors.urgent,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });

  await Notifications.setNotificationChannelAsync("alert", {
    name: "Alert",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 400, 200, 400],
    lightColor: colors.alert,
  });

  await Notifications.setNotificationChannelAsync("info", {
    name: "Info",
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 200],
    lightColor: colors.info,
  });
}

export async function registerForPush(): Promise<string> {
  if (!Device.isDevice) {
    throw new Error("Push notifications require a physical device");
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    throw new Error(`Permission not granted (status: ${finalStatus})`);
  }

  const tokenData = await Notifications.getExpoPushTokenAsync({
    projectId: "00f38f4e-21a0-43da-b440-20c6a09679a4",
  });
  return tokenData.data;
}
