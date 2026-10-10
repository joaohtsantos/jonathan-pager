import { createNavigationContainerRef } from "@react-navigation/native";

export const navigationRef = createNavigationContainerRef();

export function navigateToTab(name: string) {
  if (navigationRef.isReady()) {
    // Tab param list is untyped; names come from MainTabs in App.tsx.
    navigationRef.navigate(name as never);
  }
}

/** Navigate to a screen inside a tab's stack (e.g. "Inbox", "Requests"). */
export function navigateTo(tab: string, screen?: string, params?: object) {
  if (!navigationRef.isReady()) return;
  // Untyped on purpose: tab/stack names are defined in App.tsx.
  (navigationRef.navigate as (...a: unknown[]) => void)(tab, screen ? { screen, params } : undefined);
}
