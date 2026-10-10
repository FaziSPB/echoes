import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Palette } from '@/constants/theme';

export default function RootLayout() {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, retry: 1 } } }),
  );
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Palette.paper } }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="echo/[photoId]" options={{ animation: 'fade', contentStyle: { backgroundColor: '#000' } }} />
        </Stack>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
