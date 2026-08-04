import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { getTheme } from '../theme';
import { useAppSettings } from '../settings/AppSettingsContext';
import PrimaryButton from '../ui/PrimaryButton';

interface Props {
  videoPaths: string[];
  onReady: () => void;
  onCancel: () => void;
}

export default function LoadingScreen({ videoPaths, onReady, onCancel }: Props) {
  const { themeMode } = useAppSettings();
  const theme = getTheme(themeMode);
  const styles = createStyles(theme);

  const [progress, setProgress] = useState(0);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let mounted = true;

    const preloadVideos = async () => {
      const total = videoPaths.length;
      for (let i = 0; i < total; i++) {
        if (!mounted) return;
        await new Promise(r => setTimeout(r, 400)); 
        setProgress(((i + 1) / total) * 100);
      }
      setIsReady(true);
    };

    preloadVideos();
    return () => { mounted = false; };
  }, [videoPaths]);

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <ActivityIndicator size="large" color={theme.colors.primary} style={{ marginBottom: 24 }} />
        <Text style={styles.title}>Preparing Experience</Text>
        <Text style={styles.subtitle}>Optimizing video transitions for seamless playback...</Text>

        <View style={styles.barContainer}>
          <View style={[styles.barFill, { width: `${progress}%` }]} />
        </View>

        <Text style={styles.percent}>{Math.round(progress)}%</Text>
      </View>

      <View style={styles.footer}>
        {isReady ? (
          <PrimaryButton title="START EXPERIENCE" onPress={onReady} />
        ) : (
          <PrimaryButton title="Cancel" variant="outline" onPress={onCancel} />
        )}
      </View>
    </View>
  );
}

const createStyles = (theme: any) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background, padding: theme.spacing.xl },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { ...theme.text.title, fontSize: 24, marginBottom: 8, textAlign: 'center' },
  subtitle: { ...theme.text.caption, textAlign: 'center', marginBottom: 40, paddingHorizontal: 20 },
  barContainer: { width: '100%', height: 6, backgroundColor: theme.colors.surface, borderRadius: 3, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: theme.colors.primary },
  percent: { color: theme.colors.textSecondary, marginTop: 12, fontSize: 14, fontWeight: '600' },
  footer: { paddingBottom: theme.spacing.xl }
});
