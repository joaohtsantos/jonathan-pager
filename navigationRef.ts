import { createNavigationContainerRef } from "@react-navigation/native";

export const navigationRef = createNavigationContainerRef();

export function navigateToTab(name: string) {
  if (navigationRef.isReady()) {
    // Tab param list is untyped; names come from MainTabs in App.tsx.
    navigationRef.navigate(name as never);
  }
}
