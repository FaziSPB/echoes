import * as Location from 'expo-location';
import { useEffect, useState } from 'react';

export type UserLocation = { lat: number; lon: number; accuracy: number | null };

/** Foreground location with a light watch (good enough to know if we stand at the photo's spot). */
export function useUserLocation() {
  const [location, setLocation] = useState<UserLocation | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    let sub: Location.LocationSubscription | undefined;
    let cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setDenied(true);
        return;
      }
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 5, timeInterval: 3000 },
        (pos) => !cancelled && setLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      );
    })();
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, []);

  return { location, denied };
}
