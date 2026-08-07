import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { NotifItem } from '../storage/notifStorage';

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

/**
 * Schedule ONE local notification after a delay, optionally with an image.
 *
 * The image is attached as a local file (content.attachments). On iOS a local
 * attachment on a locally-scheduled notification is rendered by the system
 * directly — no Notification Service Extension is required. `imageUri` must be a
 * local `file://` path (our gallery images live in the app documents dir).
 *
 * NOTE: The small monochrome glyph on the notification is ALWAYS the app icon on
 * iOS and cannot be replaced per-notification. This attaches the chosen image as
 * the notification's large picture instead (visible when the alert is expanded).
 */
export async function scheduleImageNotificationAsync(params: {
  title: string;
  body: string;
  secondsFromNow: number;
  imageUri?: string | null;
}): Promise<string | null> {
  const seconds = Math.max(1, Math.floor(params.secondsFromNow || 1));

  await ensureAndroidDefaultChannelAsync();
  const ok = await ensureNotificationPermissionsAsync();
  if (!ok) return null;

  const content: Notifications.NotificationContentInput = {
    title: (params.title || '').trim() || 'Notification',
    body: (params.body || '').trim(),
  };
  if (params.imageUri) {
    // iOS-only rich attachment; ignored on Android (which keeps it text-only).
    (content as any).attachments = [
      { identifier: 'image', url: params.imageUri, type: 'public.image' },
    ];
  }

  return Notifications.scheduleNotificationAsync({
    content,
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds,
    },
  });
}

/**
 * Schedule the whole "last-video" list at once: each item fires after its own
 * delay (seconds) with its own optional image. Called when the user scrolls to
 * the last video. Returns how many notifications were actually scheduled (0 if
 * permission was denied or the list was empty).
 */
export async function scheduleLastVideoNotificationsAsync(
  items: NotifItem[]
): Promise<number> {
  if (!items || items.length === 0) return 0;

  await ensureAndroidDefaultChannelAsync();
  const ok = await ensureNotificationPermissionsAsync();
  if (!ok) return 0;

  let scheduled = 0;
  for (const item of items) {
    const seconds = Math.max(1, Math.floor(item.seconds || 1));
    const content: Notifications.NotificationContentInput = {
      title: (item.title || '').trim() || 'Notification',
      body: (item.body || '').trim(),
    };
    if (item.imageUri) {
      (content as any).attachments = [
        { identifier: 'image', url: item.imageUri, type: 'public.image' },
      ];
    }
    try {
      await Notifications.scheduleNotificationAsync({
        content,
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds,
        },
      });
      scheduled++;
    } catch (e) {
      // Skip a bad item (e.g. missing image file) but keep scheduling the rest.
    }
  }
  return scheduled;
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
