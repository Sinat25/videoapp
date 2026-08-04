import React from 'react';
import { View, StyleSheet } from 'react-native';
import SeamlessPlayer from '../video/SeamlessPlayer';
import { Hotspot } from '../storage/videoStorage';

interface Props {
  videoPaths: string[];
  hotspots: (Hotspot | null)[];
  onExit: () => void;
  /** Forwarded to the player: fires once the first video frame is on screen. */
  onFirstFrame?: () => void;
}

export default function PlayerScreen({ videoPaths, hotspots, onExit, onFirstFrame }: Props) {
  return (
    <View style={styles.container}>
        <SeamlessPlayer
            playlist={videoPaths}
            hotspots={hotspots}
            onEnd={onExit}
            onFirstFrame={onFirstFrame}
        />
    </View>
  );
}

const styles = StyleSheet.create({
  // Container must be flex: 1 to fill the screen including status bar area
  container: { flex: 1, backgroundColor: '#000' }
});
