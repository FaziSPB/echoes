import { fetchWithRetry } from './http';

/** zabytek.pl object pages embed the NID point as `lat=..&lng=..` in map links. */
export function parseZabytekPlCoords(html: string): { lat: number; lon: number } | null {
  const m = html.match(/lat=(-?\d+\.\d+)&(?:amp;)?lng=(-?\d+\.\d+)/) ?? html.match(/"lat":\s*(-?\d+\.\d+),\s*"lon":\s*(-?\d+\.\d+)/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

export async function fetchZabytekPlCoords(url: string) {
  const res = await fetchWithRetry(url, { timeoutMs: 20_000, retries: 2 });
  if (!res.ok) return null;
  return parseZabytekPlCoords(await res.text());
}
