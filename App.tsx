import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { Feather } from "@expo/vector-icons";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import PushListScreen from "./screens/PushListScreen";
import PushDetailScreen from "./screens/PushDetailScreen";
import RequestsScreen from "./screens/RequestsScreen";
import SettingsScreen from "./screens/SettingsScreen";
import LocationScreen from "./screens/LocationScreen";
import type { PushStackParamList } from "./screens/PushListScreen";
import { TokenProvider } from "./tokenContext";
import { LocationProvider } from "./locationContext";
import { ToastProvider } from "./components/Toast";
import { colors, fonts } from "./theme";

const Tab = createBottomTabNavigator();
const PushStack = createNativeStackNavigator<PushStackParamList>();

function NotificationsStack() {
  return (
    <PushStack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <PushStack.Screen name="PushList" component={PushListScreen} />
      <PushStack.Screen
        name="PushDetail"
        component={PushDetailScreen}
        options={{
          headerShown: true,
          headerTitle: "",
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
        }}
      />
    </PushStack.Navigator>
  );
}

function MainTabs() {
  const insets = useSafeAreaInsets();
  const barHeight = 56 + insets.bottom;

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
        name="Notifications"
        component={NotificationsStack}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Feather name="bell" size={size} color={color} />
          ),
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
        name="Requests"
        component={RequestsScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Feather name="check-square" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Location"
        component={LocationScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Feather name="map-pin" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Feather name="settings" size={size} color={color} />
          ),
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
          <LocationProvider>
            <NavigationContainer>
              <StatusBar style="light" />
              <MainTabs />
            </NavigationContainer>
          </LocationProvider>
        </TokenProvider>
      </ToastProvider>
    </SafeAreaProvider>
  );
}
