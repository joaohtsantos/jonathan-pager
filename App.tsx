import { useEffect } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator, type NativeStackNavigationOptions } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import { Feather } from "@expo/vector-icons";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import PushListScreen from "./screens/PushListScreen";
import PushDetailScreen from "./screens/PushDetailScreen";
import RequestsScreen from "./screens/RequestsScreen";
import LocationScreen from "./screens/LocationScreen";
import AgentsScreen from "./screens/agents/AgentsScreen";
import AgentDetailScreen from "./screens/agents/AgentDetailScreen";
import GraveyardScreen from "./screens/agents/GraveyardScreen";
import InboxScreen from "./screens/inbox/InboxScreen";
import InboxItemScreen from "./screens/inbox/InboxItemScreen";
import MachinesScreen from "./screens/machines/MachinesScreen";
import MachineDetailScreen from "./screens/machines/MachineDetailScreen";
import PairScreen from "./screens/machines/PairScreen";
import MachinesSettingsScreen from "./screens/machines/MachinesSettingsScreen";
import SendersScreen from "./screens/inbox/SendersScreen";
import type { AgentsStackParamList, InboxStackParamList, MachinesStackParamList } from "./navigation/types";
import { TokenProvider } from "./tokenContext";
import { navigateTo, navigationRef } from "./navigationRef";
import { LocationProvider } from "./locationContext";
import { ToastProvider } from "./components/Toast";
import { PorterProvider } from "./porter/PorterProvider";
import { colors, fonts, t } from "./theme";

const Tab = createBottomTabNavigator();
const AgentsStack = createNativeStackNavigator<AgentsStackParamList>();
const InboxStack = createNativeStackNavigator<InboxStackParamList>();
const MachinesStack = createNativeStackNavigator<MachinesStackParamList>();

const stackOptions: NativeStackNavigationOptions = {
  headerShown: false,
  contentStyle: { backgroundColor: colors.bg },
};
const detailOptions = (title = ""): NativeStackNavigationOptions => ({
  headerShown: true,
  headerTitle: title,
  headerStyle: { backgroundColor: t.bgInbox },
  headerTintColor: colors.text,
  headerTitleStyle: { fontFamily: fonts.mono, fontSize: 14 },
});

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
      <InboxStack.Screen name="PushDetail" component={PushDetailScreen} options={detailOptions()} />
      <InboxStack.Screen name="PushList" component={PushListScreen} />
      <InboxStack.Screen name="Requests" component={RequestsScreen} />
    </InboxStack.Navigator>
  );
}

function MachinesTab() {
  return (
    <MachinesStack.Navigator screenOptions={stackOptions}>
      <MachinesStack.Screen name="MachinesList" component={MachinesScreen} />
      <MachinesStack.Screen name="MachineDetail" component={MachineDetailScreen} />
      <MachinesStack.Screen name="Pair" component={PairScreen} />
      <MachinesStack.Screen name="Settings" component={MachinesSettingsScreen} />
    </MachinesStack.Navigator>
  );
}

/** Routes notification taps: porter locals → agent / inbox item; email-agent → Requests. */
function useNotificationRouting() {
  useEffect(() => {
    const route = (data: Record<string, unknown> | undefined) => {
      if (!data) return;
      if (data.porterLocal === "1") {
        if (data.kind === "agent" && typeof data.machine === "string" && typeof data.agent === "string") {
          navigateTo("Agents", "AgentDetail", { machine: data.machine, agent: data.agent });
        } else if (data.kind === "notify" && typeof data.machine === "string" && typeof data.id === "string") {
          navigateTo("Inbox", "InboxItem", { machine: data.machine, id: data.id });
        }
      } else if (data.source === "email-agent") {
        navigateTo("Inbox", "Requests");
      } else {
        navigateTo("Inbox", "InboxList");
      }
    };
    const sub = Notifications.addNotificationResponseReceivedListener((r) =>
      route(r.notification.request.content.data as Record<string, unknown>)
    );
    // Cold start from a tap.
    Notifications.getLastNotificationResponseAsync()
      .then((r) => {
        if (r) setTimeout(() => route(r.notification.request.content.data as Record<string, unknown>), 300);
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
      <Tab.Screen name="Location" component={LocationScreen} options={{ tabBarIcon: ({ color }) => <Feather name="map-pin" size={22} color={color} /> }} />
      <Tab.Screen name="Machines" component={MachinesTab} options={{ tabBarIcon: ({ color }) => <Feather name="server" size={22} color={color} /> }} />
    </Tab.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ToastProvider>
        <TokenProvider>
          <PorterProvider>
            <LocationProvider>
              <NavigationContainer ref={navigationRef}>
                <StatusBar style="light" />
                <MainTabs />
              </NavigationContainer>
            </LocationProvider>
          </PorterProvider>
        </TokenProvider>
      </ToastProvider>
    </SafeAreaProvider>
  );
}
