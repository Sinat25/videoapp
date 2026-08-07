import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import { rebasePath } from './videoStorage';

/**
 * Storage for the "last-video notifications" feature.
 *
 * When the user scrolls to the LAST video, we fire a list of local
 * notifications, each after its own delay and with its own (optional) image.
 * This module owns:
 *   - the uploaded image gallery (files copied into the app documents dir), and
 *   - the notification items (delay + title + body + chosen image), and
 *   - the master on/off flag.
 *
 * Image paths are rebased on read for the same reason videos are: iOS gives the
 * app a new container UUID on every install/update, so yesterday's absolute path
 * no longer exists even though the file was migrated. See videoStorage.rebasePath.
 */

const IMAGES_KEY = 'NOTIF_IMAGES';
const ITEMS_KEY = 'NOTIF_LAST_ITEMS';
const ENABLED_KEY = 'NOTIF_LAST_ENABLED';

export type NotifItem = {
  id: string;
  /** Delay in seconds, measured from the moment the last video is reached. */
  seconds: number;
  title: string;
  body: string;
  /** Path of the chosen gallery image, or null for a text-only notification. */
  imageUri: string | null;
};

const IMAGE_EXT_RE = /^(jpg|jpeg|png|gif|heic|heif|webp)$/;

export const NotifStorage = {
  /** Copy a picked image into the app documents dir so it survives cache purges. */
  async saveImageFile(uri: string): Promise<string> {
    const rawExt = (uri.split('?')[0].split('.').pop() || '').toLowerCase();
    const ext = IMAGE_EXT_RE.test(rawExt) ? rawExt : 'jpg';
    const filename = `notif_img_${Date.now()}_${Math.floor(Math.random() * 1e6)}.${ext}`;
    const destination = FileSystem.documentDirectory + filename;
    await FileSystem.copyAsync({ from: uri, to: destination });
    return destination;
  },

  /** Best-effort delete of a gallery image file. */
  async deleteImageFile(path: string): Promise<void> {
    try {
      await FileSystem.deleteAsync(path, { idempotent: true });
    } catch (e) {
      // Ignore: the file may already be gone (e.g. after a reinstall).
    }
  },

  async getImages(): Promise<string[]> {
    const raw = await AsyncStorage.getItem(IMAGES_KEY);
    if (!raw) return [];
    try {
      return (JSON.parse(raw) as string[]).map(rebasePath);
    } catch {
      return [];
    }
  },

  async saveImages(paths: string[]): Promise<void> {
    await AsyncStorage.setItem(IMAGES_KEY, JSON.stringify(paths));
  },

  async getItems(): Promise<NotifItem[]> {
    const raw = await AsyncStorage.getItem(ITEMS_KEY);
    if (!raw) return [];
    try {
      const items = JSON.parse(raw) as NotifItem[];
      return items.map((it) => ({
        ...it,
        imageUri: it.imageUri ? rebasePath(it.imageUri) : null,
      }));
    } catch {
      return [];
    }
  },

  async saveItems(items: NotifItem[]): Promise<void> {
    await AsyncStorage.setItem(ITEMS_KEY, JSON.stringify(items));
  },

  async getEnabled(): Promise<boolean> {
    const raw = await AsyncStorage.getItem(ENABLED_KEY);
    return raw === '1';
  },

  async saveEnabled(value: boolean): Promise<void> {
    await AsyncStorage.setItem(ENABLED_KEY, value ? '1' : '0');
  },
};
