// Settings › Notifications (design: NotifSettings): one Android channel per
// kind. The switch is the app-level on/off; the level text opens the channel's
// system settings (sound, pop-up, Do Not Disturb).
import { useCallback, useState } from "react";
import { Linking, Platform, Pressable, ScrollView, View } from "react-native";
import Constants from "expo-constants";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { CHANNELS, CHANNEL_ORDER, channelLevel, getChannelsOff, setChannelOff, type ChannelKey } from "../../porter/notify";
import { BackHeader, PageTitle, Screen, T, Toggle } from "../../components/ui";
import { t } from "../../theme";

const PACKAGE = (Constants.expoConfig?.android?.package as string | undefined) ?? "cc.jsplayground.pager";

function openChannelSettings(channelId: string) {
  if (Platform.OS !== "android") return void Linking.openSettings();
  Linking.sendIntent("android.settings.CHANNEL_NOTIFICATION_SETTINGS", [
    { key: "android.provider.extra.APP_PACKAGE", value: PACKAGE },
    { key: "android.provider.extra.CHANNEL_ID", value: channelId },
  ]).catch(() => Linking.openSettings());
}

export default function NotificationSettingsScreen() {
  const nav = useNavigation();
  const [off, setOff] = useState<Partial<Record<ChannelKey, true>>>({});
  const [levels, setLevels] = useState<Partial<Record<ChannelKey, string>>>({});

  // Re-read on focus: the user may come back from the system channel screen.
  useFocusEffect(
    useCallback(() => {
      void getChannelsOff().then(setOff);
      void Promise.all(CHANNEL_ORDER.map(async (k) => [k, await channelLevel(k)] as const)).then((e) => setLevels(Object.fromEntries(e)));
    }, [])
  );

  const toggle = async (k: ChannelKey, on: boolean) => {
    await setChannelOff(k, !on);
    setOff(await getChannelsOff());
  };

  return (
    <Screen>
      <BackHeader label="Settings" onBack={() => nav.goBack()} />
      <PageTitle title="Notifications" />
      <ScrollView contentContainerStyle={{ paddingBottom: 20 }}>
        <T size={13} color={t.dim} style={{ marginHorizontal: 20, marginBottom: 16, lineHeight: 19 }}>
          Each kind is its own Android channel, so the watch and Do Not Disturb can treat them differently.
        </T>
        <View style={{ borderTopWidth: 1, borderTopColor: t.divider }}>
          {CHANNEL_ORDER.map((k) => (
            <View key={k} style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 64, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: t.divider }}>
              <View style={{ flex: 1, gap: 3 }}>
                <T size={15} color={t.white}>{CHANNELS[k].name}</T>
                <T size={12} color={t.dim}>{CHANNELS[k].desc}</T>
              </View>
              <Pressable onPress={() => openChannelSettings(CHANNELS[k].id)} hitSlop={8}>
                <T size={13} color="rgba(255,255,255,0.75)">{levels[k] || "System ›"}</T>
              </Pressable>
              <Toggle value={!off[k]} onChange={(v) => void toggle(k, v)} />
            </View>
          ))}
        </View>
        <T size={13} color={t.dim} style={{ marginHorizontal: 20, marginTop: 14, lineHeight: 19 }}>
          Muted senders never notify. Questions from muted senders still do.
        </T>
      </ScrollView>
    </Screen>
  );
}
