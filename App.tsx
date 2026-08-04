import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, StyleSheet, StatusBar, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useKeepAwake } from 'expo-keep-awake';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import UploadScreen from './src/screens/UploadScreen';
import LoadingScreen from './src/screens/LoadingScreen';
import PlayerScreen from './src/screens/PlayerScreen';
import { VideoStorage, Hotspot } from './src/storage/videoStorage';
import { getTheme } from './src/theme';
import { AppSettingsProvider, useAppSettings } from './src/settings/AppSettingsContext';

// 'boot' is an invisible, one-frame state used ONLY while we read the saved
// videos from storage. It never draws any logo, title or spinner so the app can
// jump straight into the video.
export type AppState = 'boot' | 'upload' | 'loading' | 'player';

/**
 * HOLD THE LAUNCH SCREEN UNTIL THE VIDEO IS ACTUALLY VISIBLE.
 *
 * By default Expo hides the native launch screen the instant the React root
 * mounts, which happens long before the first clip has been read from disk and
 * decoded. The result was a black screen sitting between the icon tap and the
 * video. Holding it here means iOS keeps showing the launch screen (pure black,
 * no image, no logo) and we swap it out only once a real frame is on screen.
 */
SplashScreen.preventAutoHideAsync().catch(() => {});

// If the video can never be shown (missing or corrupt file), never strand the
// user on the launch screen.
const SPLASH_SAFETY_TIMEOUT_MS = 4000;

/**
 * Notifications:
 * - Ensure notifications can show while the app is in the foreground.
 * - We keep sound and badge off by default.
 *
 * Docs (SDK 52): https://docs.expo.dev/versions/v52.0.0/sdk/notifications/
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

function AppRoot() {
  useKeepAwake();
  const { showStatusBar, themeMode } = useAppSettings();
  const theme = getTheme(themeMode);

  // Force-apply status bar visibility (iOS can ignore the prop-only approach in some cases)
  useEffect(() => {
    StatusBar.setHidden(!showStatusBar, 'fade');
    StatusBar.setBarStyle(themeMode === 'dark' ? 'light-content' : 'dark-content');
    // Keep full-screen drawing under the status bar area when visible
    if (Platform.OS === 'android') {
      StatusBar.setTranslucent(true);
      StatusBar.setBackgroundColor('transparent');
    }
  }, [showStatusBar, themeMode]);

  const [appState, setAppState] = useState<AppState>('boot');
  const [videoPaths, setVideoPaths] = useState<string[]>([]);
  const [hotspots, setHotspots] = useState<(Hotspot | null)[]>([]);

  // Drop the launch screen. Idempotent: whichever trigger fires first wins.
  const splashHidden = useRef(false);
  const hideSplash = useCallback(() => {
    if (splashHidden.current) return;
    splashHidden.current = true;
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  useEffect(() => {
    const timer = setTimeout(hideSplash, SPLASH_SAFETY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [hideSplash]);

  // The setup screen has no first frame to wait for, so reveal it as soon as it
  // has been committed to the screen.
  useEffect(() => {
    if (appState === 'upload' || appState === 'loading') hideSplash();
  }, [appState, hideSplash]);

  /**
   * DIRECT VIDEO LAUNCH
   * On every cold start we read the saved playlist and, if there is one, go
   * STRAIGHT to the player: no logo, no splash content, no "Preparing
   * Experience" screen, no progress bar. The storage read is the only step
   * between launch and the first video frame.
   */
  useEffect(() => {
    let mounted = true;

    const bootstrap = async () => {
      try {
        // Read both keys in parallel to shave time off the cold start.
        const [savedVideos, savedHotspots] = await Promise.all([
          VideoStorage.getVideos(),
          VideoStorage.getHotspots(),
        ]);
        if (!mounted) return;

        if (savedVideos && savedVideos.length > 0) {
          setVideoPaths(savedVideos);
          setHotspots(savedHotspots);
          // Straight to the video. The setup screen is only reached again when
          // the user taps past the last clip (onExit).
          setAppState('player');
          return;
        }
      } catch (e) {
        // Fall through to the setup screen if storage cannot be read.
      }
      if (mounted) setAppState('upload');
    };

    bootstrap();
    return () => { mounted = false; };
  }, []);

  const handleStartLoading = (paths: string[], hs: (Hotspot | null)[]) => {
    setVideoPaths(paths);
    setHotspots(hs);
    setAppState('loading');
  };

  const renderScreen = () => {
    switch (appState) {
      case 'boot':
        // Nothing at all: same color as the launch screen and as the player, so
        // the hand-off to the video is invisible.
        return <View style={styles.boot} />;
      case 'upload':
        return (
          <UploadScreen 
            onStart={handleStartLoading} 
            existingVideos={videoPaths} 
            existingHotspots={hotspots}
          />
        );
      case 'loading':
        return (
          <LoadingScreen 
            videoPaths={videoPaths} 
            onReady={() => setAppState('player')}
            onCancel={() => setAppState('upload')}
          />
        );
      case 'player':
        return (
          <PlayerScreen
            videoPaths={videoPaths}
            hotspots={hotspots}
            onExit={() => setAppState('upload')}
            onFirstFrame={hideSplash}
          />
        );
    }
  };

  // While booting / playing we keep the root the same color as the launch
  // screen so there is no white flash before the video shows up.
  const isVideoStage = appState === 'boot' || appState === 'player';

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: isVideoStage ? '#000' : theme.colors.background },
      ]}
    >

      {/* 
         STATUS BAR CONFIGURATION: 
         - Translucent = content draws under it (Full Screen)
         - Transparent background = no ugly color bar
         - Light Content = White text/icons for visibility on video
         - Switcher controlled via AppSettings (showStatusBar)
      */}
      <StatusBar 
        translucent={true} 
        backgroundColor="transparent" 
        barStyle={themeMode === 'dark' ? 'light-content' : 'dark-content'}
        hidden={!showStatusBar}
      />
      {renderScreen()}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppSettingsProvider>
        <AppRoot />
      </AppSettingsProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  boot: {
    flex: 1,
    backgroundColor: '#000',
  },
});
