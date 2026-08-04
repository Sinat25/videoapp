import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, TouchableOpacity, Switch, TextInput, KeyboardAvoidingView, Platform, Modal } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Video, ResizeMode } from 'expo-av';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getTheme } from '../theme';
import PrimaryButton from '../ui/PrimaryButton';
import { VideoStorage, Hotspot } from '../storage/videoStorage';
import HotspotEditor from './HotspotEditor';
import { useAppSettings } from '../settings/AppSettingsContext';
import { scheduleManualNotificationsAsync } from '../notifications/notificationService';

// Persist manual notification fields so the user does not need to re-enter them every time.
const NOTIF_TITLE_KEY = 'MANUAL_NOTIF_TITLE';
const NOTIF_DESC_KEY = 'MANUAL_NOTIF_DESC';
const NOTIF_TIME_KEY = 'MANUAL_NOTIF_TIME';
const NOTIF_USE_TIME_KEY = 'MANUAL_NOTIF_USE_TIME';

/**
 * Turn a clock time like "19:44:12" (or "19:44") into how many seconds from now
 * it is. If that time already passed today, it targets the same time tomorrow.
 * Returns null if the string is not a valid time.
 */
function secondsUntilTime(timeStr: string): number | null {
  const parts = timeStr.trim().split(':');
  if (parts.length < 2 || parts.length > 3) return null;

  const h = Number.parseInt(parts[0], 10);
  const m = Number.parseInt(parts[1], 10);
  const s = parts.length === 3 ? Number.parseInt(parts[2], 10) : 0;

  if (![h, m, s].every(Number.isFinite)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59 || s < 0 || s > 59) return null;

  const now = new Date();
  const target = new Date();
  target.setHours(h, m, s, 0);

  let diff = Math.round((target.getTime() - now.getTime()) / 1000);
  if (diff <= 0) diff += 24 * 60 * 60; // already passed today -> tomorrow
  return diff;
}

interface Props {
  onStart: (paths: string[], hotspots: (Hotspot | null)[], startVideo: string | null) => void;
  existingVideos: string[];
  existingHotspots: (Hotspot | null)[];
}

