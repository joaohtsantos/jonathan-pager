// Background notification task for encrypted porter pushes. Must be imported
// at module scope early (index.ts) so it is defined when the app is launched
// headless by an incoming data-only FCM message.
import * as TaskManager from "expo-task-manager";
import * as Notifications from "expo-notifications";
import { handleNotificationAction, handlePorterPush } from "./runtime";

export const PORTER_PUSH_TASK = "porter-push-task";

TaskManager.defineTask<Notifications.NotificationTaskPayload>(PORTER_PUSH_TASK, async ({ data, error }) => {
  if (error || !data) return Notifications.BackgroundNotificationTaskResult.NoData;
  if ("actionIdentifier" in data) {
    // Approval action buttons (opensAppToForeground: false) land here.
    try {
      const d = data.notification.request.content.data as Record<string, unknown> | undefined;
      await handleNotificationAction(data.actionIdentifier, d as never);
      return Notifications.BackgroundNotificationTaskResult.NewData;
    } catch {
      return Notifications.BackgroundNotificationTaskResult.Failed;
    }
  }
  try {
    const ok = await handlePorterPush(data);
    return ok ? Notifications.BackgroundNotificationTaskResult.NewData : Notifications.BackgroundNotificationTaskResult.NoData;
  } catch {
    return Notifications.BackgroundNotificationTaskResult.Failed;
  }
});

export async function registerPorterPushTask(): Promise<void> {
  try {
    await Notifications.registerTaskAsync(PORTER_PUSH_TASK);
  } catch {
    // Unsupported environment (web / Expo Go): foreground listener still works.
  }
}
