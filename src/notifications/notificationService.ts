import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

/**
 * Manual/local notifications helper.
 * - Requests permission if needed.
 * - Creates a default Android channel (required for Android 13+ permission prompt).
 *
 * Docs (SDK 52): https://docs.expo.dev/versions/v52.0.0/sdk/notifications/
 */

export async function ensureAndroidDefaultChannelAsync() {
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync('default', {
    name: 'Default',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

export async function ensureNotificationPermissionsAsync(): Promise<boolean> {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  return finalStatus === 'granted';
}

export async function scheduleManualNotificationsAsync(params: {
  title: string;
  description: string;
  secondsFromNow: number;
  count: number;
}): Promise<string[] | null> {
  const title = (params.title || '').trim();
  const description = (params.description || '').trim();
  const seconds = Math.max(1, Math.floor(params.secondsFromNow || 1));
  const count = Math.max(1, Math.min(200, Math.floor(params.count || 1)));

  await ensureAndroidDefaultChannelAsync();

  const ok = await ensureNotificationPermissionsAsync();
  if (!ok) return null;

  const ids: string[] = [];

  // NOTE:
  // Scheduling many notifications for the *exact same second* can sometimes get coalesced
  // on certain platforms. We add a tiny stagger (1s) to make delivery consistent.
  for (let i = 0; i < count; i++) {
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: title.length ? title : 'Notification',
        body: description.length ? description : '',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: seconds + i,
      },
    });
    ids.push(id);
  }

  return ids;
}

// Backward-compatible alias (kept so nothing breaks if you imported the old name somewhere)
export async function scheduleManualNotificationAsync(params: {
  title: string;
  description: string;
  secondsFromNow: number;
}): Promise<string | null> {
  const ids = await scheduleManualNotificationsAsync({
    title: params.title,
    description: params.description,
    secondsFromNow: params.secondsFromNow,
    count: 1,
  });
  return ids && ids.length ? ids[0] : null;
}
