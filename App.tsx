import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { 
  StyleSheet, View, Text, Pressable, ScrollView, Alert, Dimensions, 
  ActivityIndicator, StatusBar 
} from 'react-native';
import { Video, ResizeMode, Audio } from 'expo-av'; // Using expo-av for max compatibility with Sideloadly
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { LinearGradient } from 'expo-linear-gradient';
import { Film, Upload, Trash2, Plus, CheckCircle, Play } from 'lucide-react-native';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const VIDEO_STORAGE_KEY = 'video_steps_data';
const VIDEO_DIR = `${FileSystem.documentDirectory}videos/`;

// --- [PART 1: src/lib/videoStore.ts] ---
export interface VideoStep { id: string; stepNumber: number; uri: string; originalName: string; }
interface VideoStore {
  videos: VideoStep[];
  isLoading: boolean;
  loadVideos: () => Promise<void>;
  addVideo: (stepNumber: number, sourceUri: string, originalName: string) => Promise<void>;
  removeVideo: (stepNumber: number) => Promise<void>;
  getVideoByStep: (stepNumber: number) => VideoStep | undefined;
}

const useVideoStore = create<VideoStore>((set, get) => ({
  videos: [],
  isLoading: true,
  loadVideos: async () => {
    try {
      const dirInfo = await FileSystem.getInfoAsync(VIDEO_DIR);
      if (!dirInfo.exists) await FileSystem.makeDirectoryAsync(VIDEO_DIR, { intermediates: true });
      const stored = await AsyncStorage.getItem(VIDEO_STORAGE_KEY);
      if (stored) {
        const videos: VideoStep[] = JSON.parse(stored);
        const validVideos = [];
        for (const v of videos) {
          const info = await FileSystem.getInfoAsync(v.uri);
          if (info.exists) validVideos.push(v);
        }
        set({ videos: validVideos, isLoading: false });
      } else { set({ isLoading: false }); }
    } catch (e) { set({ isLoading: false }); }
  },
  addVideo: async (stepNumber, sourceUri, originalName) => {
    const id = `step_${stepNumber}_${Date.now()}`;
    const extension = originalName.split('.').pop() || 'mp4';
    const destUri = `${VIDEO_DIR}${id}.${extension}`;
    await FileSystem.copyAsync({ from: sourceUri, to: destUri });
    const newVideo = { id, stepNumber, uri: destUri, originalName };
    const { videos } = get();
    const existing = videos.find(v => v.stepNumber === stepNumber);
    if (existing) await FileSystem.deleteAsync(existing.uri, { idempotent: true });
    const updated = videos.filter(v => v.stepNumber !== stepNumber).concat(newVideo).sort((a,b) => a.stepNumber - b.stepNumber);
    set({ videos: updated });
    await AsyncStorage.setItem(VIDEO_STORAGE_KEY, JSON.stringify(updated));
  },
  removeVideo: async (stepNumber) => {
    const { videos } = get();
    const video = videos.find(v => v.stepNumber === stepNumber);
    if (video) await FileSystem.deleteAsync(video.uri, { idempotent: true });
    const updated = videos.filter(v => v.stepNumber !== stepNumber);
    set({ videos: updated });
    await AsyncStorage.setItem(VIDEO_STORAGE_KEY, JSON.stringify(updated));
  },
  getVideoByStep: (stepNumber) => get().videos.find(v => v.stepNumber === stepNumber),
}));

// --- [PART 2: src/app/player.tsx (Seamless Layer)] ---
function VideoLayer({ uri, isActive, zIndex }: { uri: string, isActive: boolean, zIndex: number }) {
  const videoRef = useRef<Video>(null);
  useEffect(() => {
    if (isActive) videoRef.current?.playAsync();
    else videoRef.current?.stopAsync();
  }, [isActive]);

  return (
    <View style={[styles.layer, { zIndex, opacity: isActive ? 1 : 0 }]}>
      <Video
        ref={videoRef}
        source={{ uri }}
        style={styles.full}
        resizeMode={ResizeMode.COVER}
        isLooping={false}
        shouldPlay={isActive}
      />
    </View>
  );
}

