import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PhotoCard } from '@/components/photo-card';
import { Palette, Spacing } from '@/constants/theme';
import { useUserLocation } from '@/hooks/use-user-location';
import { api } from '@/lib/api';
import { DEFAULT_CENTER } from '@/lib/config';

export default function NearbyScreen() {
  const { location, denied } = useUserLocation();
  const origin = location ?? DEFAULT_CENTER;
  // Re-query when the user moves ~100 m, not on every GPS tick.
  const key = [origin.lat.toFixed(3), origin.lon.toFixed(3)];
  const { data, isLoading, error, refetch, isRefetching } = useQuery({ queryKey: ['nearby', ...key], queryFn: () => api.nearby(origin.lat, origin.lon) });

  return (
    <SafeAreaView edges={['top']} style={styles.container}>
      <Text style={styles.title}>W pobliżu</Text>
      <Text style={styles.subtitle}>{location ? 'Od Twojej pozycji' : denied ? 'Brak zgody na lokalizację – liczę od Rynku' : 'Od Rynku we Wrocławiu'}</Text>
      {isLoading ? <ActivityIndicator color={Palette.sepia} style={{ marginTop: Spacing.xl }} /> : null}
      {error ? <Text style={styles.error}>Nie udało się pobrać ech: {String(error.message)}</Text> : null}
      <FlatList
        data={data?.items ?? []}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ gap: Spacing.md, padding: Spacing.lg, paddingBottom: 120 }}
        onRefresh={refetch}
        refreshing={isRefetching}
        renderItem={({ item }) => <PhotoCard photo={item} compact onPress={() => router.push(`/echo/${item.id}`)} />}
        ListEmptyComponent={!isLoading ? <View style={{ padding: Spacing.xl }}><Text style={styles.subtitle}>Brak ech w promieniu 25 km.</Text></View> : null}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Palette.paper },
  title: { fontFamily: 'serif', fontSize: 30, fontWeight: '700', color: Palette.ink, paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg },
  subtitle: { fontSize: 13, color: Palette.inkSoft, paddingHorizontal: Spacing.lg },
  error: { color: Palette.danger, padding: Spacing.lg },
});
