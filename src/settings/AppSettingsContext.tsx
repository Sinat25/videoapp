import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NotifItem, NotifStorage } from '../storage/notifStorage';

/**
 * App settings stored locally.
 * We keep it tiny: just the status bar visibility switch for now.
 */
const SHOW_STATUS_BAR_KEY = 'SETTINGS_SHOW_STATUS_BAR';
const THEME_MODE_KEY = 'SETTINGS_THEME_MODE';
const ADVANCE_ON_TOUCH_DOWN_KEY = 'SETTINGS_ADVANCE_ON_TOUCH_DOWN';

/** Create a fresh, empty notification item with a unique id. */
function makeNotifItem(seconds = 5): NotifItem {
  return {
    id: `n_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
    seconds,
    title: '',
    body: '',
    imageUri: null,
  };
}

type AppSettingsContextValue = {
  showStatusBar: boolean;
  setShowStatusBar: (value: boolean) => void;

  themeMode: 'light' | 'dark';
  setThemeMode: (value: 'light' | 'dark') => void;

  advanceOnTouchDown: boolean;
  setAdvanceOnTouchDown: (value: boolean) => void;

  // ---- Last-video notifications ----
  /** Master switch: fire the list below when the last video is reached. */
  lastVideoNotifEnabled: boolean;
  setLastVideoNotifEnabled: (value: boolean) => void;
  /** Gallery of uploaded images that items can choose from. */
  notifImages: string[];
  addNotifImage: (uri: string) => Promise<void>;
  removeNotifImage: (path: string) => Promise<void>;
  /** The notification items, each with its own delay + image. */
  notifItems: NotifItem[];
  addNotifItem: () => void;
  updateNotifItem: (id: string, patch: Partial<NotifItem>) => void;
  removeNotifItem: (id: string) => void;

  settingsLoaded: boolean;
};

const AppSettingsContext = createContext<AppSettingsContextValue | undefined>(undefined);

export function AppSettingsProvider({ children }: { children: React.ReactNode }) {
  const [showStatusBar, setShowStatusBarState] = useState(true);
  const [themeMode, setThemeModeState] = useState<'light' | 'dark'>('light');
  const [advanceOnTouchDown, setAdvanceOnTouchDownState] = useState(false);
  const [lastVideoNotifEnabled, setLastVideoNotifEnabledState] = useState(false);
  const [notifImages, setNotifImages] = useState<string[]>([]);
  const [notifItems, setNotifItems] = useState<NotifItem[]>([]);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const raw = await AsyncStorage.getItem(SHOW_STATUS_BAR_KEY);
        const rawTheme = await AsyncStorage.getItem(THEME_MODE_KEY);
        const rawAdvance = await AsyncStorage.getItem(ADVANCE_ON_TOUCH_DOWN_KEY);
        const [enabled, images, items] = await Promise.all([
          NotifStorage.getEnabled(),
          NotifStorage.getImages(),
          NotifStorage.getItems(),
        ]);
        if (!mounted) return;
        if (raw !== null) {
          setShowStatusBarState(Boolean(JSON.parse(raw)));
        }
        if (rawTheme !== null) {
          const parsed = String(JSON.parse(rawTheme));
          if (parsed === 'dark' || parsed === 'light') setThemeModeState(parsed);
        }
        if (rawAdvance !== null) {
          setAdvanceOnTouchDownState(Boolean(JSON.parse(rawAdvance)));
        }
        setLastVideoNotifEnabledState(enabled);
        setNotifImages(images);
        setNotifItems(items);
      } catch (e) {
        // If something goes wrong, keep defaults.
      } finally {
        if (mounted) setSettingsLoaded(true);
      }
    };
    load();
    return () => { mounted = false; };
  }, []);

  const setShowStatusBar = (value: boolean) => {
    setShowStatusBarState(value);
    AsyncStorage.setItem(SHOW_STATUS_BAR_KEY, JSON.stringify(value)).catch(() => {});
  };

  const setThemeMode = (value: 'light' | 'dark') => {
    setThemeModeState(value);
    AsyncStorage.setItem(THEME_MODE_KEY, JSON.stringify(value)).catch(() => {});
  };

  const setAdvanceOnTouchDown = (value: boolean) => {
    setAdvanceOnTouchDownState(value);
    AsyncStorage.setItem(ADVANCE_ON_TOUCH_DOWN_KEY, JSON.stringify(value)).catch(() => {});
  };

  const setLastVideoNotifEnabled = (value: boolean) => {
    setLastVideoNotifEnabledState(value);
    NotifStorage.saveEnabled(value).catch(() => {});
  };

  // Persist a new items array and update state in one place.
  const commitItems = (next: NotifItem[]) => {
    setNotifItems(next);
    NotifStorage.saveItems(next).catch(() => {});
  };

  const addNotifImage = async (uri: string) => {
    const saved = await NotifStorage.saveImageFile(uri);
    const next = [...notifImages, saved];
    setNotifImages(next);
    await NotifStorage.saveImages(next).catch(() => {});
  };

  const removeNotifImage = async (path: string) => {
    const next = notifImages.filter((p) => p !== path);
    setNotifImages(next);
    await NotifStorage.saveImages(next).catch(() => {});
    // Any item pointing at this image reverts to text-only.
    const clearedItems = notifItems.map((it) =>
      it.imageUri === path ? { ...it, imageUri: null } : it
    );
    if (clearedItems.some((it, i) => it !== notifItems[i])) {
      commitItems(clearedItems);
    }
    await NotifStorage.deleteImageFile(path);
  };

  const addNotifItem = () => {
    commitItems([...notifItems, makeNotifItem()]);
  };

  const updateNotifItem = (id: string, patch: Partial<NotifItem>) => {
    commitItems(notifItems.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  };

  const removeNotifItem = (id: string) => {
    commitItems(notifItems.filter((it) => it.id !== id));
  };

  const value = useMemo(
    () => ({
      showStatusBar, setShowStatusBar,
      themeMode, setThemeMode,
      advanceOnTouchDown, setAdvanceOnTouchDown,
      lastVideoNotifEnabled, setLastVideoNotifEnabled,
      notifImages, addNotifImage, removeNotifImage,
      notifItems, addNotifItem, updateNotifItem, removeNotifItem,
      settingsLoaded,
    }),
    [showStatusBar, themeMode, advanceOnTouchDown, lastVideoNotifEnabled, notifImages, notifItems, settingsLoaded]
  );

  return <AppSettingsContext.Provider value={value}>{children}</AppSettingsContext.Provider>;
}

export function useAppSettings() {
  const ctx = useContext(AppSettingsContext);
  if (!ctx) throw new Error('useAppSettings must be used within AppSettingsProvider');
  return ctx;
}