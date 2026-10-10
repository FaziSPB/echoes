import { distanceM } from '@echoes/shared';
import Slider from '@react-native-community/slider';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import * as Speech from 'expo-speech';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GlEchoRenderer } from '@/components/ar/gl-echo-renderer';
import type { Alignment, EchoMode } from '@/components/ar/types';
import { Segmented } from '@/components/segmented';
import { Palette, Radius, Spacing } from '@/constants/theme';
import { useDevicePose } from '@/hooks/use-device-pose';
import { useUserLocation } from '@/hooks/use-user-location';
import { api } from '@/lib/api';
import { ADMIN_TOKEN, ON_SITE_RADIUS_M, resolveMediaUrl } from '@/lib/config';

const STEP_LABELS: Record<string, string> = {
  queued: 'w kolejce',
  prepare: 'przygotowanie kadru',
  outpaint: 'AI rozszerza kadr do 360°',
  seam: 'domykanie panoramy',
  compose: 'wklejanie oryginału archiwalnego',
  narration: 'pisanie narracji',
  upload: 'zapisywanie',
};

export default function EchoScreen() {
  const { photoId } = useLocalSearchParams<{ photoId: string }>();
  const queryClient = useQueryClient();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const pose = useDevicePose();
  const { location } = useUserLocation();

  const [mode, setMode] = useState<EchoMode>('overlay');
  const [opacity, setOpacity] = useState(0.75);
  const [highlightAi, setHighlightAi] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [manualYawDeg, setManualYawDeg] = useState(0);
  const [anchorToken, setAnchorToken] = useState(1);
  const [relativeYaw, setRelativeYaw] = useState<number | null>(null);
  const [speaking, setSpeaking] = useState(false);

  const photoQuery = useQuery({ queryKey: ['photo', photoId], queryFn: () => api.photo(photoId) });
  const photo = photoQuery.data;

  // Echo lifecycle: request once if missing, then poll while the worker runs.
  const requestEcho = useMutation({
    mutationFn: () => api.requestEcho(photoId),
    onSuccess: (echo) => queryClient.setQueryData(['echo', echo.id], echo),
  });
  const echoId = requestEcho.data?.id ?? photo?.echo?.id;
  useEffect(() => {
    if (photo && !photo.echo && !requestEcho.isPending && !requestEcho.data) requestEcho.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo?.id]);
  const echoQuery = useQuery({
    queryKey: ['echo', echoId],
    enabled: !!echoId,
    queryFn: () => api.echo(echoId!),
    initialData: photo?.echo ?? undefined,
    refetchInterval: (q) => (q.state.data && ['queued', 'running'].includes(q.state.data.status) ? 2000 : false),
  });
  const echo = echoQuery.data;
  const echoReady = echo?.status === 'done' && !!echo.panoUrl && !!echo.photoRect;

  // Switch to the 360° view the moment it becomes available.
  const announced = useRef(false);
  useEffect(() => {
    if (echoReady && !announced.current) {
      announced.current = true;
      setMode('echo');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
  }, [echoReady]);

  const distance = photo && location ? distanceM(location.lat, location.lon, photo.lat, photo.lon) : null;
  const onSite = distance !== null && distance <= ON_SITE_RADIUS_M;
  const alignment: Alignment = useMemo(() => (onSite ? { kind: 'compass' } : { kind: 'remote', anchorToken }), [onSite, anchorToken]);

  // Horizontal drag rotates the past to line it up with the present (calibration).
  const dragStart = useRef(0);
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => calibrating && Math.abs(g.dx) > 6,
        onPanResponderGrant: () => {
          dragStart.current = manualYawDeg;
        },
        onPanResponderMove: (_, g) => setManualYawDeg(dragStart.current - g.dx * 0.12),
      }),
    [calibrating, manualYawDeg],
  );

  const saveHeading = useMutation({
    mutationFn: () => api.patchPhoto(photoId, { headingDeg: (((photo!.headingDeg ?? 0) - manualYawDeg) % 360 + 360) % 360 }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['photo', photoId], updated);
      setManualYawDeg(0);
      setCalibrating(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    },
  });

  useEffect(() => () => void Speech.stop(), []);
  const narrate = () => {
    if (speaking) {
      Speech.stop();
      setSpeaking(false);
      return;
    }
    const text = echo?.narration ?? (photo ? `${photo.title}. ${photo.yearLabel ?? ''}. ${photo.description ?? ''}` : '');
    setSpeaking(true);
    Speech.speak(text, { language: 'pl-PL', rate: 0.95, onDone: () => setSpeaking(false), onStopped: () => setSpeaking(false) });
  };

  if (photoQuery.isLoading || !photo) {
    return (
      <View style={[styles.fill, styles.center]}>
        {photoQuery.error ? <Text style={styles.text}>Nie udało się wczytać zdjęcia.</Text> : <ActivityIndicator color={Palette.paper} />}
      </View>
    );
  }

  const showCamera = mode !== 'immersive' && cameraPermission?.granted;
  const turnHint = relativeYaw !== null && Math.abs(relativeYaw) > 25 && mode !== 'immersive' ? (relativeYaw > 0 ? 'obróć się w prawo →' : '← obróć się w lewo') : null;

  return (
    <View style={styles.fill} {...pan.panHandlers}>
      {showCamera ? <CameraView style={StyleSheet.absoluteFill} facing="back" /> : <View style={[StyleSheet.absoluteFill, { backgroundColor: '#14100c' }]} />}

      {photo.imageUrl && photo.width && photo.height ? (
        <GlEchoRenderer
          mode={echoReady ? mode : 'overlay'}
          pose={pose}
          alignment={alignment}
          manualYawDeg={manualYawDeg}
          opacity={opacity}
          highlightAi={highlightAi}
          photo={{ url: resolveMediaUrl(photo.imageUrl)!, width: photo.width, height: photo.height, hfovDeg: photo.hfovDeg, pitchDeg: photo.pitchDeg, headingDeg: photo.headingDeg ?? 0 }}
          echo={
            echoReady
              ? { panoUrl: resolveMediaUrl(echo.panoUrl)!, panoWidth: echo.panoWidth ?? 4096, panoHeight: echo.panoHeight ?? 1024, photoRect: echo.photoRect!, skyColor: echo.skyColor, groundColor: echo.groundColor }
              : null
          }
          onRelativeYaw={setRelativeYaw}
        />
      ) : null}

      <SafeAreaView edges={['top']} style={styles.top} pointerEvents="box-none">
        <View style={styles.topRow}>
          <Pressable style={styles.iconButton} onPress={() => router.back()}>
            <Text style={styles.iconText}>✕</Text>
          </Pressable>
          <View style={styles.titleBox}>
            <Text style={styles.year}>{photo.yearLabel}</Text>
            <Text style={styles.title} numberOfLines={2}>
              {photo.title}
            </Text>
          </View>
        </View>
        <View style={styles.chips}>
          <Text style={[styles.chip, onSite ? styles.chipOk : null]}>
            {onSite ? `Na miejscu · ${Math.round(distance!)} m` : distance !== null ? `Tryb zdalny · ${(distance / 1000).toFixed(1)} km` : 'Tryb zdalny'}
          </Text>
          <EchoStatusChip status={echo?.status} step={echo?.step} error={echo?.error ?? requestEcho.error?.message} onRetry={() => requestEcho.mutate()} />
        </View>
        {!cameraPermission?.granted && mode !== 'immersive' ? (
          <Pressable style={styles.permission} onPress={requestCameraPermission}>
            <Text style={styles.permissionText}>Zezwól na kamerę, aby nałożyć przeszłość na teraźniejszość</Text>
          </Pressable>
        ) : null}
        {turnHint ? <Text style={styles.hint}>{turnHint}</Text> : null}
      </SafeAreaView>

      <SafeAreaView edges={['bottom']} style={styles.bottom}>
        <View style={styles.panel}>
          <Segmented<EchoMode>
            value={echoReady ? mode : 'overlay'}
            onChange={setMode}
            options={[
              { value: 'overlay', label: 'Nakładka' },
              { value: 'echo', label: 'Echo 360°', disabled: !echoReady },
              { value: 'immersive', label: 'Immersja', disabled: !echoReady },
            ]}
          />
          {mode !== 'immersive' ? (
            <View style={styles.sliderRow}>
              <Text style={styles.sliderLabel}>Dziś</Text>
              <Slider style={{ flex: 1 }} minimumValue={0} maximumValue={1} value={opacity} onValueChange={setOpacity} minimumTrackTintColor={Palette.sepiaLight} maximumTrackTintColor="rgba(255,255,255,0.3)" thumbTintColor={Palette.paper} />
              <Text style={styles.sliderLabel}>{photo.yearFrom ?? 'Wtedy'}</Text>
            </View>
          ) : null}
          <View style={styles.actions}>
            <Toggle label="AI" active={highlightAi} disabled={!echoReady || mode === 'overlay'} onPress={() => setHighlightAi((v) => !v)} />
            <Toggle label={speaking ? 'Stop' : 'Opowiedz'} active={speaking} onPress={narrate} />
            <Toggle label="Na wprost" onPress={() => { setManualYawDeg(0); setAnchorToken((t) => t + 1); }} />
            <Toggle label="Kalibruj" active={calibrating} onPress={() => setCalibrating((v) => !v)} />
          </View>
          {calibrating ? (
            <View style={styles.calibration}>
              <Text style={styles.calibrationText}>Przeciągnij palcem w poziomie, aż archiwalne zdjęcie pokryje się z rzeczywistością ({manualYawDeg.toFixed(1)}°).</Text>
              {ADMIN_TOKEN && onSite ? (
                <Pressable style={styles.save} onPress={() => saveHeading.mutate()} disabled={saveHeading.isPending}>
                  <Text style={styles.saveText}>{saveHeading.isPending ? 'Zapisuję…' : 'Zapisz kierunek'}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          <Text style={styles.attribution} numberOfLines={2}>
            {photo.attribution}
            {photo.monument ? ` · Zabytek: ${photo.monument.name}` : ''}
          </Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

function EchoStatusChip({ status, step, error, onRetry }: { status?: string; step?: string | null; error?: string | null; onRetry: () => void }) {
  if (status === 'done') return <Text style={[styles.chip, styles.chipAi]}>Echo 360° gotowe</Text>;
  if (status === 'failed' || (!status && error))
    return (
      <Pressable onPress={onRetry}>
        <Text style={[styles.chip, styles.chipWarn]}>Echo 360° niedostępne · ponów</Text>
      </Pressable>
    );
  if (status === 'queued' || status === 'running')
    return <Text style={styles.chip}>⏳ {STEP_LABELS[step ?? 'queued'] ?? step}</Text>;
  return null;
}

function Toggle({ label, active, disabled, onPress }: { label: string; active?: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={[styles.toggle, active && styles.toggleActive, disabled && { opacity: 0.35 }]}>
      <Text style={[styles.toggleText, active && { color: Palette.ink }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center' },
  text: { color: Palette.paper },
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: Spacing.lg, gap: Spacing.sm },
  topRow: { flexDirection: 'row', gap: Spacing.md, alignItems: 'center', marginTop: Spacing.sm },
  iconButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: Palette.overlay, alignItems: 'center', justifyContent: 'center' },
  iconText: { color: Palette.paper, fontSize: 18 },
  titleBox: { flex: 1, backgroundColor: Palette.overlay, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  year: { color: Palette.sepiaLight, fontFamily: 'serif', fontWeight: '700', letterSpacing: 1 },
  title: { color: Palette.paper, fontFamily: 'serif', fontSize: 15 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  chip: { color: Palette.paper, backgroundColor: Palette.overlay, fontSize: 12, paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.pill, overflow: 'hidden' },
  chipOk: { backgroundColor: 'rgba(60,120,70,0.85)' },
  chipAi: { backgroundColor: 'rgba(59,143,224,0.9)' },
  chipWarn: { backgroundColor: 'rgba(179,65,46,0.85)' },
  hint: { alignSelf: 'center', marginTop: Spacing.xl, color: Palette.white, backgroundColor: Palette.overlayLight, fontSize: 18, fontWeight: '700', paddingHorizontal: 16, paddingVertical: 8, borderRadius: Radius.pill, overflow: 'hidden' },
  permission: { backgroundColor: Palette.paper, borderRadius: Radius.md, padding: Spacing.md },
  permissionText: { color: Palette.ink, fontWeight: '600' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  panel: { margin: Spacing.md, padding: Spacing.md, gap: Spacing.md, backgroundColor: Palette.overlay, borderRadius: Radius.lg },
  sliderRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  sliderLabel: { color: Palette.paper, fontFamily: 'serif', fontSize: 13, minWidth: 38, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: Spacing.sm, justifyContent: 'space-between' },
  toggle: { flex: 1, paddingVertical: 8, borderRadius: Radius.pill, borderWidth: 1, borderColor: 'rgba(243,234,219,0.4)', alignItems: 'center' },
  toggleActive: { backgroundColor: Palette.paper, borderColor: Palette.paper },
  toggleText: { color: Palette.paper, fontSize: 12, fontWeight: '600' },
  calibration: { gap: Spacing.sm },
  calibrationText: { color: Palette.paper, fontSize: 12 },
  save: { backgroundColor: Palette.sepia, borderRadius: Radius.pill, paddingVertical: 10, alignItems: 'center' },
  saveText: { color: Palette.white, fontWeight: '700' },
  attribution: { color: 'rgba(243,234,219,0.7)', fontSize: 10, fontStyle: 'italic' },
});
