import React from 'react';
import { View, StyleSheet } from 'react-native';
import SeamlessPlayer from '../video/SeamlessPlayer';
import { Hotspot } from '../storage/videoStorage';

interface Props {
  videoPaths: string[];
  hotspots: (Hotspot | null)[];
  onExit: () => void;
}

export default function PlayerScreen({ videoPaths, hotspots, onExit }: Props) {
  return (
    <View style={styles.container}>
        <SeamlessPlayer 
            playlist={videoPaths} 
            hotspots={hotspots}
            onEnd={onExit}
        />
    </View>
  );
}

const styles = StyleSheet.create({
  // Container must be flex: 1 to fill the screen including status bar area
  container: { flex: 1, backgroundColor: '#000' }
});
