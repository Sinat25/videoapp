import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  StyleSheet, 
  View, 
  Text, 
  TouchableOpacity, 
  ScrollView, 
  Dimensions, 
  ActivityIndicator,
  StatusBar,
  Alert
} from 'react-native';
import { Video, ResizeMode, Audio, AVPlaybackStatus } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { BlurView } from 'expo-blur';

const { width, height } = Dimensions.get('window');

// --- Configuration ---
const STEP_COUNT = 5; 
const VIDEO_DIR = `${FileSystem.documentDirectory}videos/`;

interface VideoStep {
  id: number;
  uri: string | null;
}

export default function App() {
  // App Logic State
  const [isAppReady, setIsAppReady] = useState(false);
  const [setupMode, setSetupMode] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [steps, setSteps] = useState<VideoStep[]>(
    Array.from({ length: STEP_COUNT }, (_, i) => ({ id: i, uri: null }))
  );

  // Playback State
  const [currentIndex, setCurrentIndex] = useState(0);
  const [activePlayer, setActivePlayer] = useState<'A' | 'B'>('A');
  
  // Refs for zero-latency control
  const playerA = useRef<Video>(null);
  const playerB = useRef<Video>(null);
  const isTransitioning = useRef(false);

  // --- Initial Setup ---
  useEffect(() => {
    (async () => {
      // Configure Audio for Professional Playback (Ignores Mute Switch)
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        interruptionModeIOS: 1, // Do not interrupt
      });
      await prepareDirectory();
      await loadSavedAssets();
    })();
  }, []);

  const prepareDirectory = async () => {
    const info = await FileSystem.getInfoAsync(VIDEO_DIR);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(VIDEO_DIR, { intermediates: true });
    }
  };

  const loadSavedAssets = async () => {
    try {
      const files = await FileSystem.readDirectoryAsync(VIDEO_DIR);
      const updatedSteps = [...steps];
      files.forEach(file => {
        const index = parseInt(file.split('_')[1]);
        if (index < STEP_COUNT) {
          updatedSteps[index].uri = VIDEO_DIR + file;
        }
      });
      setSteps(updatedSteps);
    } catch (e) {
      console.error("Storage Error", e);
    }
  };

  // --- Asset Management ---
  const handleUpload = async (index: number) => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      allowsEditing: false,
      quality: 1,
    });

    if (!result.canceled) {
      const source = result.assets[0].uri;
      const destination = `${VIDEO_DIR}step_${index}.mp4`;
      
      try {
        await FileSystem.copyAsync({ from: source, to: destination });
        const newSteps = [...steps];
        newSteps[index].uri = destination;
        setSteps(newSteps);
      } catch (e) {
        Alert.alert("Upload Error", "Could not save video locally.");
      }
    }
  };

  // --- The Seamless Engine ---
  const startExperience = async () => {
    if (steps.some(s => !s.uri)) {
      Alert.alert("Steps Incomplete", "Please upload all videos to ensure a seamless flow.");
      return;
    }

    setIsLoading(true);

    try {
      // 1. Prime Player A with the first video
      await playerA.current?.loadAsync(
        { uri: steps[0].uri! },
        { shouldPlay: true, isMuted: false, volume: 1.0 },
        false
      );

      // 2. Prime Player B with the NEXT video (Pre-caching)
      await playerB.current?.loadAsync(
        { uri: steps[1].uri! },
        { shouldPlay: false, isMuted: false, volume: 1.0 },
        false
      );

      setSetupMode(false);
    } catch (e) {
      Alert.alert("Engine Error", "Failed to initialize video players.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleGlobalTap = useCallback(async () => {
    if (isTransitioning.current) return;
    isTransitioning.current = true;

    const nextIndex = (currentIndex + 1) % steps.length;
    const preloadIndex = (nextIndex + 1) % steps.length;

    if (activePlayer === 'A') {
      // Player B is already primed. Switch to it instantly.
      await playerB.current?.playAsync();
      setActivePlayer('B');
      
      // Cleanup Player A and prime it with the video AFTER the current one
      await playerA.current?.unloadAsync();
      playerA.current?.loadAsync({ uri: steps[preloadIndex].uri! }, { shouldPlay: false }, false);
    } else {
      // Player A is already primed. Switch to it instantly.
      await playerA.current?.playAsync();
      setActivePlayer('A');

      // Cleanup Player B and prime it with the video AFTER the current one
      await playerB.current?.unloadAsync();
      playerB.current?.loadAsync({ uri: steps[preloadIndex].uri! }, { shouldPlay: false }, false);
    }

    setCurrentIndex(nextIndex);
    
    // Release the lock after a short buffer to prevent "double tapping"
    setTimeout(() => { isTransitioning.current = false; }, 400);
  }, [currentIndex, activePlayer, steps]);

  // --- UI Components ---
  if (setupMode) {
    return (
      <View style={styles.adminContainer}>
        <StatusBar barStyle="light-content" />
        <View style={styles.header}>
          <Text style={styles.title}>Director Suite</Text>
          <Text style={styles.subtitle}>Configure your seamless experience</Text>
        </View>

        <ScrollView contentContainerStyle={styles.scrollList} showsVerticalScrollIndicator={false}>
          {steps.map((step, i) => (
            <TouchableOpacity 
              key={i} 
              onPress={() => handleUpload(i)}
              style={[styles.stepCard, step.uri ? styles.stepReady : {}]}
            >
              <View>
                <Text style={styles.stepTitle}>Sequence 0{i + 1}</Text>
                <Text style={styles.stepStatus}>{step.uri ? 'ASSET ENCODED' : 'PENDING UPLOAD'}</Text>
              </View>
              {step.uri && <Text style={styles.checkIcon}>✓</Text>}
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={styles.footer}>
          {isLoading ? (
            <View style={styles.loaderWrapper}>
              <ActivityIndicator color="#007AFF" />
              <Text style={styles.loaderText}>SYCHRONIZING BUFFERS...</Text>
            </View>
          ) : (
            <TouchableOpacity style={styles.mainStartBtn} onPress={startExperience}>
              <Text style={styles.mainStartBtnText}>LAUNCH IMMERSION</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }

  return (
    <TouchableOpacity activeOpacity={1} style={styles.viewport} onPress={handleGlobalTap}>
      <StatusBar hidden />
      
      {/* Primary Buffer */}
      <Video
        ref={playerA}
        style={[styles.fullVideo, { 
          opacity: activePlayer === 'A' ? 1 : 0,
          zIndex: activePlayer === 'A' ? 10 : 1 
        }]}
        resizeMode={ResizeMode.COVER}
        isLooping
      />

      {/* Secondary Buffer */}
      <Video
        ref={playerB}
        style={[styles.fullVideo, { 
          opacity: activePlayer === 'B' ? 1 : 0, 
          zIndex: activePlayer === 'B' ? 10 : 1 
        }]}
        resizeMode={ResizeMode.COVER}
        isLooping
      />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  adminContainer: { flex: 1, backgroundColor: '#000', paddingHorizontal: 25 },
  header: { marginTop: 80, marginBottom: 30 },
  title: { color: '#FFF', fontSize: 38, fontWeight: '900', letterSpacing: -1.5 },
  subtitle: { color: '#666', fontSize: 16, marginTop: 5 },
  scrollList: { paddingBottom: 150 },
  stepCard: {
    backgroundColor: '#111',
    padding: 24,
    borderRadius: 20,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#222'
  },
  stepReady: { borderColor: '#007AFF33', backgroundColor: '#007AFF10' },
  stepTitle: { color: '#FFF', fontSize: 18, fontWeight: '700' },
  stepStatus: { color: '#555', fontSize: 12, fontWeight: '800', marginTop: 4, letterSpacing: 1 },
  checkIcon: { color: '#007AFF', fontSize: 20, fontWeight: 'bold' },
  footer: { position: 'absolute', bottom: 40, left: 25, right: 25 },
  mainStartBtn: { 
    backgroundColor: '#007AFF', 
    height: 70, 
    borderRadius: 24, 
    justifyContent: 'center', 
    alignItems: 'center' 
  },
  mainStartBtnText: { color: '#FFF', fontSize: 16, fontWeight: '900', letterSpacing: 2 },
  loaderWrapper: { alignItems: 'center' },
  loaderText: { color: '#007AFF', fontSize: 12, fontWeight: '900', marginTop: 10, letterSpacing: 2 },
  viewport: { flex: 1, backgroundColor: '#000' },
  fullVideo: { ...StyleSheet.absoluteFillObject },
});
