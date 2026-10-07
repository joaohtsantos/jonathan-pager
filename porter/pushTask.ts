// Background notification task for encrypted porter pushes. Must be imported
// at module scope early (index.ts) so it is defined when the app is launched
// headless by an incoming data-only FCM message.
import * as TaskManager from "expo-task-manager";
import * as Notifications from "expo-notifications";
import { handlePorterPush } from "./runtime";

export const PORTER_PUSH_TASK = "porter-push-task";

TaskManager.defineTask<Notifications.NotificationTaskPayload>(PORTER_PUSH_TASK, async ({ data, error }) => {
  if (error || !data) return Notifications.BackgroundNotificationTaskResult.NoData;
  if ("actionIdentifier" in data) return Notifications.BackgroundNotificationTaskResult.NoData;
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
