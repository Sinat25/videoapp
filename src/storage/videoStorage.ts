import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';

const STORAGE_KEY = 'SAVED_VIDEO_PATHS';
const HOTSPOT_KEY = 'SAVED_HOTSPOTS';

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
const rebasePath = (path: string): string => {
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

  async saveVideoFile(uri: string, stepIndex: number): Promise<string> {
    const filename = `step_${stepIndex}_${Date.now()}.mov`;
    const destination = FileSystem.documentDirectory + filename;

    await FileSystem.copyAsync({
      from: uri,
      to: destination
    });

    return destination;
  },

  async clearAll() {
      await AsyncStorage.removeItem(STORAGE_KEY);
      await AsyncStorage.removeItem(HOTSPOT_KEY);
  }
};
