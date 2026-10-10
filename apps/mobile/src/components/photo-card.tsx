import type { PhotoSummary } from '@echoes/shared';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Palette, Radius, Spacing } from '@/constants/theme';

export function formatDistance(m: number | undefined): string | null {
  if (m === undefined) return null;
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

export function PhotoCard({ photo, onPress, compact = false }: { photo: PhotoSummary; onPress?: () => void; compact?: boolean }) {
  const distance = formatDistance(photo.distanceM);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}>
      <Image source={photo.thumbUrl ?? undefined} style={[styles.thumb, compact && styles.thumbCompact]} contentFit="cover" transition={200} />
      <View style={styles.body}>
        <Text style={styles.year}>{photo.yearLabel ?? 'data nieznana'}</Text>
        <Text style={styles.title} numberOfLines={2}>
          {photo.title}
        </Text>
        {photo.monumentName ? (
          <Text style={styles.meta} numberOfLines={1}>
            Zabytek: {photo.monumentName}
          </Text>
        ) : null}
        <View style={styles.row}>
          {distance ? <Text style={styles.chip}>{distance}</Text> : null}
          {photo.echoStatus === 'done' ? <Text style={[styles.chip, styles.chipAi]}>Echo 360°</Text> : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', gap: Spacing.md, padding: Spacing.md, backgroundColor: Palette.white, borderRadius: Radius.md, borderWidth: 1, borderColor: Palette.paperDark },
  thumb: { width: 104, height: 104, borderRadius: Radius.sm, backgroundColor: Palette.paperDark },
  thumbCompact: { width: 84, height: 84 },
  body: { flex: 1, gap: 2 },
  year: { fontFamily: 'serif', fontSize: 13, color: Palette.sepia, fontWeight: '700', letterSpacing: 1 },
  title: { fontFamily: 'serif', fontSize: 16, color: Palette.ink, fontWeight: '600' },
  meta: { fontSize: 12, color: Palette.inkSoft },
  row: { flexDirection: 'row', gap: Spacing.xs, marginTop: Spacing.xs },
  chip: { fontSize: 11, color: Palette.inkSoft, backgroundColor: Palette.paper, paddingHorizontal: 8, paddingVertical: 2, borderRadius: Radius.pill, overflow: 'hidden' },
  chipAi: { color: Palette.white, backgroundColor: Palette.ai },
});
