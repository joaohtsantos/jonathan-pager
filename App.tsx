import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { Text } from "react-native";
import PushListScreen from "./screens/PushListScreen";
import PushDetailScreen from "./screens/PushDetailScreen";
import RequestsScreen from "./screens/RequestsScreen";
import type { PushStackParamList } from "./screens/PushListScreen";

const Tab = createBottomTabNavigator();
const PushStack = createNativeStackNavigator<PushStackParamList>();

function NotificationsStack() {
  return (
    <PushStack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: "#111111" },
      }}
    >
      <PushStack.Screen name="PushList" component={PushListScreen} />
      <PushStack.Screen
        name="PushDetail"
        component={PushDetailScreen}
        options={{
          headerShown: true,
          headerTitle: "",
          headerStyle: { backgroundColor: "#1A1A1A" },
          headerTintColor: "#FFFFFF",
        }}
      />
    </PushStack.Navigator>
  );
}

export default function App() {
  return (
    <NavigationContainer>
      <StatusBar style="light" />
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            backgroundColor: "#1A1A1A",
            borderTopColor: "#333",
          },
          tabBarActiveTintColor: "#FFFFFF",
          tabBarInactiveTintColor: "#666",
        }}
      >
        <Tab.Screen
          name="Notifications"
          component={NotificationsStack}
          options={{
            tabBarIcon: ({ color }) => (
              <Text style={{ fontSize: 20, color }}>{"\u{1F4DF}"}</Text>
            ),
          }}
        />
        <Tab.Screen
          name="Requests"
          component={RequestsScreen}
          options={{
            tabBarIcon: ({ color }) => (
              <Text style={{ fontSize: 20, color }}>{"\u{1F4CB}"}</Text>
            ),
          }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
