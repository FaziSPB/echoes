import { fetchJson } from './http';

/** GUGiK "Usługa Udostępniania Geokodowania" (official Polish address geocoder). */
const UUG = 'https://services.gugik.gov.pl/uug/';

type UugResult = {
  city?: string;
  street?: string | null;
  number?: string | null;
  x?: string;
  y?: string;
  accuracy?: string;
};
export type UugResponse = { type?: string; results?: Record<string, UugResult> | null };

export type GeocodeHit = { lat: number; lon: number; accuracy: number; level: 'address' | 'street' };

export function parseUug(res: UugResponse, city: string): GeocodeHit | null {
  const results = Object.values(res.results ?? {});
  const hit = results.find((r) => r.city?.toLowerCase() === city.toLowerCase()) ?? null;
  if (!hit?.x || !hit.y) return null;
  return {
    lon: Number(hit.x),
    lat: Number(hit.y),
    accuracy: Number(hit.accuracy ?? 0),
    level: res.type === 'address' ? 'address' : 'street',
  };
}

export async function uugQuery(address: string): Promise<UugResponse> {
  const url = `${UUG}?request=GetAddress&srid=4326&address=${encodeURIComponent(address)}`;
  return fetchJson<UugResponse>(url, { timeoutMs: 20_000 });
}

/** "2/3" → "2", "8-14" → "8", "12a" stays. */
export function primaryHouseNumber(n: string | null): string | null {
  if (!n) return null;
  const first = n.split(/[\/,\-–\s]/)[0]?.trim();
  return first || null;
}
