import React, { useState } from 'react';
import { View, StyleSheet, TouchableWithoutFeedback, Text, Alert } from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getTheme } from '../theme';
import { useAppSettings } from '../settings/AppSettingsContext';
import PrimaryButton from '../ui/PrimaryButton';
import { Hotspot } from '../storage/videoStorage';

interface Props {
  videoUri: string;
  initialHotspot: Hotspot | null;
  onSave: (hotspot: Hotspot) => void;
  onCancel: () => void;
}

export default function HotspotEditor({ videoUri, initialHotspot, onSave, onCancel }: Props) {
  const { themeMode } = useAppSettings();
  const theme = getTheme(themeMode);
  const styles = createStyles(theme);

  const { showStatusBar } = useAppSettings();
  const [hotspot, setHotspot] = useState<Hotspot | null>(initialHotspot);
  const [videoLayout, setVideoLayout] = useState({ width: 0, height: 0 });

  const handlePress = (event: any) => {
    const { locationX, locationY } = event.nativeEvent;
    const x = (locationX / videoLayout.width) * 100;
    const y = (locationY / videoLayout.height) * 100;
    const hw = 25;
    const hh = 25;

    setHotspot({
      x: Math.max(0, Math.min(100 - hw, x - hw / 2)),
      y: Math.max(0, Math.min(100 - hh, y - hh / 2)),
      width: hw,
      height: hh
    });
  };

  const handleSave = () => {
    if (!hotspot) {
      Alert.alert("No Hotspot", "Please tap on the screen to set where the user should click.");
      return;
    }
    onSave(hotspot);
  };

  return (
    <SafeAreaView
      style={styles.container}
      edges={showStatusBar ? ['top', 'left', 'right', 'bottom'] : ['left', 'right', 'bottom']}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Set Click Area</Text>
        <Text style={styles.subtitle}>Tap where the user should click to advance.</Text>
      </View>

      <View 
        style={styles.videoContainer}
        onLayout={(e) => setVideoLayout(e.nativeEvent.layout)}
      >
        <TouchableWithoutFeedback onPress={handlePress}>
          <View style={styles.touchArea}>
            <Video
              source={{ uri: videoUri }}
              style={styles.video}
              resizeMode={ResizeMode.COVER}
              shouldPlay
              isLooping
              isMuted
            />
            {hotspot && (
              <View 
                style={[
                  styles.hotspotIndicator,
                  {
                    left: `${hotspot.x}%`,
                    top: `${hotspot.y}%`,
                    width: `${hotspot.width}%`,
                    height: `${hotspot.height}%`,
                  }
                ]}
              >
                <View style={styles.hotspotPulse} />
              </View>
            )}
          </View>
        </TouchableWithoutFeedback>
      </View>

      <View style={styles.footer}>
        <PrimaryButton 
          title="Cancel" 
          onPress={onCancel} 
          variant="secondary" 
          style={{ flex: 1, marginRight: 8 }}
        />
        <PrimaryButton 
          title="Save Area" 
          onPress={handleSave} 
          style={{ flex: 2 }}
        />
      </View>
    </SafeAreaView>
  );
}

const createStyles = (theme: any) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  header: { padding: theme.spacing.m, zIndex: 10 },
  title: { ...theme.text.title, fontSize: 24 },
  subtitle: { ...theme.text.caption, marginTop: 4 },
  videoContainer: {
    flex: 1,
    marginVertical: theme.spacing.m,
    backgroundColor: '#000',
    overflow: 'hidden',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  touchArea: { flex: 1 },
  video: { width: '100%', height: '100%' },
  hotspotIndicator: {
    position: 'absolute',
    borderWidth: 3,
    borderColor: theme.colors.primary,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 122, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  hotspotPulse: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: theme.colors.primary,
  },
  footer: { 
    flexDirection: 'row', 
    padding: theme.spacing.m,
    paddingBottom: theme.spacing.xl 
  }
});
