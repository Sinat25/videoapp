import React, { useRef, useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, Dimensions, TouchableWithoutFeedback } from 'react-native';
import { Video, ResizeMode, AVPlaybackStatus } from 'expo-av';
import { Hotspot } from '../storage/videoStorage';
import { useAppSettings } from '../settings/AppSettingsContext';

// Get full screen dimensions including status bar area
const { width, height } = Dimensions.get('screen');

interface Props {
  playlist: string[];
  hotspots: (Hotspot | null)[];
  onEnd: () => void;
  /**
   * Fired exactly once, the moment the very first video frame is actually on
   * screen. App.tsx uses this to drop the native launch screen, so the user
   * never sees a black view between the icon tap and the video.
   */
  onFirstFrame?: () => void;
}

/**
 * SeamlessPlayer (double-buffered)
 * - Keeps TWO <Video> components mounted at all times.
 * - Preloads the next clip in the hidden player.
 * - When advancing, we START the next player first, and only swap the UI once
 *   the next player reports "isPlaying" (this prevents a visible pause/black frame).
 */
export default function SeamlessPlayer({ playlist, hotspots, onEnd, onFirstFrame }: Props) {
  const { advanceOnTouchDown } = useAppSettings();
  const [index, setIndex] = useState(0);
  const [activePlayer, setActivePlayer] = useState<'A' | 'B'>('A');

  const videoA = useRef<Video>(null);
  const videoB = useRef<Video>(null);

  const pendingSwitchTo = useRef<'A' | 'B' | null>(null);
  const pendingIndex = useRef<number | null>(null);
  const fallbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Which player currently holds a loaded clip, so we never call play/seek on
  // an empty one.
  const loaded = useRef<{ A: boolean; B: boolean }>({ A: false, B: false });
  const firstFrameSent = useRef(false);

  useEffect(() => {
    initializePlayer();
    return () => {
      if (fallbackTimer.current) clearTimeout(fallbackTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initializePlayer = async () => {
    // ONLY the first clip is loaded here. Preloading clip 2 is deferred until
    // the first frame is actually on screen (see handleFirstFrame) so it can
    // never compete for disk I/O with the video the user is waiting to see.
    await loadSource('A', playlist[0], true, true);
  };

  const loadSource = async (
    key: 'A' | 'B',
    uri: string,
    shouldPlay: boolean,
    isFirstLoad = false
  ) => {
    const ref = key === 'A' ? videoA : videoB;
    if (!ref.current) return;
    loaded.current[key] = false;
    if (!isFirstLoad) {
      try {
        // Clear any previous state. Skipped on the very first load, where there
        // is nothing loaded yet and the extra round-trip only delays the frame.
        await ref.current.unloadAsync();
      } catch (e) {}
    }
    try {
      await ref.current.loadAsync(
        { uri },
        {
          shouldPlay,
          positionMillis: 0,
          isLooping: true,
          // NOTE: resizeMode is a <Video> prop, not a playback-status field.
          // It is already set on both players below (ResizeMode.COVER).
          isMuted: false,
          volume: 1.0,
          progressUpdateIntervalMillis: 100,
        },
        // downloadFirst=false: every clip is already a local file in the app's
        // documents directory, so the "download" step is pure added latency.
        false
      );
      loaded.current[key] = true;
      if (!shouldPlay) {
        // Ensure hidden player is ready at t=0
        await ref.current.setPositionAsync(0);
        await ref.current.pauseAsync();
      }
    } catch (e) {
      console.log('Load error', e);
    }
  };

  /**
   * The first frame is up. Release the launch screen, then quietly warm up the
   * second clip in the hidden player.
   */
  const handleFirstFrame = useCallback(() => {
    if (firstFrameSent.current) return;
    firstFrameSent.current = true;
    onFirstFrame?.();

    if (playlist.length > 1) {
      loadSource('B', playlist[1], false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onFirstFrame, playlist]);

  const handleTouch = (event: any) => {
    const currentHotspot = hotspots[index];
    if (currentHotspot) {
      const { locationX, locationY } = event.nativeEvent;
      const px = (locationX / width) * 100;
      const py = (locationY / height) * 100;

      const isInside =
        px >= currentHotspot.x &&
        px <= currentHotspot.x + currentHotspot.width &&
        py >= currentHotspot.y &&
        py <= currentHotspot.y + currentHotspot.height;

      if (!isInside) return;
    }
    handleNext();
  };

  const swapTo = useCallback(
    async (player: 'A' | 'B') => {
      const nextIndex = pendingIndex.current;
      if (nextIndex === null) return;

      const nextRef = player === 'A' ? videoA : videoB;
      const oldKey: 'A' | 'B' = player === 'A' ? 'B' : 'A';

      // Swap UI instantly now that next is confirmed playing
      setActivePlayer(player);
      setIndex(nextIndex);

      // Clear pending + fallback timer
      pendingSwitchTo.current = null;
      pendingIndex.current = null;
      if (fallbackTimer.current) {
        clearTimeout(fallbackTimer.current);
        fallbackTimer.current = null;
      }

      // Cleanup old + preload the clip after the one we just switched to
      cleanupAndPreload(oldKey, nextIndex + 1);

      // Make sure the newly active player stays playing
      try {
        await nextRef.current?.playAsync();
      } catch (e) {}
    },
    []
  );

  const handleNext = async () => {
    const nextIndex = index + 1;

    if (nextIndex >= playlist.length) {
      onEnd();
      return;
    }

    const nextPlayer = activePlayer === 'A' ? 'B' : 'A';
    const nextRef = nextPlayer === 'A' ? videoA : videoB;

    pendingSwitchTo.current = nextPlayer;
    pendingIndex.current = nextIndex;

    // Safety fallback: if iOS doesn't report isPlaying quickly, swap anyway.
    const armFallback = (ms: number) => {
      if (fallbackTimer.current) clearTimeout(fallbackTimer.current);
      fallbackTimer.current = setTimeout(() => {
        if (pendingSwitchTo.current === nextPlayer) {
          swapTo(nextPlayer);
        }
      }, ms);
    };

    // If the tap arrived before the background preload finished, load the clip
    // now and give it a longer grace period. The swap still happens from
    // onPlaybackStatusUpdate as soon as it reports playing.
    if (!loaded.current[nextPlayer]) {
      armFallback(2500);
      await loadSource(nextPlayer, playlist[nextIndex], true);
      return;
    }

    armFallback(700);

    try {
      // Start the next player FIRST while keeping current visible
      await nextRef.current?.setPositionAsync(0);
      await nextRef.current?.playAsync();
      // UI swap happens in onPlaybackStatusUpdate when isPlaying is confirmed
    } catch (e) {
      // Fall back immediately if play failed
      swapTo(nextPlayer);
    }
  };

  const cleanupAndPreload = async (oldKey: 'A' | 'B', futureIndex: number) => {
    const oldRef = oldKey === 'A' ? videoA : videoB;
    try {
      await oldRef.current?.stopAsync();
    } catch (e) {}
    try {
      if (futureIndex < playlist.length) {
        // Load the *future* clip into the now-hidden player
        await loadSource(oldKey, playlist[futureIndex], false);
      } else {
        // Nothing left to preload; keep it unloaded to save memory
        loaded.current[oldKey] = false;
        try {
          await oldRef.current?.unloadAsync();
        } catch (e) {}
      }
    } catch (e) {
      console.log('Preload error', e);
    }
  };

  const handleStatusUpdate = (player: 'A' | 'B') => (status: AVPlaybackStatus) => {
    // @ts-ignore - expo-av status typing varies across versions
    if (status?.isLoaded && status.isPlaying) {
      // Backstop for onReadyForDisplay: if the clip is genuinely playing, a
      // frame is on screen, so the launch screen can go.
      if (player === activePlayer) handleFirstFrame();
      if (pendingSwitchTo.current === player) {
        swapTo(player);
      }
    }
  };

  return (
    <TouchableWithoutFeedback
      onPressIn={advanceOnTouchDown ? handleTouch : undefined}
      onPressOut={!advanceOnTouchDown ? handleTouch : undefined}
    >
      <View style={styles.container}>
        {/* Player A */}
        <View
          style={[styles.videoWrapper, { opacity: activePlayer === 'A' ? 1 : 0 }]}
          pointerEvents={activePlayer === 'A' ? 'auto' : 'none'}
        >
          <Video
            ref={videoA}
            style={styles.video}
            resizeMode={ResizeMode.COVER}
            // The precise "a frame is now visible" signal for the cold start.
            onReadyForDisplay={handleFirstFrame}
            onPlaybackStatusUpdate={handleStatusUpdate('A')}
          />
        </View>

        {/* Player B */}
        <View
          style={[styles.videoWrapper, { opacity: activePlayer === 'B' ? 1 : 0 }]}
          pointerEvents={activePlayer === 'B' ? 'auto' : 'none'}
        >
          <Video
            ref={videoB}
            style={styles.video}
            resizeMode={ResizeMode.COVER}
            onPlaybackStatusUpdate={handleStatusUpdate('B')}
          />
        </View>
      </View>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'black',
    width: width,
    height: height,
  },
  videoWrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: width,
    height: height,
    backgroundColor: 'black',
    justifyContent: 'center',
    alignItems: 'center',
  },
  video: {
    width: '100%',
    height: '100%',
  },
});
