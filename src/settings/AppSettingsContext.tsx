import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * App settings stored locally.
 * We keep it tiny: just the status bar visibility switch for now.
 */
const SHOW_STATUS_BAR_KEY = 'SETTINGS_SHOW_STATUS_BAR';
const THEME_MODE_KEY = 'SETTINGS_THEME_MODE';
const ADVANCE_ON_TOUCH_DOWN_KEY = 'SETTINGS_ADVANCE_ON_TOUCH_DOWN';

type AppSettingsContextValue = {
  showStatusBar: boolean;
  setShowStatusBar: (value: boolean) => void;

  themeMode: 'light' | 'dark';
  setThemeMode: (value: 'light' | 'dark') => void;

  advanceOnTouchDown: boolean;
  setAdvanceOnTouchDown: (value: boolean) => void;

  settingsLoaded: boolean;
};

const AppSettingsContext = createContext<AppSettingsContextValue | undefined>(undefined);

export function AppSettingsProvider({ children }: { children: React.ReactNode }) {
  const [showStatusBar, setShowStatusBarState] = useState(true);
  const [themeMode, setThemeModeState] = useState<'light' | 'dark'>('light');
  const [advanceOnTouchDown, setAdvanceOnTouchDownState] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const raw = await AsyncStorage.getItem(SHOW_STATUS_BAR_KEY);
        const rawTheme = await AsyncStorage.getItem(THEME_MODE_KEY);
        const rawAdvance = await AsyncStorage.getItem(ADVANCE_ON_TOUCH_DOWN_KEY);
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

  const value = useMemo(
    () => ({ showStatusBar, setShowStatusBar, themeMode, setThemeMode, advanceOnTouchDown, setAdvanceOnTouchDown, settingsLoaded }),
    [showStatusBar, themeMode, advanceOnTouchDown, settingsLoaded]
  );

  return <AppSettingsContext.Provider value={value}>{children}</AppSettingsContext.Provider>;
}

export function useAppSettings() {
  const ctx = useContext(AppSettingsContext);
  if (!ctx) throw new Error('useAppSettings must be used within AppSettingsProvider');
  return ctx;
}