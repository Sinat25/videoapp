import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, TouchableOpacity, Switch, TextInput, KeyboardAvoidingView, Platform, Modal, Image } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Video, ResizeMode } from 'expo-av';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getTheme } from '../theme';
import PrimaryButton from '../ui/PrimaryButton';
import { VideoStorage, Hotspot } from '../storage/videoStorage';
import HotspotEditor from './HotspotEditor';
import { useAppSettings } from '../settings/AppSettingsContext';
import { scheduleManualNotificationsAsync, ensureNotificationPermissionsAsync } from '../notifications/notificationService';

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
  onStart: (
    paths: string[],
    hotspots: (Hotspot | null)[],
    advanceFlags: (boolean | null)[],
    startVideo: string | null
  ) => void;
  existingVideos: string[];
  existingHotspots: (Hotspot | null)[];
}

export default function UploadScreen({ onStart, existingVideos, existingHotspots }: Props) {
  const [steps, setSteps] = useState<(string | null)[]>([null, null, null]);
  const [hotspots, setHotspots] = useState<(Hotspot | null)[]>([null, null, null]);
  // Per-video "advance on touch down" overrides, parallel to steps.
  // null = inherit the global default; true/false = explicit per-video choice.
  const [advanceFlags, setAdvanceFlags] = useState<(boolean | null)[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  // Video currently being previewed in the full-screen player modal.
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  // Path of the clip chosen to open first (null = natural first in the list).
  const [startVideo, setStartVideo] = useState<string | null>(null);

  // ✅ Status bar switcher (Show/Hide iPhone status bar)
  const {
    showStatusBar, setShowStatusBar,
    themeMode, setThemeMode,
    advanceOnTouchDown, setAdvanceOnTouchDown,
    lastVideoNotifEnabled, setLastVideoNotifEnabled,
    notifImages, addNotifImage, removeNotifImage,
    notifItems, addNotifItem, updateNotifItem, removeNotifItem,
  } = useAppSettings();
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

  // Load the saved per-video "advance on touch down" overrides.
  useEffect(() => {
    let mounted = true;
    VideoStorage.getAdvanceFlags()
      .then((f) => { if (mounted) setAdvanceFlags(f); })
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

  // Ask where to get the video from, then hand off to the right picker.
  const pickVideo = (index: number) => {
    Alert.alert(
      'Add Video',
      'Choose where to pick the video from.',
      [
        { text: 'Photo Library', onPress: () => pickFromLibrary(index) },
        { text: 'Files', onPress: () => pickFromFiles(index) },
        { text: 'Cancel', style: 'cancel' },
      ],
      { cancelable: true }
    );
  };

  const pickFromLibrary = async (index: number) => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      allowsEditing: true,
      quality: 1,
    });
    if (!result.canceled && result.assets[0]) {
      await savePickedVideo(index, result.assets[0].uri);
    }
  };

  const pickFromFiles = async (index: number) => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'video/*',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (!result.canceled && result.assets && result.assets[0]) {
        await savePickedVideo(index, result.assets[0].uri);
      }
    } catch (e) {
      Alert.alert('Error', 'Could not open Files. Please try again.');
    }
  };

  // Copy the chosen video into app storage and update the step + saved order.
  const savePickedVideo = async (index: number, uri: string) => {
    const newSteps = [...steps];
    try {
      const previousPath = steps[index];
      const savedPath = await VideoStorage.saveVideoFile(uri, index);
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
      Alert.alert('Error', 'Failed to save video.');
    }
  };

  // Keep the flags array aligned to the current number of steps (pad with null).
  const paddedFlags = (): (boolean | null)[] => {
    const af = [...advanceFlags];
    while (af.length < steps.length) af.push(null);
    return af;
  };

  const setVideoAdvance = (index: number, value: boolean) => {
    const next = paddedFlags();
    next[index] = value;
    setAdvanceFlags(next);
    VideoStorage.saveAdvanceFlags(next).catch(() => {});
  };

  const addStep = () => {
    setSteps([...steps, null]);
    setHotspots([...hotspots, null]);
    setAdvanceFlags([...paddedFlags(), null]);
  };

  const removeStep = (index: number) => {
    const removedUri = steps[index];
    const newSteps = steps.filter((_, i) => i !== index);
    const newHotspots = hotspots.filter((_, i) => i !== index);
    const newFlags = paddedFlags().filter((_, i) => i !== index);
    setSteps(newSteps);
    setHotspots(newHotspots);
    setAdvanceFlags(newFlags);
    VideoStorage.saveVideos(newSteps.filter((s): s is string => s !== null));
    VideoStorage.saveHotspots(newHotspots);
    VideoStorage.saveAdvanceFlags(newFlags).catch(() => {});
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

  // ---- Last-video notifications ----

  // Turning the feature on: seed one item if empty and ask for permission early
  // so the notifications aren't silently dropped when the last video is reached.
  const onToggleLastNotif = (v: boolean) => {
    setLastVideoNotifEnabled(v);
    if (v) {
      if (notifItems.length === 0) addNotifItem();
      ensureNotificationPermissionsAsync().catch(() => {});
    }
  };

  // Pick an image from the library and add it to the shared gallery.
  const pickNotifImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 1,
      });
      if (!result.canceled && result.assets[0]) {
        await addNotifImage(result.assets[0].uri);
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to add image.');
    }
  };

  const confirmRemoveNotifImage = (path: string) => {
    Alert.alert('Remove Image', 'Remove this image from the gallery?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => { removeNotifImage(path).catch(() => {}); } },
    ]);
  };

  // Seconds field: keep it a clean integer, allow clearing while typing.
  const onChangeItemSeconds = (id: string, text: string) => {
    const digits = text.replace(/[^0-9]/g, '');
    updateNotifItem(id, { seconds: digits ? Number.parseInt(digits, 10) : 0 });
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


          {/* ✅ Touch-to-advance behavior (default; overridable per video below) */}
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Touch behavior (default)</Text>
            <View style={styles.row}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.panelLabel}>Advance on touch down</Text>
                <Text style={styles.panelHint}>
                  ON: go to next video as soon as you touch. OFF: go to next video when you lift your finger.
                  This is the default — each video below can override it.
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

          {/* ✅ Last-video Notifications: fire a list of notifications after the
              user scrolls to the LAST video, each with its own delay + image. */}
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Last-video Notifications</Text>
            <View style={styles.row}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.panelLabel}>Notify after the last video</Text>
                <Text style={styles.panelHint}>
                  When you scroll to the last video, each notification below fires after its own delay.
                </Text>
              </View>
              <Switch value={lastVideoNotifEnabled} onValueChange={onToggleLastNotif} />
            </View>

            {/* Shared image gallery */}
            <Text style={[styles.inputLabel, { marginTop: 14 }]}>Images</Text>
            <Text style={styles.panelHint}>
              Upload images, then pick one per notification below. The image shows inside the
              notification when expanded. (iOS can't replace the small app icon itself.)
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }}>
              {notifImages.map((img) => (
                <TouchableOpacity
                  key={img}
                  onLongPress={() => confirmRemoveNotifImage(img)}
                  delayLongPress={300}
                  activeOpacity={0.8}
                  style={styles.galleryItem}
                >
                  <Image source={{ uri: img }} style={styles.galleryImage} />
                  <TouchableOpacity
                    style={styles.galleryDelete}
                    onPress={() => confirmRemoveNotifImage(img)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={styles.galleryDeleteText}>✕</Text>
                  </TouchableOpacity>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={styles.galleryAdd} onPress={pickNotifImage} activeOpacity={0.8}>
                <Text style={styles.galleryAddText}>＋</Text>
                <Text style={styles.galleryAddLabel}>Add</Text>
              </TouchableOpacity>
            </ScrollView>

            {/* Notification items */}
            {notifItems.map((item, idx) => (
              <View key={item.id} style={styles.notifItem}>
                <View style={styles.stepHeader}>
                  <Text style={styles.stepLabel}>Notification {idx + 1}</Text>
                  <TouchableOpacity
                    onPress={() => removeNotifItem(item.id)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={{ color: theme.colors.danger, fontWeight: '600' }}>Remove</Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.inputLabel}>Delay after last video (seconds)</Text>
                <TextInput
                  value={item.seconds > 0 ? String(item.seconds) : ''}
                  onChangeText={(t) => onChangeItemSeconds(item.id, t)}
                  placeholder="e.g. 2"
                  placeholderTextColor={theme.colors.textSecondary}
                  style={styles.input}
                  keyboardType="number-pad"
                />

                <Text style={styles.inputLabel}>Title</Text>
                <TextInput
                  value={item.title}
                  onChangeText={(t) => updateNotifItem(item.id, { title: t })}
                  placeholder="Enter title"
                  placeholderTextColor={theme.colors.textSecondary}
                  style={styles.input}
                  autoCapitalize="sentences"
                />

                <Text style={styles.inputLabel}>Description</Text>
                <TextInput
                  value={item.body}
                  onChangeText={(t) => updateNotifItem(item.id, { body: t })}
                  placeholder="Enter description (optional)"
                  placeholderTextColor={theme.colors.textSecondary}
                  style={[styles.input, { height: 72 }]}
                  multiline
                  textAlignVertical="top"
                />

                <Text style={styles.inputLabel}>Image</Text>
                {notifImages.length === 0 ? (
                  <Text style={styles.panelHint}>Add an image above to attach it here.</Text>
                ) : (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 4 }}>
                    <TouchableOpacity
                      onPress={() => updateNotifItem(item.id, { imageUri: null })}
                      style={[styles.pickChip, item.imageUri === null && styles.pickChipActive]}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.pickChipText, item.imageUri === null && styles.pickChipTextActive]}>None</Text>
                    </TouchableOpacity>
                    {notifImages.map((img) => {
                      const selected = item.imageUri === img;
                      return (
                        <TouchableOpacity
                          key={img}
                          onPress={() => updateNotifItem(item.id, { imageUri: img })}
                          style={[styles.pickThumbWrap, selected && styles.pickThumbWrapActive]}
                          activeOpacity={0.8}
                        >
                          <Image source={{ uri: img }} style={styles.pickThumb} />
                          {selected && (
                            <View style={styles.pickThumbCheck}>
                              <Text style={styles.pickThumbCheckText}>✓</Text>
                            </View>
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                )}
              </View>
            ))}

            <PrimaryButton
              title="+ Add Notification"
              onPress={addNotifItem}
              variant="secondary"
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

                  {/* Per-video advance-on-touch-down override. Defaults to the
                      global "Touch behavior" setting until changed here. */}
                  <View style={styles.firstRow}>
                    <View style={{ flex: 1, paddingRight: 12 }}>
                      <Text style={styles.panelLabel}>Advance on touch down</Text>
                      <Text style={styles.panelHint}>
                        For this video: ON = next on touch, OFF = next on lift.
                      </Text>
                    </View>
                    <Switch
                      value={advanceFlags[index] ?? advanceOnTouchDown}
                      onValueChange={(v) => setVideoAdvance(index, v)}
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
            onPress={() => onStart(steps.filter((s): s is string => s !== null), hotspots, paddedFlags(), effectiveFirst)}
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

  // Last-video notifications
  galleryItem: {
    width: 72,
    height: 72,
    borderRadius: 12,
    marginRight: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceLight,
  },
  galleryImage: { width: '100%', height: '100%' },
  galleryDelete: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  galleryDeleteText: { color: '#fff', fontSize: 12, fontWeight: '700', lineHeight: 14 },
  galleryAdd: {
    width: 72,
    height: 72,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.colors.textSecondary,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  galleryAddText: { color: theme.colors.textSecondary, fontSize: 24, fontWeight: '400', lineHeight: 26 },
  galleryAddLabel: { color: theme.colors.textSecondary, fontSize: 11, fontWeight: '700' },

  notifItem: {
    marginTop: theme.spacing.m,
    paddingTop: theme.spacing.m,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },

  pickChip: {
    height: 44,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginRight: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceLight,
  },
  pickChipActive: { borderColor: theme.colors.primary, backgroundColor: theme.colors.primary },
  pickChipText: { color: theme.colors.text, fontWeight: '700', fontSize: 13 },
  pickChipTextActive: { color: '#fff' },

  pickThumbWrap: {
    width: 56,
    height: 56,
    borderRadius: 12,
    marginRight: 10,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  pickThumbWrapActive: { borderColor: theme.colors.primary },
  pickThumb: { width: '100%', height: '100%' },
  pickThumbCheck: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickThumbCheckText: { color: '#fff', fontSize: 12, fontWeight: '800', lineHeight: 14 },

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
