import pLimit from 'p-limit';
import { discoverRegistryResource } from '../clients/daneGov';
import { parseUug, primaryHouseNumber, uugQuery, type GeocodeHit, type UugResponse } from '../clients/gugik';
import { fetchRegistry } from '../clients/zabytekRegistry';
import { fetchZabytekPlCoords } from '../clients/zabytekPl';
import { sql } from '../db';
import { log } from '../log';
import { upsertMonuments } from '../repos/monuments';

const BATCH = 1000;

/** dane.gov.pl catalogue → NID REST API → upsert. Skips the download when the resource hasn't changed. */
export async function syncRegistry(opts: { force?: boolean } = {}): Promise<{ upserted: number; skipped: boolean }> {
  const resource = await discoverRegistryResource();
  const [state] = await sql<{ value: { modified: string | null } }[]>`select value from sync_state where key = 'registry'`;
  if (!opts.force && state && resource.modified && state.value.modified === resource.modified) {
    log.info({ modified: resource.modified }, 'registry unchanged – skipping');
    return { upserted: 0, skipped: true };
  }

  log.info({ url: resource.url, modified: resource.modified }, 'downloading registry');
  const rows = await fetchRegistry(resource.url);
  for (let i = 0; i < rows.length; i += BATCH) {
    await upsertMonuments(rows.slice(i, i + BATCH));
    if ((i / BATCH) % 10 === 0) log.info({ done: i + BATCH, total: rows.length }, 'registry upsert progress');
  }
  await sql`
    insert into sync_state (key, value) values ('registry', ${sql.json({ modified: resource.modified, count: rows.length })})
    on conflict (key) do update set value = excluded.value, updated_at = now()`;
  log.info({ count: rows.length }, 'registry synced');
  return { upserted: rows.length, skipped: false };
}

async function cachedUug(address: string): Promise<UugResponse> {
  const [hit] = await sql<{ response: UugResponse }[]>`select response from geocode_cache where query = ${address}`;
  if (hit) return hit.response;
  const response = await uugQuery(address);
  await sql`insert into geocode_cache (query, response) values (${address}, ${sql.json(response as never)}) on conflict do nothing`;
  return response;
}

/** Address-level GUGiK hit for "City, Street Number", trying the full and the primary house number. */
export async function geocodeAddress(city: string, street: string, houseNumber: string | null): Promise<GeocodeHit | null> {
  const numbers = [...new Set([houseNumber, primaryHouseNumber(houseNumber)].filter(Boolean))] as string[];
  for (const n of numbers) {
    const hit = parseUug(await cachedUug(`${city}, ${street} ${n}`), city);
    if (hit && hit.level === 'address' && hit.accuracy >= 0.75) return hit;
  }
  return null;
}

export async function geocodeStreet(city: string, street: string): Promise<GeocodeHit | null> {
  const hit = parseUug(await cachedUug(`${city}, ${street}`), city);
  return hit && hit.accuracy >= 0.7 ? hit : null;
}

type Pending = { inspireId: string; city: string; street: string | null; houseNumber: string | null; zabytekUrl: string };

/**
 * Coordinates are not part of the open register, so we derive them:
 * 1) GUGiK address geocoder (official), 2) the NID point published on zabytek.pl, 3) GUGiK street centroid.
 */
export async function geocodeMonuments(cities: string[], opts: { limit?: number; concurrency?: number } = {}) {
  const pending = await sql<Pending[]>`
    select inspire_id, city, street, house_number, zabytek_url
    from monuments
    where city in ${sql(cities)} and location is null and geocode_attempted_at is null
    limit ${opts.limit ?? 100_000}`;
  log.info({ count: pending.length, cities }, 'geocoding monuments');

  const limit = pLimit(opts.concurrency ?? 4);
  const stats = { gugik: 0, zabytek_pl: 0, gugik_street: 0, failed: 0 };

  await Promise.all(
    pending.map((m) =>
      limit(async () => {
        let source: keyof typeof stats = 'failed';
        let point: { lat: number; lon: number; accuracy: number } | null = null;
        try {
          if (m.street) {
            const hit = await geocodeAddress(m.city, m.street, m.houseNumber);
            if (hit) [source, point] = ['gugik', hit];
          }
          if (!point) {
            const p = await fetchZabytekPlCoords(m.zabytekUrl);
            if (p) [source, point] = ['zabytek_pl', { ...p, accuracy: 0.9 }];
          }
          if (!point && m.street) {
            const hit = await geocodeStreet(m.city, m.street);
            if (hit) [source, point] = ['gugik_street', { ...hit, accuracy: hit.accuracy * 0.5 }];
          }
        } catch (err) {
          log.warn({ inspireId: m.inspireId, err: String(err) }, 'geocode error');
        }
        stats[source]++;
        if (point) {
          await sql`
            update monuments set
              location = st_setsrid(st_makepoint(${point.lon}, ${point.lat}), 4326),
              geocode_source = ${source}, geocode_accuracy = ${point.accuracy}, geocode_attempted_at = now()
            where inspire_id = ${m.inspireId}`;
        } else {
          await sql`update monuments set geocode_attempted_at = now() where inspire_id = ${m.inspireId}`;
        }
        const done = Object.values(stats).reduce((a, b) => a + b, 0);
        if (done % 100 === 0) log.info({ done, total: pending.length, ...stats }, 'geocode progress');
      }),
    ),
  );
  log.info(stats, 'geocoding finished');
  return stats;
}
