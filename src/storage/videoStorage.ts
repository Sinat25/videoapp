import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';

const STORAGE_KEY = 'SAVED_VIDEO_PATHS';
const HOTSPOT_KEY = 'SAVED_HOTSPOTS';
const START_VIDEO_KEY = 'SAVED_START_VIDEO';
const ADVANCE_FLAGS_KEY = 'SAVED_ADVANCE_FLAGS';

export interface Hotspot {
  x: number; // Percentage 0-100
  y: number; // Percentage 0-100
  width: number; // Percentage 0-100
  height: number; // Percentage 0-100
}

/**
 * iOS gives every install/update of the app a NEW container UUID, so an
 * absolute path saved yesterday (…/<old-uuid>/Documents/step_0.mov) no longer
 * exists today even though the file itself was migrated. We keep the file name
 * and re-attach it to the CURRENT documents directory, so the saved videos are
 * still found and the app can launch straight into them.
 */
export const rebasePath = (path: string): string => {
  const dir = FileSystem.documentDirectory;
  if (!dir || !path || path.startsWith(dir)) return path;
  if (!path.includes('/Documents/')) return path;

  const fileName = path.substring(path.lastIndexOf('/') + 1);
  if (!fileName) return path;
  return dir + fileName;
};

export const VideoStorage = {
  async saveVideos(paths: string[]) {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(paths));
  },

  async getVideos(): Promise<string[]> {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const paths: string[] = JSON.parse(raw);
    return paths.map(rebasePath);
  },

  async saveHotspots(hotspots: (Hotspot | null)[]) {
    await AsyncStorage.setItem(HOTSPOT_KEY, JSON.stringify(hotspots));
  },

  async getHotspots(): Promise<(Hotspot | null)[]> {
    const raw = await AsyncStorage.getItem(HOTSPOT_KEY);
    return raw ? JSON.parse(raw) : [];
  },

  /**
   * Per-video "advance on touch down" overrides, stored parallel to the videos
   * (same indexing as hotspots). Each entry is:
   *   - true/false: an explicit per-video choice, or
   *   - null: inherit the global default (SETTINGS_ADVANCE_ON_TOUCH_DOWN).
   */
  async saveAdvanceFlags(flags: (boolean | null)[]) {
    await AsyncStorage.setItem(ADVANCE_FLAGS_KEY, JSON.stringify(flags));
  },

  async getAdvanceFlags(): Promise<(boolean | null)[]> {
    const raw = await AsyncStorage.getItem(ADVANCE_FLAGS_KEY);
    return raw ? JSON.parse(raw) : [];
  },

  async saveVideoFile(uri: string, stepIndex: number): Promise<string> {
    const filename = `step_${stepIndex}_${Date.now()}.mov`;
    const destination = FileSystem.documentDirectory + filename;

    await FileSystem.copyAsync({
      from: uri,
      to: destination
    });

    return destination;
  },

  /**
   * Which video should open first. Stored as the video's PATH (not an index) so
   * it survives reordering/removal of other clips. Null means "use the natural
   * first video in the list", which is how the user reverts to the default.
   */
  async saveStartVideo(path: string | null) {
    if (path) {
      await AsyncStorage.setItem(START_VIDEO_KEY, path);
    } else {
      await AsyncStorage.removeItem(START_VIDEO_KEY);
    }
  },

  async getStartVideo(): Promise<string | null> {
    const raw = await AsyncStorage.getItem(START_VIDEO_KEY);
    return raw ? rebasePath(raw) : null;
  },

  async clearAll() {
      await AsyncStorage.removeItem(STORAGE_KEY);
      await AsyncStorage.removeItem(HOTSPOT_KEY);
      await AsyncStorage.removeItem(START_VIDEO_KEY);
      await AsyncStorage.removeItem(ADVANCE_FLAGS_KEY);
  }
};

/**
 * Non-destructively arrange a playlist so `startPath` plays first, with the
 * remaining clips following in their original cyclic order. The stored order is
 * never changed — only the copy handed to the player is rotated — so toggling
 * the "opens first" choice off restores the natural order exactly.
 */
export function rotateToStart(
  paths: string[],
  hotspots: (Hotspot | null)[],
  advanceFlags: (boolean | null)[],
  startPath: string | null
): { paths: string[]; hotspots: (Hotspot | null)[]; advanceFlags: (boolean | null)[] } {
  const hs = [...hotspots];
  while (hs.length < paths.length) hs.push(null);
  const af = [...advanceFlags];
  while (af.length < paths.length) af.push(null);

  if (!startPath) return { paths: [...paths], hotspots: hs, advanceFlags: af };
  const i = paths.indexOf(startPath);
  if (i <= 0) return { paths: [...paths], hotspots: hs, advanceFlags: af };

  return {
    paths: [...paths.slice(i), ...paths.slice(0, i)],
    hotspots: [...hs.slice(i), ...hs.slice(0, i)],
    advanceFlags: [...af.slice(i), ...af.slice(0, i)],
  };
}
