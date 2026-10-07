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
import type { AgentsStackParamList, InboxStackParamList, MachinesStackParamList } from "./navigation/types";
import { TokenProvider } from "./tokenContext";
import { navigateTo, navigationRef } from "./navigationRef";
import { LocationProvider } from "./locationContext";
import { ToastProvider } from "./components/Toast";
import { PorterProvider } from "./porter/PorterProvider";
import { colors, fonts } from "./theme";

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
  headerStyle: { backgroundColor: colors.surface },
  headerTintColor: colors.text,
  headerTitleStyle: { fontFamily: fonts.mono, fontSize: 14 },
});

function AgentsTab() {
  return (
    <AgentsStack.Navigator screenOptions={stackOptions}>
      <AgentsStack.Screen name="AgentsList" component={AgentsScreen} />
      <AgentsStack.Screen name="AgentDetail" component={AgentDetailScreen} options={detailOptions("AGENT")} />
      <AgentsStack.Screen name="Graveyard" component={GraveyardScreen} options={detailOptions("GRAVEYARD")} />
    </AgentsStack.Navigator>
  );
}

function InboxTab() {
  return (
    <InboxStack.Navigator screenOptions={stackOptions}>
      <InboxStack.Screen name="InboxList" component={InboxScreen} />
      <InboxStack.Screen name="InboxItem" component={InboxItemScreen} options={detailOptions()} />
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
      <MachinesStack.Screen name="MachineDetail" component={MachineDetailScreen} options={detailOptions("MACHINE")} />
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
  const barHeight = 56 + insets.bottom;
  useNotificationRouting();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: barHeight,
          paddingTop: 0,
          paddingBottom: insets.bottom,
        },
        tabBarItemStyle: {
          paddingTop: 0,
          paddingBottom: 0,
        },
        tabBarIconStyle: {
          flex: 1,
          alignSelf: "center",
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textFaint,
      }}
    >
      <Tab.Screen
        name="Agents"
        component={AgentsTab}
        options={{
          tabBarIcon: ({ color, size }) => <Feather name="cpu" size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="Inbox"
        component={InboxTab}
        options={{
          tabBarIcon: ({ color, size }) => <Feather name="bell" size={size} color={color} />,
          tabBarBadgeStyle: {
            backgroundColor: "transparent",
            color: colors.accent,
            fontFamily: fonts.mono,
            fontSize: 12,
            fontWeight: "700",
            minWidth: 0,
            paddingHorizontal: 0,
            borderWidth: 0,
          },
        }}
      />
      <Tab.Screen
        name="Location"
        component={LocationScreen}
        options={{
          tabBarIcon: ({ color, size }) => <Feather name="map-pin" size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="Machines"
        component={MachinesTab}
        options={{
          tabBarIcon: ({ color, size }) => <Feather name="server" size={size} color={color} />,
        }}
      />
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
