import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, TouchableOpacity, Text, Dimensions, StatusBar } from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width, height } = Dimensions.get('window');

export default function App() {
  const [uris, setUris] = useState<string[]>([]);
  const [playing, setPlaying] = useState(false);
  const [index, setIndex] = useState(0);
  const [isReady, setIsReady] = useState(false);

  // Buffer Players
  const playerA = useRef<Video>(null);
  const playerB = useRef<Video>(null);
  const [activePlayer, setActivePlayer] = useState<'A' | 'B'>('A');

  const pickVideo = async (i: number) => {
    let result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Videos });
    if (!result.canceled) {
      const path = `${FileSystem.documentDirectory}vid${i}.mp4`;
      await FileSystem.copyAsync({ from: result.assets[0].uri, to: path });
      const newUris = [...uris];
      newUris[i] = path;
      setUris(newUris);
      await AsyncStorage.setItem('vids', JSON.stringify(newUris));
    }
  };

  const next = () => {
    setIndex((prev) => (prev + 1) % uris.length);
    setActivePlayer(activePlayer === 'A' ? 'B' : 'A');
  };

  if (playing) {
    return (
      <TouchableOpacity activeOpacity={1} onPress={next} style={styles.full}>
        <StatusBar hidden />
        <Video
          ref={activePlayer === 'A' ? playerA : playerB}
          source={{ uri: uris[index] }}
          style={styles.full}
          resizeMode={ResizeMode.COVER}
          shouldPlay
          isLooping={false}
        />
        {/* Hidden buffer player for next video */}
        <Video
          ref={activePlayer === 'A' ? playerB : playerA}
          source={{ uri: uris[(index + 1) % uris.length] }}
          style={{ width: 0, height: 0 }}
          shouldPlay={false}
        />
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.setup}>
      <Text style={styles.title}>Flow Setup</Text>
      {[0, 1, 2].map(i => (
        <TouchableOpacity key={i} onPress={() => pickVideo(i)} style={styles.btn}>
          <Text style={styles.txt}>{uris[i] ? `✅ Step ${i+1} Loaded` : `Upload Step ${i+1}`}</Text>
        </TouchableOpacity>
      ))}
      {uris.length >= 2 && (
        <TouchableOpacity onPress={() => setPlaying(true)} style={styles.start}>
          <Text style={styles.startTxt}>START SEAMLESS PLAYBACK</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  full: { width, height, backgroundColor: '#000' },
  setup: { flex: 1, backgroundColor: '#111', justifyContent: 'center', padding: 20 },
  title: { color: '#fff', fontSize: 32, fontWeight: 'bold', marginBottom: 40, textAlign: 'center' },
  btn: { backgroundColor: '#222', padding: 20, borderRadius: 12, marginBottom: 15, borderWidth: 1, borderColor: '#444' },
  txt: { color: '#fff', textAlign: 'center', fontWeight: '600' },
  start: { backgroundColor: '#34C759', padding: 25, borderRadius: 15, marginTop: 30 },
  startTxt: { color: '#fff', textAlign: 'center', fontWeight: '900', fontSize: 18 }
});