// --- [PART 3: MAIN APPLICATION INTEGRATION] ---
export default function App() {
  const [currentScreen, setCurrentScreen] = useState<'index' | 'loading' | 'player'>('index');
  const { videos, loadVideos, addVideo, removeVideo, getVideoByStep } = useVideoStore();
  
  // Loading & Player State
  const [progress, setProgress] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [stepCount, setStepCount] = useState(3);
  const [uploadingStep, setUploadingStep] = useState<number | null>(null);

  useEffect(() => { loadVideos(); }, []);

  // --- Handlers (index.tsx logic) ---
  const handleUpload = async (stepNumber: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert('Select Video Source', '', [
      { text: 'Library', onPress: async () => {
          let result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Videos });
          if (!result.canceled) {
            setUploadingStep(stepNumber);
            await addVideo(stepNumber, result.assets[0].uri, result.assets[0].fileName || 'video.mp4');
            setUploadingStep(null);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }
      }},
      { text: 'Files', onPress: async () => {
          let result = await DocumentPicker.getDocumentAsync({ type: 'video/*' });
          if (!result.canceled) {
            setUploadingStep(stepNumber);
            await addVideo(stepNumber, result.assets[0].uri, result.assets[0].name);
            setUploadingStep(null);
          }
      }},
      { text: 'Cancel', style: 'cancel' }
    ]);
  };

  const handleStart = () => {
    if (videos.length === 0) return;
    setCurrentScreen('loading');
    // Preload Logic (loading.tsx)
    let p = 0;
    const interval = setInterval(() => {
      p += 2;
      setProgress(p);
      if (p >= 100) {
        clearInterval(interval);
        setIsReady(true);
      }
    }, 50);
  };

  const handleTap = () => {
    if (currentIndex + 1 < videos.length) {
      setCurrentIndex(currentIndex + 1);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } else {
      setCurrentScreen('index');
      setCurrentIndex(0);
      setIsReady(false);
      setProgress(0);
    }
  };

  // --- SCREEN: PLAYER ---
  if (currentScreen === 'player') {
    return (
      <Pressable onPress={handleTap} style={styles.full}>
        <StatusBar hidden />
        {videos.map((v, i) => (
          <VideoLayer key={v.id} uri={v.uri} isActive={i === currentIndex} zIndex={videos.length - i} />
        ))}
      </Pressable>
    );
  }

  // --- SCREEN: LOADING ---
  if (currentScreen === 'loading') {
    return (
      <LinearGradient colors={['#0a0a0a', '#111']} style={styles.center}>
        <Text style={styles.progressText}>{progress}%</Text>
        <View style={styles.barContainer}><View style={[styles.bar, { width: `${progress}%` }]} /></View>
        {isReady && (
          <TouchableOpacity style={styles.launchBtn} onPress={() => setCurrentScreen('player')}>
            <Play size={24} color="black" fill="black" />
            <Text style={styles.launchBtnText}>START</Text>
          </TouchableOpacity>
        )}
      </LinearGradient>
    );
  }

  // --- SCREEN: INDEX (Upload) ---
  return (
    <View style={styles.blackBg}>
      <LinearGradient colors={['#0a0a0a', '#1a1a1a']} style={styles.full}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.header}>
            <Film size={28} color="white" />
            <Text style={styles.title}>Video Steps</Text>
          </View>
          
          {Array.from({ length: stepCount }, (_, i) => i + 1).map((num) => {
            const video = getVideoByStep(num);
            return (
              <Pressable key={num} onPress={() => handleUpload(num)} style={styles.card}>
                <View style={styles.cardLeft}>
                  <View style={styles.stepCircle}>
                    {video ? <CheckCircle size={20} color="#22c55e" /> : <Text style={styles.stepNum}>{num}</Text>}
                  </View>
                  <View>
                    <Text style={styles.cardTitle}>Step {num}</Text>
                    <Text style={styles.cardSub}>{video ? video.originalName : 'Tap to upload'}</Text>
                  </View>
                </View>
                {video && (
                  <TouchableOpacity onPress={() => removeVideo(num)}>
                    <Trash2 size={20} color="#ef4444" />
                  </TouchableOpacity>
                )}
              </Pressable>
            );
          })}
          
          <TouchableOpacity onPress={() => setStepCount(s => s + 1)} style={styles.addStep}>
            <Plus size={20} color="#666" />
            <Text style={styles.addStepText}>Add Another Step</Text>
          </TouchableOpacity>
        </ScrollView>

        {videos.length > 0 && (
          <TouchableOpacity style={styles.floatBtn} onPress={handleStart}>
            <LinearGradient colors={['#fff', '#e5e5e5']} style={styles.gradientBtn}>
              <Play size={20} color="black" fill="black" />
              <Text style={styles.btnText}>Start Experience</Text>
            </LinearGradient>
          </TouchableOpacity>
        )}
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  full: { flex: 1 },
  blackBg: { flex: 1, backgroundColor: 'black' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  layer: { position: 'absolute', top: 0, left: 0, width: SCREEN_WIDTH, height: SCREEN_HEIGHT },
  scroll: { padding: 20, paddingTop: 60, paddingBottom: 150 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  title: { color: 'white', fontSize: 30, fontWeight: 'bold', ml: 12, marginLeft: 10 },
  card: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 20, padding: 20, marginBottom: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderSize: 1, borderColor: 'rgba(255,255,255,0.1)' },
  cardLeft: { flexDirection: 'row', alignItems: 'center' },
  stepCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center', marginRight: 15 },
  stepNum: { color: 'rgba(255,255,255,0.6)', fontWeight: 'bold' },
  cardTitle: { color: 'white', fontSize: 18, fontWeight: '600' },
  cardSub: { color: 'rgba(255,255,255,0.4)', fontSize: 14, marginTop: 2 },
  addStep: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 20, borderStyle: 'dashed', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', borderRadius: 20 },
  addStepText: { color: '#666', marginLeft: 10 },
  floatBtn: { position: 'absolute', bottom: 40, left: 20, right: 20 },
  gradientBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 60, borderRadius: 20 },
  btnText: { color: 'black', fontWeight: 'bold', fontSize: 18, marginLeft: 10 },
  progressText: { color: 'white', fontSize: 60, fontWeight: '900' },
  barContainer: { width: '100%', height: 6, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 3, marginTop: 20 },
  bar: { height: '100%', backgroundColor: 'white', borderRadius: 3 },
  launchBtn: { position: 'absolute', bottom: 60, backgroundColor: 'white', flexDirection: 'row', paddingHorizontal: 40, paddingVertical: 20, borderRadius: 20, alignItems: 'center' },
  launchBtnText: { color: 'black', fontWeight: 'bold', fontSize: 20, marginLeft: 10 }
});