export default function UploadScreen({ onStart, existingVideos, existingHotspots }: Props) {
  const [steps, setSteps] = useState<(string | null)[]>([null, null, null]);
  const [hotspots, setHotspots] = useState<(Hotspot | null)[]>([null, null, null]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  // Video currently being previewed in the full-screen player modal.
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  // Path of the clip chosen to open first (null = natural first in the list).
  const [startVideo, setStartVideo] = useState<string | null>(null);

  // ✅ Status bar switcher (Show/Hide iPhone status bar)
  const { showStatusBar, setShowStatusBar, themeMode, setThemeMode, advanceOnTouchDown, setAdvanceOnTouchDown } = useAppSettings();
  const theme = getTheme(themeMode);
  const styles = createStyles(theme);

  // ✅ Manual notification inputs
  const [notifTitle, setNotifTitle] = useState('');
  const [notifDesc, setNotifDesc] = useState('');
  const [notifSeconds, setNotifSeconds] = useState('5');
  const [notifCount, setNotifCount] = useState('1');
  const [notifSending, setNotifSending] = useState(false);
  const [notifFieldsLoaded, setNotifFieldsLoaded] = useState(false);
  // Schedule at an exact clock time (HH:MM:SS) instead of "after N seconds".
  const [notifUseTime, setNotifUseTime] = useState(false);
  const [notifTime, setNotifTime] = useState('19:44:12');

  // Load saved manual notification title/description
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const savedTitle = await AsyncStorage.getItem(NOTIF_TITLE_KEY);
        const savedDesc = await AsyncStorage.getItem(NOTIF_DESC_KEY);
        const savedTime = await AsyncStorage.getItem(NOTIF_TIME_KEY);
        const savedUseTime = await AsyncStorage.getItem(NOTIF_USE_TIME_KEY);
        if (!mounted) return;
        if (savedTitle !== null) setNotifTitle(savedTitle);
        if (savedDesc !== null) setNotifDesc(savedDesc);
        if (savedTime !== null) setNotifTime(savedTime);
        if (savedUseTime !== null) setNotifUseTime(savedUseTime === '1');
      } catch (e) {
        // Ignore storage read errors (feature is optional)
      } finally {
        if (mounted) setNotifFieldsLoaded(true);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Persist on change (after initial load)
  useEffect(() => {
    if (!notifFieldsLoaded) return;
    AsyncStorage.setItem(NOTIF_TITLE_KEY, notifTitle).catch(() => {});
  }, [notifTitle, notifFieldsLoaded]);

  useEffect(() => {
    if (!notifFieldsLoaded) return;
    AsyncStorage.setItem(NOTIF_DESC_KEY, notifDesc).catch(() => {});
  }, [notifDesc, notifFieldsLoaded]);

  useEffect(() => {
    if (!notifFieldsLoaded) return;
    AsyncStorage.setItem(NOTIF_TIME_KEY, notifTime).catch(() => {});
  }, [notifTime, notifFieldsLoaded]);

  useEffect(() => {
    if (!notifFieldsLoaded) return;
    AsyncStorage.setItem(NOTIF_USE_TIME_KEY, notifUseTime ? '1' : '0').catch(() => {});
  }, [notifUseTime, notifFieldsLoaded]);

  useEffect(() => {
    if (existingVideos.length > 0) {
      setSteps(existingVideos);
      const hs = [...existingHotspots];
      while (hs.length < existingVideos.length) hs.push(null);
      setHotspots(hs);
    }
  }, [existingVideos, existingHotspots]);

  // Load the saved "opens first" choice.
  useEffect(() => {
    let mounted = true;
    VideoStorage.getStartVideo()
      .then((v) => { if (mounted) setStartVideo(v); })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  // The clip that actually opens first: the saved choice if it still exists,
  // otherwise the first uploaded clip in the list.
  const firstNonNull = steps.find((s) => s !== null) ?? null;
  const effectiveFirst = startVideo && steps.includes(startVideo) ? startVideo : firstNonNull;

  const setOpensFirst = (uri: string, value: boolean) => {
    const next = value ? uri : null; // turning off reverts to the natural first
    setStartVideo(next);
    VideoStorage.saveStartVideo(next).catch(() => {});
  };

  const pickVideo = async (index: number) => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      allowsEditing: true,
      quality: 1,
    });

    if (!result.canceled && result.assets[0]) {
      const newSteps = [...steps];
      try {
        const previousPath = steps[index];
        const savedPath = await VideoStorage.saveVideoFile(result.assets[0].uri, index);
        newSteps[index] = savedPath;
        setSteps(newSteps);

        const validPaths = newSteps.filter((s): s is string => s !== null);
        await VideoStorage.saveVideos(validPaths);

        // Keep the "opens first" choice pointing at this slot if it changed.
        if (previousPath && previousPath === startVideo) {
          setStartVideo(savedPath);
          await VideoStorage.saveStartVideo(savedPath);
        }
      } catch (e) {
        Alert.alert("Error", "Failed to save video.");
      }
    }
  };

  const addStep = () => {
    setSteps([...steps, null]);
    setHotspots([...hotspots, null]);
  };

  const removeStep = (index: number) => {
    const removedUri = steps[index];
    const newSteps = steps.filter((_, i) => i !== index);
    const newHotspots = hotspots.filter((_, i) => i !== index);
    setSteps(newSteps);
    setHotspots(newHotspots);
    VideoStorage.saveVideos(newSteps.filter((s): s is string => s !== null));
    VideoStorage.saveHotspots(newHotspots);
    // If the removed clip was the chosen opener, revert to the natural first.
    if (removedUri && removedUri === startVideo) {
      setStartVideo(null);
      VideoStorage.saveStartVideo(null).catch(() => {});
    }
  };

  const saveHotspot = async (hotspot: Hotspot) => {
    if (editingIndex !== null) {
      const newHotspots = [...hotspots];
      newHotspots[editingIndex] = hotspot;
      setHotspots(newHotspots);
      await VideoStorage.saveHotspots(newHotspots);
      setEditingIndex(null);
    }
  };

  const scheduleManualNotification = async () => {
    const count = Number.parseInt(notifCount, 10);
    if (!notifTitle.trim()) {
      Alert.alert('Missing Title', 'Please enter a notification title.');
      return;
    }

    // Resolve the delay from either the clock-time field or the seconds field.
    let seconds: number;
    if (notifUseTime) {
      const computed = secondsUntilTime(notifTime);
      if (computed === null) {
        Alert.alert('Invalid Time', 'Enter the time as HH:MM:SS, e.g. 19:44:12.');
        return;
      }
      seconds = computed;
    } else {
      seconds = Number.parseInt(notifSeconds, 10);
      if (!Number.isFinite(seconds) || seconds < 1) {
        Alert.alert('Invalid Seconds', 'Please enter a number of seconds (minimum 1).');
        return;
      }
    }

    if (!Number.isFinite(count) || count < 1) {
      Alert.alert('Invalid Count', 'Please enter how many notifications you want (minimum 1).');
      return;
    }

    setNotifSending(true);
    try {
      const ids = await scheduleManualNotificationsAsync({
        title: notifTitle,
        description: notifDesc,
        secondsFromNow: seconds,
        count,
      });

      if (!ids) {
        Alert.alert('Permission Needed', 'Please allow notifications in iPhone Settings to use this feature.');
        return;
      }

      const when = notifUseTime
        ? `at ${notifTime.trim()} (in ${seconds}s)`
        : `in ${seconds} seconds`;
      Alert.alert('✅ Scheduled', `${ids.length} notification(s) will start ${when}.`);
      // Keep the fields (title/description/seconds/count) so the user doesn't
      // have to re-enter them next time.
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to schedule notification.');
    } finally {
      setNotifSending(false);
    }
  };

  if (editingIndex !== null && steps[editingIndex]) {
    return (
      <HotspotEditor 
        videoUri={steps[editingIndex]!}
        initialHotspot={hotspots[editingIndex]}
        onSave={saveHotspot}
        onCancel={() => setEditingIndex(null)}
      />
    );
  }

  const canStart = steps.every(s => s !== null) && steps.length > 0;

  return (
    <SafeAreaView
      style={styles.container}
      // When the status bar is hidden, we also drop the TOP safe-area inset
      // so the UI (and especially the video) can sit above everything.
      edges={showStatusBar ? ['top', 'left', 'right', 'bottom'] : ['left', 'right', 'bottom']}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Project Setup</Text>
        <Text style={styles.subtitle}>Create your interactive video experience.</Text>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={styles.list} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

          {/* ✅ Settings: Status Bar Switcher */}
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Status Bar</Text>
            <View style={styles.row}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.panelLabel}>Show iPhone status bar</Text>
                <Text style={styles.panelHint}>Time • Signal • Battery (toggle to hide/show)</Text>
              </View>
              <Switch
                value={showStatusBar}
                onValueChange={setShowStatusBar}
              />
            </View>
          </View>

          {/* ✅ Theme Switcher (Light / Dark) */}
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Theme</Text>
            <View style={styles.row}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.panelLabel}>Dark mode</Text>
                <Text style={styles.panelHint}>Switch between white and dark theme</Text>
              </View>
              <Switch
                value={themeMode === 'dark'}
                onValueChange={(v) => setThemeMode(v ? 'dark' : 'light')}
              />
            </View>
          </View>


          {/* ✅ Touch-to-advance behavior */}
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Touch behavior</Text>
            <View style={styles.row}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.panelLabel}>Advance on touch down</Text>
                <Text style={styles.panelHint}>
                  ON: go to next video as soon as you touch. OFF (default): go to next video when you lift your finger.
                </Text>
              </View>
              <Switch value={advanceOnTouchDown} onValueChange={setAdvanceOnTouchDown} />
            </View>
          </View>

          {/* ✅ Manual Notifications */}
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Manual Notification</Text>

            <Text style={styles.inputLabel}>Title</Text>
            <TextInput
              value={notifTitle}
              onChangeText={setNotifTitle}
              placeholder="Enter title"
              placeholderTextColor={theme.colors.textSecondary}
              style={styles.input}
              autoCapitalize="sentences"
            />

            <Text style={styles.inputLabel}>Description</Text>
            <TextInput
              value={notifDesc}
              onChangeText={setNotifDesc}
              placeholder="Enter description (optional)"
              placeholderTextColor={theme.colors.textSecondary}
              style={[styles.input, { height: 84 }]}
              multiline
              textAlignVertical="top"
            />

            <View style={[styles.row, { marginTop: 12 }]}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.panelLabel}>Send at a specific time</Text>
                <Text style={styles.panelHint}>Pick a clock time (HH:MM:SS) instead of a delay</Text>
              </View>
              <Switch value={notifUseTime} onValueChange={setNotifUseTime} />
            </View>

            {notifUseTime ? (
              <>
                <Text style={styles.inputLabel}>Time (HH:MM:SS)</Text>
                <TextInput
                  value={notifTime}
                  onChangeText={setNotifTime}
                  placeholder="19:44:12"
                  placeholderTextColor={theme.colors.textSecondary}
                  style={styles.input}
                  keyboardType="numbers-and-punctuation"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Text style={styles.panelHint}>If the time already passed today, it fires tomorrow.</Text>
              </>
            ) : (
              <>
                <Text style={styles.inputLabel}>Send after (seconds)</Text>
                <TextInput
                  value={notifSeconds}
                  onChangeText={setNotifSeconds}
                  placeholder="5"
                  placeholderTextColor={theme.colors.textSecondary}
                  style={styles.input}
                  keyboardType="number-pad"
                />
              </>
            )}

            <Text style={styles.inputLabel}>How many notifications?</Text>
            <TextInput
              value={notifCount}
              onChangeText={setNotifCount}
              placeholder="1"
              placeholderTextColor={theme.colors.textSecondary}
              style={styles.input}
              keyboardType="number-pad"
            />

            <PrimaryButton
              title={notifSending ? 'Scheduling...' : 'Schedule Notification'}
              onPress={scheduleManualNotification}
              disabled={notifSending}
              loading={notifSending}
              style={{ marginTop: theme.spacing.m }}
            />
          </View>

          {steps.map((uri, index) => {
            const isFirst = !!uri && uri === effectiveFirst;
            return (
            <View key={index} style={styles.stepCard}>
              <View style={styles.stepHeader}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <View style={styles.stepLabelRow}>
                    <Text style={styles.stepLabel}>Step {index + 1}</Text>
                    {isFirst && (
                      <Text style={styles.firstBadge}>▶ Opens first</Text>
                    )}
                  </View>
                  <Text style={[styles.status, { color: uri ? theme.colors.success : theme.colors.textSecondary }]}>
                    {uri ? "Video Ready" : "Missing Video"}
                  </Text>
                </View>
                {steps.length > 1 && (
                  <TouchableOpacity onPress={() => removeStep(index)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={{ color: theme.colors.danger, fontWeight: '600' }}>Remove</Text>
                  </TouchableOpacity>
                )}
              </View>

              <View style={styles.actionRow}>
                <PrimaryButton
                  title={uri ? "Change Video" : "Upload Video"}
                  onPress={() => pickVideo(index)}
                  variant={uri ? 'outline' : 'primary'}
                  style={{ flex: 1, height: 44, marginRight: uri ? 8 : 0 }}
                />
                {uri && (
                  <PrimaryButton
                    title="▶ Play"
                    onPress={() => setPreviewUri(uri)}
                    variant="primary"
                    style={{ flex: 1, height: 44 }}
                  />
                )}
              </View>

              {uri && (
                <>
                  <View style={[styles.actionRow, { marginTop: 8 }]}>
                    <PrimaryButton
                      title={hotspots[index] ? "Edit Click Area" : "Set Click Area"}
                      onPress={() => setEditingIndex(index)}
                      variant={hotspots[index] ? 'outline' : 'secondary'}
                      style={{ flex: 1, height: 44 }}
                    />
                  </View>

                  {/* Opens-first switch: turn on to make this clip launch first,
                      turn off to revert to the natural first clip. */}
                  <View style={styles.firstRow}>
                    <View style={{ flex: 1, paddingRight: 12 }}>
                      <Text style={styles.panelLabel}>Opens first</Text>
                      <Text style={styles.panelHint}>Play this clip first when the app opens</Text>
                    </View>
                    <Switch
                      value={isFirst}
                      onValueChange={(v) => setOpensFirst(uri, v)}
                    />
                  </View>
                </>
              )}
            </View>
            );
          })}

          <PrimaryButton 
            title="+ Add New Step" 
            onPress={addStep} 
            variant="secondary" 
            style={styles.addBtn}
          />
        </ScrollView>

        <View style={styles.footer}>
          <PrimaryButton
            title="Launch Experience"
            onPress={() => onStart(steps.filter((s): s is string => s !== null), hotspots, effectiveFirst)}
            disabled={!canStart}
          />
        </View>
      </KeyboardAvoidingView>

      {/* Full-screen preview player: play any uploaded video from the list. */}
      <Modal
        visible={!!previewUri}
        animationType="slide"
        onRequestClose={() => setPreviewUri(null)}
        supportedOrientations={['portrait', 'landscape']}
      >
        <View style={styles.previewContainer}>
          {previewUri && (
            <Video
              source={{ uri: previewUri }}
              style={styles.previewVideo}
              resizeMode={ResizeMode.CONTAIN}
              useNativeControls
              shouldPlay
              isLooping
            />
          )}
          <SafeAreaView style={styles.previewCloseWrap} edges={['top', 'right']}>
            <TouchableOpacity
              style={styles.previewCloseBtn}
              onPress={() => setPreviewUri(null)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.previewCloseText}>✕ Close</Text>
            </TouchableOpacity>
          </SafeAreaView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const createStyles = (theme: any) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background, paddingHorizontal: theme.spacing.m },
  header: { marginTop: theme.spacing.l, marginBottom: theme.spacing.xl },
  title: theme.text.title,
  subtitle: { ...theme.text.caption, marginTop: 4 },
  list: { flex: 1 },

  panel: {
    marginBottom: theme.spacing.m,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.m,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  panelTitle: { color: theme.colors.text, fontWeight: '800', fontSize: 18, marginBottom: 10 },
  panelLabel: { color: theme.colors.text, fontWeight: '700', fontSize: 15 },
  panelHint: { ...theme.text.caption, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  inputLabel: { color: theme.colors.textSecondary, fontSize: 12, fontWeight: '700', marginTop: 10, marginBottom: 6 },
  input: {
    backgroundColor: theme.colors.surfaceLight,
    color: theme.colors.text,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },

  stepCard: { 
    marginBottom: theme.spacing.m, 
    backgroundColor: theme.colors.surface, 
    padding: theme.spacing.m, 
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.colors.border
  },
  stepHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: theme.spacing.m },
  stepLabelRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  stepLabel: { color: theme.colors.text, fontWeight: '800', fontSize: 18 },
  firstBadge: {
    color: theme.colors.success,
    backgroundColor: theme.colors.surfaceLight,
    fontSize: 12,
    fontWeight: '800',
    marginLeft: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    overflow: 'hidden',
  },
  status: { fontSize: 13, fontWeight: '600', marginTop: 2 },
  actionRow: { flexDirection: 'row' },
  firstRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },

  previewContainer: { flex: 1, backgroundColor: '#000', justifyContent: 'center' },
  previewVideo: { width: '100%', height: '100%' },
  previewCloseWrap: { position: 'absolute', top: 0, right: 0, padding: 12 },
  previewCloseBtn: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  previewCloseText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  addBtn: { marginTop: theme.spacing.s, marginBottom: theme.spacing.xl, borderStyle: 'dashed', borderWidth: 1, borderColor: theme.colors.textSecondary, backgroundColor: 'transparent' },
  footer: { paddingVertical: theme.spacing.m, borderTopWidth: 1, borderTopColor: theme.colors.border }
});
