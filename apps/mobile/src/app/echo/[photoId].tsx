import { distanceM, walkBlend } from '@echoes/shared';
import Slider from '@react-native-community/slider';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import * as Speech from 'expo-speech';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, PanResponder, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GlEchoRenderer } from '@/components/ar/gl-echo-renderer';
import type { Alignment } from '@/components/ar/types';
import { Palette, Radius, Spacing } from '@/constants/theme';
import { useDevicePose } from '@/hooks/use-device-pose';
import { useUserLocation } from '@/hooks/use-user-location';
import { useWalkProgress } from '@/hooks/use-walk-progress';
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

  const [walking, setWalking] = useState(false);
  const [opacity, setOpacity] = useState(0.75);
  const [highlightAi, setHighlightAi] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [manualYawDeg, setManualYawDeg] = useState(0);
  const [anchorToken, setAnchorToken] = useState(1);
  const [relativeYaw, setRelativeYaw] = useState<number | null>(null);
  const [speaking, setSpeaking] = useState(false);

  const photoQuery = useQuery({ queryKey: ['photo', photoId], queryFn: () => api.photo(photoId) });
  const photo = photoQuery.data;

  // Echo lifecycle: generation is paid, so it only starts on an explicit tap; then we poll while the worker runs.
  const requestEcho = useMutation({
    mutationFn: () => api.requestEcho(photoId),
    onSuccess: (echo) => queryClient.setQueryData(['echo', echo.id], echo),
  });
  const echoId = requestEcho.data?.id ?? photo?.echo?.id;
  const echoQuery = useQuery({
    queryKey: ['echo', echoId],
    enabled: !!echoId,
    queryFn: () => api.echo(echoId!),
    initialData: photo?.echo ?? undefined,
    refetchInterval: (q) => (q.state.data && ['queued', 'running'].includes(q.state.data.status) ? 2000 : false),
  });
  const echo = echoQuery.data;
  const echoReady = echo?.status === 'done' && !!echo.panoUrl && !!echo.photoRect;
  const echoBusy = requestEcho.isPending || echo?.status === 'queued' || echo?.status === 'running';
  const canGenerate = !echoReady && !echoBusy;

  // Walk in time: only photos with a pre-generated walk (CLI) offer it.
  const walk = photo?.walk && photo.walk.frames.length >= 2 ? photo.walk : null;
  const isWalking = walking && !!walk;
  const walkProgress = useWalkProgress(pose, isWalking, walk?.lengthM ?? 10);
  const walkFrameShown = useMemo(() => {
    if (!walk) return null;
    const b = walkBlend(walk.frames.map((f) => f.distanceM), walkProgress.distanceM, walk.subjectDistanceM);
    return walk.frames[b.t < 0.5 ? b.a : b.b]!;
  }, [walk, walkProgress.distanceM]);
  const toggleWalking = (on: boolean) => {
    if (on) {
      // Start the walk from here: the archival view is placed straight ahead and the distance resets.
      walkProgress.reset();
      setManualYawDeg(0);
      setAnchorToken((t) => t + 1);
    }
    setWalking(on);
  };
  // Is anything AI-generated on screen right now? (panorama outside the archival frame, or an AI walk frame)
  const aiVisible = echoReady || (isWalking && !!walkFrameShown?.generated);

  // Buzz once when a freshly requested panorama becomes available.
  const announced = useRef(false);
  useEffect(() => {
    if (echoReady && requestEcho.data && !announced.current) {
      announced.current = true;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
  }, [echoReady, requestEcho.data]);

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

  const turnHint = relativeYaw !== null && Math.abs(relativeYaw) > 25 ? (relativeYaw > 0 ? 'obróć się w prawo →' : '← obróć się w lewo') : null;

  return (
    <View style={styles.fill} {...pan.panHandlers}>
      {cameraPermission?.granted ? <CameraView style={StyleSheet.absoluteFill} facing="back" /> : <View style={[StyleSheet.absoluteFill, { backgroundColor: '#14100c' }]} />}

      {photo.imageUrl && photo.width && photo.height ? (
        <GlEchoRenderer
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
          walk={
            walk
              ? {
                  frames: walk.frames.map((f) => ({ url: resolveMediaUrl(f.imageUrl)!, distanceM: f.distanceM, generated: f.generated })),
                  subjectDistanceM: walk.subjectDistanceM,
                  distanceM: walkProgress.distanceM,
                  active: isWalking,
                }
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
          <EchoStatusChip status={echo?.status} step={echo?.step} error={echo?.error ?? requestEcho.error?.message} />
          {isWalking && walkFrameShown ? (
            <Text style={[styles.chip, walkFrameShown.generated ? styles.chipAi : styles.chipOk]}>
              {walkFrameShown.generated ? `Rekonstrukcja AI · ${walkFrameShown.distanceM.toFixed(1)} m` : `Oryginał · ${photo.yearLabel ?? ''}`}
            </Text>
          ) : null}
          {highlightAi && aiVisible ? <Text style={[styles.chip, styles.chipLegend]}>▨ niebieskie = wygenerowane przez AI · reszta to archiwum</Text> : null}
        </View>
        {!cameraPermission?.granted ? (
          <Pressable style={styles.permission} onPress={requestCameraPermission}>
            <Text style={styles.permissionText}>Zezwól na kamerę, aby nałożyć przeszłość na teraźniejszość</Text>
          </Pressable>
        ) : null}
        {turnHint ? <Text style={styles.hint}>{turnHint}</Text> : null}
      </SafeAreaView>

      <SafeAreaView edges={['bottom']} style={styles.bottom}>
        <View style={styles.panel}>
          {canGenerate ? (
            <Pressable style={styles.generate} onPress={() => requestEcho.mutate()}>
              <Text style={styles.generateText}>Wygeneruj Echo 360°</Text>
              <Text style={styles.generateHint}>AI rozszerzy kadr do panoramy · płatne API, ok. 3 min</Text>
            </Pressable>
          ) : null}
          {walk ? (
            <View style={styles.walk}>
              <View style={styles.walkRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.walkTitle}>Spacer w czasie</Text>
                  <Text style={styles.walkText}>
                    {isWalking ? `Idź przed siebie · ${walkProgress.distanceM.toFixed(1)} / ${walk.lengthM} m · kroki: ${walkProgress.steps}` : `Przejdź ${walk.lengthM} m, a przeszłość pójdzie z Tobą`}
                  </Text>
                </View>
                <Switch value={isWalking} onValueChange={toggleWalking} trackColor={{ false: 'rgba(255,255,255,0.25)', true: Palette.ai }} thumbColor={Palette.paper} />
              </View>
              {isWalking ? (
                <View style={styles.sliderRow}>
                  <Text style={styles.sliderLabel}>0 m</Text>
                  {/* Doubles as the progress bar and the manual fallback when there is no room to walk. */}
                  <Slider style={{ flex: 1 }} minimumValue={0} maximumValue={walk.lengthM} value={walkProgress.distanceM} onValueChange={walkProgress.setDistanceM} minimumTrackTintColor={Palette.ai} maximumTrackTintColor="rgba(255,255,255,0.3)" thumbTintColor={Palette.paper} />
                  <Text style={styles.sliderLabel}>{walk.lengthM} m</Text>
                </View>
              ) : null}
            </View>
          ) : null}
          <View style={styles.sliderRow}>
            <Text style={styles.sliderLabel}>Dziś</Text>
            <Slider style={{ flex: 1 }} minimumValue={0} maximumValue={1} value={opacity} onValueChange={setOpacity} minimumTrackTintColor={Palette.sepiaLight} maximumTrackTintColor="rgba(255,255,255,0.3)" thumbTintColor={Palette.paper} />
            <Text style={styles.sliderLabel}>{photo.yearFrom ?? 'Wtedy'}</Text>
          </View>
          <View style={styles.actions}>
            <Toggle label="Pokaż AI" active={highlightAi} disabled={!echoReady && !walk} onPress={() => setHighlightAi((v) => !v)} />
            <Toggle label={speaking ? 'Stop' : 'Opowiedz'} active={speaking} onPress={narrate} />
            <Toggle
              label={isWalking ? 'Od nowa' : 'Na wprost'}
              onPress={() => {
                if (isWalking) walkProgress.reset();
                setManualYawDeg(0);
                setAnchorToken((t) => t + 1);
              }}
            />
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

function EchoStatusChip({ status, step, error }: { status?: string; step?: string | null; error?: string | null }) {
  if (status === 'done') return <Text style={[styles.chip, styles.chipAi]}>Echo 360° gotowe</Text>;
  if (status === 'failed' || (!status && error)) {
    const reason = error?.includes('limit')
      ? 'dzienny limit generacji wyczerpany'
      : error && /\b402\b|billing|payment required/i.test(error)
        ? 'brak płatności w Gemini (402), sprawdź Billing w Google AI Studio'
        : 'generowanie nie powiodło się';
    return <Text style={[styles.chip, styles.chipWarn]}>Echo 360°: {reason}</Text>;
  }
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
  walk: { gap: Spacing.xs, paddingBottom: Spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(243,234,219,0.25)' },
  walkRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  walkTitle: { color: Palette.paper, fontFamily: 'serif', fontSize: 15, fontWeight: '700' },
  walkText: { color: 'rgba(243,234,219,0.8)', fontSize: 12 },
  chipLegend: { backgroundColor: 'rgba(59,143,224,0.75)' },
  generate: { backgroundColor: Palette.paper, borderRadius: Radius.md, paddingVertical: 10, paddingHorizontal: Spacing.md, alignItems: 'center', gap: 2 },
  generateText: { color: Palette.ink, fontFamily: 'serif', fontSize: 16, fontWeight: '700' },
  generateHint: { color: Palette.inkSoft, fontSize: 11 },
});
