import { useEffect, useState } from "react";
import { DarkTheme, NavigationContainer } from "@react-navigation/native";
import { View } from "react-native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator, type NativeStackNavigationOptions } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import { Feather } from "@expo/vector-icons";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import LocationScreen from "./screens/location/LocationScreen";
import ZonesScreen from "./screens/location/ZonesScreen";
import AgentsScreen from "./screens/agents/AgentsScreen";
import AgentDetailScreen from "./screens/agents/AgentDetailScreen";
import GraveyardScreen from "./screens/agents/GraveyardScreen";
import InboxScreen from "./screens/inbox/InboxScreen";
import InboxItemScreen from "./screens/inbox/InboxItemScreen";
import PagerItemScreen from "./screens/inbox/PagerItemScreen";
import MachinesScreen from "./screens/machines/MachinesScreen";
import MachineDetailScreen from "./screens/machines/MachineDetailScreen";
import PairScreen from "./screens/machines/PairScreen";
import MachinesSettingsScreen from "./screens/machines/MachinesSettingsScreen";
import SendersScreen from "./screens/inbox/SendersScreen";
import type { AgentsStackParamList, InboxStackParamList, LocationStackParamList, MachinesStackParamList } from "./navigation/types";
import { TokenProvider } from "./tokenContext";
import { navigateTo, navigationRef } from "./navigationRef";
import { LocationProvider } from "./locationContext";
import { ToastProvider } from "./components/Toast";
import { PorterProvider, usePorter } from "./porter/PorterProvider";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Onboarding from "./screens/onboarding/Onboarding";
import { ACTION } from "./porter/notify";
import { handleNotificationAction } from "./porter/runtime";
import NotificationSettingsScreen from "./screens/machines/NotificationSettingsScreen";
import { colors, t } from "./theme";

const Tab = createBottomTabNavigator();
const AgentsStack = createNativeStackNavigator<AgentsStackParamList>();
const InboxStack = createNativeStackNavigator<InboxStackParamList>();
const MachinesStack = createNativeStackNavigator<MachinesStackParamList>();
const LocationStack = createNativeStackNavigator<LocationStackParamList>();

const stackOptions: NativeStackNavigationOptions = {
  headerShown: false,
  contentStyle: { backgroundColor: colors.bg },
};
function AgentsTab() {
  return (
    <AgentsStack.Navigator screenOptions={stackOptions}>
      <AgentsStack.Screen name="AgentsList" component={AgentsScreen} />
      <AgentsStack.Screen name="AgentDetail" component={AgentDetailScreen} />
      <AgentsStack.Screen name="Graveyard" component={GraveyardScreen} />
    </AgentsStack.Navigator>
  );
}

function InboxTab() {
  return (
    <InboxStack.Navigator screenOptions={{ ...stackOptions, contentStyle: { backgroundColor: t.bgInbox } }}>
      <InboxStack.Screen name="InboxList" component={InboxScreen} />
      <InboxStack.Screen name="InboxItem" component={InboxItemScreen} />
      <InboxStack.Screen name="AgentDetail" component={AgentDetailScreen} options={{ contentStyle: { backgroundColor: t.bg } }} />
      <InboxStack.Screen name="Senders" component={SendersScreen} options={{ contentStyle: { backgroundColor: t.bg } }} />
      <InboxStack.Screen name="PagerItem" component={PagerItemScreen} />
    </InboxStack.Navigator>
  );
}

function LocationTab() {
  return (
    <LocationStack.Navigator screenOptions={stackOptions}>
      <LocationStack.Screen name="LocationMain" component={LocationScreen} />
      <LocationStack.Screen name="Zones" component={ZonesScreen} />
    </LocationStack.Navigator>
  );
}

function MachinesTab() {
  return (
    <MachinesStack.Navigator screenOptions={stackOptions}>
      <MachinesStack.Screen name="MachinesList" component={MachinesScreen} />
      <MachinesStack.Screen name="MachineDetail" component={MachineDetailScreen} />
      <MachinesStack.Screen name="Pair" component={PairScreen} />
      <MachinesStack.Screen name="Settings" component={MachinesSettingsScreen} />
      <MachinesStack.Screen name="Notifications" component={NotificationSettingsScreen} />
    </MachinesStack.Navigator>
  );
}

/** Routes notification taps (porter locals → agent / inbox item / machine group;
 * pager-api pushes → Inbox, where pending requests sit in "Waiting on you") and runs approval action buttons pressed while the app is up. */
