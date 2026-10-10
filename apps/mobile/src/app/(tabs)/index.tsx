import type { MonumentPoint, PhotoSummary } from '@echoes/shared';
import { distanceM, bearingDeg } from '@echoes/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LeafletMap, type LeafletMapHandle } from '@/components/leaflet-map';
import { PhotoCard } from '@/components/photo-card';
import { Palette, Radius, Spacing } from '@/constants/theme';
import { useUserLocation } from '@/hooks/use-user-location';
import { api, type BBox } from '@/lib/api';
import { DEFAULT_CENTER } from '@/lib/config';

const INITIAL_ZOOM = 16;

/** Viewport before the map reports its real bounds (~Old Town). */
const INITIAL_VIEW: { bbox: BBox; zoom: number } = {
  bbox: [DEFAULT_CENTER.lon - 0.006, DEFAULT_CENTER.lat - 0.004, DEFAULT_CENTER.lon + 0.006, DEFAULT_CENTER.lat + 0.004],
  zoom: INITIAL_ZOOM,
};

type Selection = { kind: 'photo'; photo: PhotoSummary } | { kind: 'monument'; monument: MonumentPoint } | null;

export default function MapScreen() {
  const mapRef = useRef<LeafletMapHandle>(null);
  const [view, setView] = useState(INITIAL_VIEW);
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
      <LeafletMap
        ref={mapRef}
        initialCenter={DEFAULT_CENTER}
        initialZoom={INITIAL_ZOOM}
        monuments={monuments.data?.items ?? []}
        photos={photos.data?.items ?? []}
        selectedPhotoId={selection?.kind === 'photo' ? selection.photo.id : null}
        me={location}
        onRegionChange={(bbox, zoom) => setView({ bbox, zoom })}
        onPress={() => setSelection(null)}
        onSelectPhoto={(id) => {
          const photo = photos.data?.items.find((p) => p.id === id);
          if (photo) setSelection({ kind: 'photo', photo });
        }}
        onSelectMonument={(id) => {
          const monument = monuments.data?.items.find((m) => m.kind === 'monument' && m.inspireId === id);
          if (monument?.kind === 'monument') setSelection({ kind: 'monument', monument });
        }}
      />

      <SafeAreaView edges={['top']} style={styles.header} pointerEvents="box-none">
        <View style={styles.brand}>
          <Text style={styles.brandTitle}>Echoes</Text>
          <Text style={styles.brandSub}>Wrocław · {photos.data?.items.length ?? 0} ech w kadrze</Text>
        </View>
        {location ? (
          <Pressable
            style={styles.locate}
            onPress={() => mapRef.current?.flyTo(location.lat, location.lon, 17)}>
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
  sheet: { position: 'absolute', left: Spacing.lg, right: Spacing.lg, bottom: Spacing.xl, gap: Spacing.sm, backgroundColor: Palette.paper, padding: Spacing.md, borderRadius: Radius.lg, borderWidth: 1, borderColor: Palette.paperDark, elevation: 6 },
  attribution: { fontSize: 11, color: Palette.inkSoft, fontStyle: 'italic' },
  cta: { backgroundColor: Palette.ink, borderRadius: Radius.pill, paddingVertical: Spacing.md, alignItems: 'center' },
  ctaSecondary: { backgroundColor: Palette.paperDark },
  ctaText: { color: Palette.paper, fontSize: 16, fontWeight: '700', letterSpacing: 0.5 },
  monumentLabel: { fontSize: 11, color: Palette.sepia, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  monumentName: { fontFamily: 'serif', fontSize: 20, color: Palette.ink, fontWeight: '600' },
  monumentMeta: { fontSize: 13, color: Palette.inkSoft },
});
