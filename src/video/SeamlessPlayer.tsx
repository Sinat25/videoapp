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
}

/**
 * SeamlessPlayer (double-buffered)
 * - Keeps TWO <Video> components mounted at all times.
 * - Preloads the next clip in the hidden player.
 * - When advancing, we START the next player first, and only swap the UI once
 *   the next player reports "isPlaying" (this prevents a visible pause/black frame).
 */
export default function SeamlessPlayer({ playlist, hotspots, onEnd }: Props) {
  const { advanceOnTouchDown } = useAppSettings();
  const [index, setIndex] = useState(0);
  const [activePlayer, setActivePlayer] = useState<'A' | 'B'>('A');

  const videoA = useRef<Video>(null);
  const videoB = useRef<Video>(null);

  const pendingSwitchTo = useRef<'A' | 'B' | null>(null);
  const pendingIndex = useRef<number | null>(null);
  const fallbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    initializePlayer();
    return () => {
      if (fallbackTimer.current) clearTimeout(fallbackTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initializePlayer = async () => {
    // Load first video into A and start playing
    await loadSource(videoA, playlist[0], true);

    // Preload second video into B (if exists)
    if (playlist.length > 1) {
      await loadSource(videoB, playlist[1], false);
    }
  };

  const loadSource = async (ref: React.RefObject<Video>, uri: string, shouldPlay: boolean) => {
    if (!ref.current) return;
    try {
      // Clear any previous state
      await ref.current.unloadAsync();
    } catch (e) {}
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
        true // downloadFirst helps avoid a visible hiccup on switch
      );
      if (!shouldPlay) {
        // Ensure hidden player is ready at t=0
        await ref.current.setPositionAsync(0);
        await ref.current.pauseAsync();
      }
    } catch (e) {
      console.log('Load error', e);
    }
  };

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
      const oldRef = player === 'A' ? videoB : videoA;

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
      cleanupAndPreload(oldRef, nextIndex + 1);

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
    if (fallbackTimer.current) clearTimeout(fallbackTimer.current);
    fallbackTimer.current = setTimeout(() => {
      if (pendingSwitchTo.current === nextPlayer) {
        swapTo(nextPlayer);
      }
    }, 700);

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

  const cleanupAndPreload = async (oldRef: React.RefObject<Video>, futureIndex: number) => {
    try {
      await oldRef.current?.stopAsync();
    } catch (e) {}
    try {
      if (futureIndex < playlist.length) {
        // Load the *future* clip into the now-hidden player
        await loadSource(oldRef, playlist[futureIndex], false);
      } else {
        // Nothing left to preload; keep it unloaded to save memory
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