function useNotificationRouting() {
  useEffect(() => {
    const route = (data: Record<string, unknown> | undefined) => {
      if (!data) return;
      if (data.porterLocal === "1") {
        if (data.kind === "agent" && typeof data.machine === "string" && typeof data.agent === "string") {
          navigateTo("Agents", "AgentDetail", { machine: data.machine, agent: data.agent });
        } else if (data.kind === "notify" && typeof data.machine === "string" && typeof data.id === "string") {
          navigateTo("Inbox", "InboxItem", { machine: data.machine, id: data.id });
        } else if (data.kind === "group" && typeof data.machine === "string") {
          navigateTo("Inbox", "InboxList", { machine: data.machine });
        }
      } else {
        navigateTo("Inbox", "InboxList");
      }
    };
    const onResponse = (r: Notifications.NotificationResponse) => {
      const data = r.notification.request.content.data as Record<string, unknown>;
      const a = r.actionIdentifier;
      if (a === ACTION.allow || a === ACTION.deny || a === ACTION.once) {
        void handleNotificationAction(a, data as never).catch(() => undefined);
        return;
      }
      route(data);
    };
    const sub = Notifications.addNotificationResponseReceivedListener(onResponse);
    // Cold start from a tap.
    Notifications.getLastNotificationResponseAsync()
      .then((r) => {
        if (r && (r.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER || r.actionIdentifier === ACTION.more)) {
          setTimeout(() => route(r.notification.request.content.data as Record<string, unknown>), 300);
        }
      })
      .catch(() => undefined);
    return () => sub.remove();
  }, []);
}

function MainTabs() {
  const insets = useSafeAreaInsets();
  useNotificationRouting();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: t.tabBar,
          borderTopColor: "rgba(255,255,255,0.07)",
          borderTopWidth: 1,
          height: 60 + insets.bottom,
          paddingTop: 6,
          paddingBottom: insets.bottom + 6,
        },
        tabBarLabelStyle: { fontSize: 10, fontWeight: "600", marginTop: 1 },
        tabBarActiveTintColor: t.accent,
        tabBarInactiveTintColor: "rgba(255,255,255,0.4)",
        sceneStyle: { backgroundColor: t.bg },
      }}
    >
      <Tab.Screen name="Agents" component={AgentsTab} options={{ tabBarIcon: ({ color }) => <Feather name="menu" size={22} color={color} /> }} />
      <Tab.Screen
        name="Inbox"
        component={InboxTab}
        options={{
          tabBarIcon: ({ color }) => <Feather name="inbox" size={22} color={color} />,
          // Dot, not a count: set by InboxScreen when something is unread or waiting.
          tabBarBadgeStyle: { backgroundColor: t.needs, minWidth: 8, maxHeight: 8, height: 8, borderRadius: 4, fontSize: 1, lineHeight: 8, color: "transparent", top: 2 },
        }}
      />
      <Tab.Screen name="Location" component={LocationTab} options={{ tabBarIcon: ({ color }) => <Feather name="map-pin" size={22} color={color} /> }} />
      <Tab.Screen name="Machines" component={MachinesTab} options={{ tabBarIcon: ({ color }) => <Feather name="server" size={22} color={color} /> }} />
    </Tab.Navigator>
  );
}

const ONBOARDED_KEY = "onboarded.v1";

/** First launch: onboarding until a broker is configured (existing installs skip it). */
function Gate() {
  const { rt, bootError } = usePorter();
  const [show, setShow] = useState<boolean | null>(null);
  useEffect(() => {
    if (bootError) return setShow(false);
    if (!rt) return;
    AsyncStorage.getItem(ONBOARDED_KEY)
      .then((v) => setShow(!v && !rt.node.brokerURL))
      .catch(() => setShow(false));
  }, [rt, bootError]);
  if (show === null) return <View style={{ flex: 1, backgroundColor: t.bg }} />;
  if (show) {
    return (
      <Onboarding
        onDone={() => {
          AsyncStorage.setItem(ONBOARDED_KEY, "1").catch(() => undefined);
          setShow(false);
        }}
      />
    );
  }
  return (
    <NavigationContainer ref={navigationRef} theme={NAV_THEME}>
      <MainTabs />
    </NavigationContainer>
  );
}

const NAV_THEME = { ...DarkTheme, colors: { ...DarkTheme.colors, background: t.bg, card: t.tabBar, primary: t.accent, border: "rgba(255,255,255,0.07)" } };

export default function App() {
  return (
    <SafeAreaProvider>
      <ToastProvider>
        <TokenProvider>
          <PorterProvider>
            <LocationProvider>
              <StatusBar style="light" />
              <Gate />
            </LocationProvider>
          </PorterProvider>
        </TokenProvider>
      </ToastProvider>
    </SafeAreaProvider>
  );
}
