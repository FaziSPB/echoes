import type { MonumentPoint, PhotoSummary } from '@echoes/shared';
import { distanceM, bearingDeg } from '@echoes/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, type Region } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PhotoCard } from '@/components/photo-card';
import { Palette, Radius, Spacing } from '@/constants/theme';
import { useUserLocation } from '@/hooks/use-user-location';
import { api, type BBox } from '@/lib/api';
import { DEFAULT_CENTER } from '@/lib/config';
import { SEPIA_MAP_STYLE } from '@/lib/map-style';

const INITIAL_REGION: Region = { latitude: DEFAULT_CENTER.lat, longitude: DEFAULT_CENTER.lon, latitudeDelta: 0.012, longitudeDelta: 0.012 };

function regionToView(r: Region): { bbox: BBox; zoom: number } {
  const bbox: BBox = [r.longitude - r.longitudeDelta / 2, r.latitude - r.latitudeDelta / 2, r.longitude + r.longitudeDelta / 2, r.latitude + r.latitudeDelta / 2];
  return { bbox, zoom: Math.log2(360 / r.longitudeDelta) };
}

type Selection = { kind: 'photo'; photo: PhotoSummary } | { kind: 'monument'; monument: MonumentPoint } | null;

export default function MapScreen() {
  const mapRef = useRef<MapView>(null);
  const [view, setView] = useState(() => regionToView(INITIAL_REGION));
  const [selection, setSelection] = useState<Selection>(null);
  const { location } = useUserLocation();

  // Round the viewport so small pans hit the cache instead of the network.
  const key = useMemo(() => [...view.bbox.map((n) => n.toFixed(3)), Math.round(view.zoom)], [view]);
  const monuments = useQuery({ queryKey: ['monuments', ...key], queryFn: () => api.monuments(view.bbox, view.zoom), placeholderData: keepPreviousData });
  const photos = useQuery({ queryKey: ['photos-bbox', ...key], queryFn: () => api.photosInBbox(view.bbox), placeholderData: keepPreviousData });

  const selectedPhoto = useMemo(() => {
    if (selection?.kind !== 'photo') return null;
    const p = selection.photo;
    return location ? { ...p, distanceM: distanceM(location.lat, location.lon, p.lat, p.lon), bearingDeg: bearingDeg(location.lat, location.lon, p.lat, p.lon) } : p;
  }, [selection, location]);

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={INITIAL_REGION}
        customMapStyle={SEPIA_MAP_STYLE}
        showsUserLocation
        showsMyLocationButton={false}
        toolbarEnabled={false}
        onRegionChangeComplete={(r) => setView(regionToView(r))}
        onPress={() => setSelection(null)}>
        {monuments.data?.items.map((m) =>
          m.kind === 'cluster' ? (
            <Marker
              key={`c-${m.lat.toFixed(5)}-${m.lon.toFixed(5)}`}
              coordinate={{ latitude: m.lat, longitude: m.lon }}
              tracksViewChanges={false}
              onPress={() => mapRef.current?.animateCamera({ center: { latitude: m.lat, longitude: m.lon }, zoom: Math.round(view.zoom) + 2 })}>
              <View style={[styles.cluster, { width: 26 + Math.min(m.count, 60) / 3, height: 26 + Math.min(m.count, 60) / 3 }]}>
                <Text style={styles.clusterText}>{m.count}</Text>
              </View>
            </Marker>
          ) : (
            <Marker
              key={m.inspireId}
              coordinate={{ latitude: m.lat, longitude: m.lon }}
              tracksViewChanges={false}
              onPress={(e) => {
                e.stopPropagation();
                setSelection({ kind: 'monument', monument: m });
              }}>
              <View style={styles.monumentDot} />
            </Marker>
          ),
        )}
        {photos.data?.items.map((p) => (
          <Marker
            key={p.id}
            coordinate={{ latitude: p.lat, longitude: p.lon }}
            tracksViewChanges={false}
            zIndex={10}
            onPress={(e) => {
              e.stopPropagation();
              setSelection({ kind: 'photo', photo: p });
            }}>
            <View style={[styles.echoMarker, selection?.kind === 'photo' && selection.photo.id === p.id && styles.echoMarkerActive]}>
              <Text style={styles.echoMarkerText}>{p.yearFrom ?? '?'}</Text>
            </View>
          </Marker>
        ))}
      </MapView>

      <SafeAreaView edges={['top']} style={styles.header} pointerEvents="box-none">
        <View style={styles.brand}>
          <Text style={styles.brandTitle}>Echoes</Text>
          <Text style={styles.brandSub}>Wrocław · {photos.data?.items.length ?? 0} ech w kadrze</Text>
        </View>
        {location ? (
          <Pressable
            style={styles.locate}
            onPress={() => mapRef.current?.animateCamera({ center: { latitude: location.lat, longitude: location.lon }, zoom: 17 })}>
            <Text style={styles.locateText}>◎</Text>
          </Pressable>
        ) : null}
      </SafeAreaView>

      {selectedPhoto ? (
        <View style={styles.sheet}>
          <PhotoCard photo={selectedPhoto} onPress={() => router.push(`/echo/${selectedPhoto.id}`)} />
          <Text style={styles.attribution} numberOfLines={2}>
            {selectedPhoto.attribution}
          </Text>
          <Pressable style={styles.cta} onPress={() => router.push(`/echo/${selectedPhoto.id}`)}>
            <Text style={styles.ctaText}>Wejdź w Echo</Text>
          </Pressable>
        </View>
      ) : null}

      {selection?.kind === 'monument' ? (
        <View style={styles.sheet}>
          <Text style={styles.monumentLabel}>Rejestr zabytków NID</Text>
          <Text style={styles.monumentName}>{selection.monument.name}</Text>
          <Text style={styles.monumentMeta}>{[selection.monument.function, selection.monument.chronology].filter(Boolean).join(' · ')}</Text>
          <Pressable
            style={[styles.cta, styles.ctaSecondary]}
            onPress={() =>
              WebBrowser.openBrowserAsync(
                `https://zabytek.pl/pl/obiekty/zabytek?inspire_id=${encodeURIComponent(selection.monument.inspireId)}&rejestr=rejestr-zabytkow`,
              )
            }>
            <Text style={[styles.ctaText, { color: Palette.ink }]}>Karta w zabytek.pl</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Palette.paper },
  header: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: Spacing.lg },
  brand: { backgroundColor: 'rgba(243,234,219,0.94)', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, borderRadius: Radius.md, marginTop: Spacing.sm, borderWidth: 1, borderColor: Palette.paperDark },
  brandTitle: { fontFamily: 'serif', fontSize: 24, fontWeight: '700', color: Palette.ink, letterSpacing: 1 },
  brandSub: { fontSize: 12, color: Palette.inkSoft },
  locate: { marginTop: Spacing.sm, width: 48, height: 48, borderRadius: 24, backgroundColor: Palette.paper, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Palette.paperDark },
  locateText: { fontSize: 22, color: Palette.ink },
  cluster: { borderRadius: 999, backgroundColor: 'rgba(107,90,72,0.78)', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: Palette.paper },
  clusterText: { color: Palette.paper, fontSize: 11, fontWeight: '700' },
  monumentDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: Palette.inkSoft, borderWidth: 2, borderColor: Palette.paper },
  echoMarker: { paddingHorizontal: 8, height: 30, borderRadius: 15, backgroundColor: Palette.sepia, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: Palette.white },
  echoMarkerActive: { backgroundColor: Palette.ink, transform: [{ scale: 1.15 }] },
  echoMarkerText: { color: Palette.white, fontFamily: 'serif', fontWeight: '700', fontSize: 13 },
  sheet: { position: 'absolute', left: Spacing.lg, right: Spacing.lg, bottom: Spacing.xl, gap: Spacing.sm, backgroundColor: Palette.paper, padding: Spacing.md, borderRadius: Radius.lg, borderWidth: 1, borderColor: Palette.paperDark, elevation: 6 },
  attribution: { fontSize: 11, color: Palette.inkSoft, fontStyle: 'italic' },
  cta: { backgroundColor: Palette.ink, borderRadius: Radius.pill, paddingVertical: Spacing.md, alignItems: 'center' },
  ctaSecondary: { backgroundColor: Palette.paperDark },
  ctaText: { color: Palette.paper, fontSize: 16, fontWeight: '700', letterSpacing: 0.5 },
  monumentLabel: { fontSize: 11, color: Palette.sepia, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  monumentName: { fontFamily: 'serif', fontSize: 20, color: Palette.ink, fontWeight: '600' },
  monumentMeta: { fontSize: 13, color: Palette.inkSoft },
});
