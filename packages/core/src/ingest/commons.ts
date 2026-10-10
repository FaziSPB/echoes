import { z } from 'zod';
import { categoryFiles, NAC_COMMONS_CATEGORY, searchCommonsFiles, subcategories, type CommonsPhoto } from '../clients/commons';
import { generateJson } from '../clients/gemini';
import { sql } from '../db';
import { log } from '../log';
import { findMonumentByName, nearestMonument } from '../repos/monuments';
import { setPhotoLocation, upsertPhoto } from '../repos/photos';
import { geocodeAddress, geocodeStreet } from './registry';

/** Historical (mostly German) names used in captions of pre-1945 photos. */
const HISTORIC_NAMES: Record<string, string[]> = {
  Wrocław: ['Breslau'],
  Gdańsk: ['Danzig'],
  Szczecin: ['Stettin'],
  Poznań: ['Posen'],
};

export function yearsFromText(text: string | null): { yearFrom: number | null; yearTo: number | null } {
  const years = [...(text ?? '').matchAll(/\b(1[89]\d\d)\b/g)].map((m) => Number(m[1]));
  if (years.length === 0) return { yearFrom: null, yearTo: null };
  return { yearFrom: Math.min(...years), yearTo: Math.max(...years) };
}

async function storeCandidate(p: CommonsPhoto, city: string, fromNac: boolean): Promise<boolean> {
  const { yearFrom, yearTo } = yearsFromText(p.dateText);
  if (yearFrom && yearFrom > 1990) return false; // not an archival photo
  await upsertPhoto({
    source: fromNac ? 'commons_nac' : 'commons',
    sourceRef: p.title,
    title: (p.description ?? p.title.replace(/^File:/, '').replace(/\.\w+$/, '')).slice(0, 300),
    description: p.description,
    dateText: p.dateText,
    yearFrom,
    yearTo,
    author: p.author,
    license: p.license,
    attribution: fromNac && p.nacSignature ? `Narodowe Archiwum Cyfrowe, sygn. ${p.nacSignature} (via Wikimedia Commons)` : `Wikimedia Commons: ${p.author ?? 'autor nieznany'}, ${p.license ?? ''}`.trim(),
    originalUrl: p.pageUrl,
    remoteImageUrl: p.thumbUrl ?? p.url,
    imageKey: null,
    thumbKey: null,
    width: p.width,
    height: p.height,
    city,
    lat: p.lat,
    lon: p.lon,
    headingDeg: null,
    status: 'candidate',
  });
  return true;
}

/** Harvest candidate archival photos for a city: the NAC mirror on Commons + the city's "in the 19x0s" categories. */
export async function harvestCommons(city: string, opts: { max?: number } = {}) {
  const max = opts.max ?? 300;
  const names = [city, ...(HISTORIC_NAMES[city] ?? [])];
  let stored = 0;

  for (const name of names) {
    for await (const p of searchCommonsFiles(`incategory:"${NAC_COMMONS_CATEGORY.replace('Category:', '')}" "${name}"`, max)) {
      if (await storeCandidate(p, city, true)) stored++;
    }
  }

  for (const decade of [1880, 1890, 1900, 1910, 1920, 1930, 1940, 1950, 1960]) {
    const root = `Category:${city} in the ${decade}s`;
    const cats = [root, ...(await subcategories(root).catch(() => []))];
    for (const cat of cats) {
      for await (const p of categoryFiles(cat, 100)) {
        if (await storeCandidate(p, city, false)) stored++;
      }
    }
  }
  log.info({ city, stored }, 'commons harvest finished');
  return { stored };
}

export const GeoparseResult = z.object({
  street: z.string().nullable().describe('Street or square name in its current Polish form, without "ul."'),
  houseNumber: z.string().nullable(),
  crossStreet: z.string().nullable(),
  landmark: z.string().nullable().describe('Named building or monument visible, e.g. "Ratusz", "Katedra św. Jana Chrzciciela"'),
  isOutdoorCityView: z.boolean().describe('True if the photo shows an outdoor street/square/building view usable for AR'),
  confidence: z.number().min(0).max(1),
});
export type GeoparseResult = z.infer<typeof GeoparseResult>;

function geoparsePrompt(city: string, title: string, description: string | null): string {
  return `You geolocate archival photographs from captions. City: ${city}.
Captions may use historic or German street names (e.g. Breslau: "Ring" = Rynek, "Schweidnitzer Straße" = ul. Świdnicka, "Blücherplatz" = Plac Solny, "Dom" = Katedra). Translate to the current Polish name.
Return null fields when the caption does not say. Be conservative with confidence.

Title: ${title}
Caption: ${description ?? '(none)'}`;
}

/** AI geoparsing of captions → GUGiK geocoding or fuzzy match against register names. */
export async function geoparseCandidates(city: string, opts: { limit?: number } = {}) {
  const rows = await sql<{ id: string; title: string; description: string | null }[]>`
    select id, title, description from archival_photos
    where city = ${city} and status = 'candidate' and location is null and geoparse is null
    limit ${opts.limit ?? 50}`;
  let located = 0;
  for (const r of rows) {
    try {
      const g = await generateJson(geoparsePrompt(city, r.title, r.description), GeoparseResult);
      let point: { lat: number; lon: number } | null = null;
      let conf = g.confidence;
      let monumentId: string | null = null;
      if (g.isOutdoorCityView && g.street) {
        const hit = (await geocodeAddress(city, g.street, g.houseNumber)) ?? (await geocodeStreet(city, g.street));
        if (hit) {
          point = hit;
          conf *= hit.level === 'address' ? 1 : 0.7;
        }
      }
      if (!point && g.isOutdoorCityView && g.landmark) {
        const m = await findMonumentByName(city, g.landmark);
        if (m && m.score > 0.3) {
          point = m;
          monumentId = m.inspireId;
          conf *= 0.8;
        }
      }
      if (point) {
        await setPhotoLocation(r.id, point.lat, point.lon, conf, g, monumentId);
        located++;
      } else {
        await sql`update archival_photos set geoparse = ${sql.json(g)} where id = ${r.id}`;
      }
    } catch (err) {
      log.warn({ id: r.id, err: String(err) }, 'geoparse failed');
    }
  }
  log.info({ city, processed: rows.length, located }, 'geoparse finished');
  return { processed: rows.length, located };
}

/** Attach located photos to the nearest registered monument (≤120 m). */
export async function linkPhotosToMonuments(maxM = 120) {
  const rows = await sql<{ id: string; lat: number; lon: number }[]>`
    select id, st_y(location) as lat, st_x(location) as lon
    from archival_photos where location is not null and monument_inspire_id is null`;
  let linked = 0;
  for (const r of rows) {
    const m = await nearestMonument(r.lat, r.lon, maxM);
    if (m) {
      await sql`update archival_photos set monument_inspire_id = ${m.inspireId}, updated_at = now() where id = ${r.id}`;
      linked++;
    }
  }
  log.info({ linked, of: rows.length }, 'photos linked to monuments');
  return { linked };
}
