import Constants from 'expo-constants';

/**
 * API origin. In dev we default to the machine running Metro (same LAN IP, port 3000);
 * for tunnels / deployments set EXPO_PUBLIC_API_URL.
 */
function defaultApiUrl(): string {
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  return host ? `http://${host}:3000` : 'http://localhost:3000';
}

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? defaultApiUrl()).replace(/\/$/, '');

/** Demo-only curation token (calibration mode). Never ship a real secret in a client bundle. */
export const ADMIN_TOKEN = process.env.EXPO_PUBLIC_ADMIN_TOKEN ?? '';

/** Wrocław, Rynek – default map centre and "remote mode" reference. */
export const DEFAULT_CENTER = { lat: 51.1100, lon: 17.0320 };

/** Beyond this distance from the photo's spot we switch to remote (gyro-only) mode. */
export const ON_SITE_RADIUS_M = 150;
