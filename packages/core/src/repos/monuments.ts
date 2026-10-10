import type { MonumentBrief, MonumentMapItem } from '@echoes/shared';
import { sql } from '../db';
import type { MonumentRow } from '../clients/zabytekRegistry';

type BBox = [minLon: number, minLat: number, maxLon: number, maxLat: number];

/** Above this zoom we return individual monuments; below it, grid clusters. */
const POINTS_FROM_ZOOM = 16;

export async function monumentsInBbox(bbox: BBox, zoom: number): Promise<MonumentMapItem[]> {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const env = sql`st_makeenvelope(${minLon}, ${minLat}, ${maxLon}, ${maxLat}, 4326)`;

  if (zoom >= POINTS_FROM_ZOOM) {
    const rows = await sql<
      { inspireId: string; name: string; function: string | null; chronology: string | null; lat: number; lon: number; echoCount: number }[]
    >`
      select m.inspire_id, m.name, m.function, m.chronology,
             st_y(m.location) as lat, st_x(m.location) as lon,
             (select count(*)::int from archival_photos p
               where p.monument_inspire_id = m.inspire_id and p.status = 'verified') as echo_count
      from monuments m
      where m.location && ${env}
      limit 1500`;
    return rows.map((r) => ({ kind: 'monument' as const, ...r }));
  }

  // ~8 cells across a 256px tile at this zoom.
  const cell = 360 / 2 ** zoom / 8;
  const rows = await sql<
    {
      n: number;
      lat: number;
      lon: number;
      inspireId: string | null;
      name: string | null;
      function: string | null;
      chronology: string | null;
      echoCount: number | null;
    }[]
  >`
    with g as (
      select count(*)::int as n,
             st_y(st_centroid(st_collect(location))) as lat,
             st_x(st_centroid(st_collect(location))) as lon,
             (array_agg(inspire_id))[1] as one_id
      from monuments
      where location && ${env}
      group by st_snaptogrid(location, ${cell})
    )
    select g.n, g.lat, g.lon, m.inspire_id, m.name, m.function, m.chronology,
           case when m.inspire_id is null then null else
             (select count(*)::int from archival_photos p
               where p.monument_inspire_id = m.inspire_id and p.status = 'verified') end as echo_count
    from g left join monuments m on g.n = 1 and m.inspire_id = g.one_id
    limit 2000`;
  return rows.map((r) =>
    r.n === 1 && r.inspireId
      ? {
          kind: 'monument' as const,
          inspireId: r.inspireId,
          name: r.name ?? '',
          function: r.function,
          chronology: r.chronology,
          lat: r.lat,
          lon: r.lon,
          echoCount: r.echoCount ?? 0,
        }
      : { kind: 'cluster' as const, lat: r.lat, lon: r.lon, count: r.n },
  );
}

export const monumentBriefColumns = sql`
  m.inspire_id, m.name, m.chronology, m.function, m.street, m.house_number, m.city,
  m.entry_date, m.registry_docs, m.zabytek_url,
  st_y(m.location) as lat, st_x(m.location) as lon`;

export async function getMonument(inspireId: string): Promise<MonumentBrief | null> {
  const [row] = await sql<MonumentBrief[]>`select ${monumentBriefColumns} from monuments m where m.inspire_id = ${inspireId}`;
  return row ?? null;
}

export async function upsertMonuments(rows: MonumentRow[]): Promise<void> {
  if (rows.length === 0) return;
  await sql`
    insert into monuments ${sql(rows as unknown as Record<string, unknown>[])}
    on conflict (inspire_id) do update set
      name = excluded.name,
      protection_form = excluded.protection_form,
      location_precision = excluded.location_precision,
      chronology = excluded.chronology,
      function = excluded.function,
      registry_docs = excluded.registry_docs,
      entry_date = excluded.entry_date,
      voivodeship = excluded.voivodeship,
      county = excluded.county,
      commune = excluded.commune,
      city = excluded.city,
      street = excluded.street,
      house_number = excluded.house_number,
      zabytek_url = excluded.zabytek_url,
      source_synced_at = now()`;
}

/** Fuzzy name match inside a city (pg_trgm), used to link landmarks mentioned in photo captions. */
export async function findMonumentByName(city: string, name: string): Promise<{ inspireId: string; name: string; lat: number; lon: number; score: number } | null> {
  const [row] = await sql<{ inspireId: string; name: string; lat: number; lon: number; score: number }[]>`
    select inspire_id, name, st_y(location) as lat, st_x(location) as lon, similarity(name, ${name}) as score
    from monuments
    where city = ${city} and location is not null and name % ${name}
    order by score desc
    limit 1`;
  return row ?? null;
}

export async function nearestMonument(lat: number, lon: number, maxM: number) {
  const [row] = await sql<{ inspireId: string; name: string; distanceM: number }[]>`
    select inspire_id, name,
           st_distance(location::geography, st_setsrid(st_makepoint(${lon}, ${lat}), 4326)::geography) as distance_m
    from monuments
    where location is not null
      and st_dwithin(location::geography, st_setsrid(st_makepoint(${lon}, ${lat}), 4326)::geography, ${maxM})
    order by distance_m
    limit 1`;
  return row ?? null;
}
