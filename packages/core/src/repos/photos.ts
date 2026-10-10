import { bearingDeg, distanceM, type PhotoAdminPatch, type PhotoDetail, type PhotoSource, type PhotoStatus, type PhotoSummary } from '@echoes/shared';
import { compact, sql } from '../db';
import { env } from '../env';
import { mediaUrl } from '../storage';
import { getEchoForPhoto, toEchoDto } from './echoes';
import { getMonument } from './monuments';

type SummaryRow = {
  id: string;
  title: string;
  dateText: string | null;
  yearFrom: number | null;
  yearTo: number | null;
  thumbKey: string | null;
  imageKey: string | null;
  lat: number;
  lon: number;
  headingDeg: number | null;
  source: PhotoSource;
  sourceRef: string;
  attribution: string | null;
  monumentInspireId: string | null;
  monumentName: string | null;
  echoStatus: PhotoSummary['echoStatus'];
};

const summaryColumns = sql`
  p.id, p.title, p.date_text, p.year_from, p.year_to, p.thumb_key, p.image_key,
  st_y(p.location) as lat, st_x(p.location) as lon, p.heading_deg,
  p.source, p.source_ref, p.attribution, p.monument_inspire_id, m.name as monument_name,
  e.status as echo_status`;

const summaryJoins = sql`
  left join monuments m on m.inspire_id = p.monument_inspire_id
  left join echoes e on e.photo_id = p.id and e.pipeline_version = ${env.ECHO_PIPELINE_VERSION}`;

export function yearLabel(r: { yearFrom: number | null; yearTo: number | null; dateText: string | null }): string | null {
  if (r.yearFrom && r.yearTo && r.yearTo !== r.yearFrom) return `${r.yearFrom}–${r.yearTo}`;
  if (r.yearFrom) return String(r.yearFrom);
  return r.dateText;
}

function toSummary(r: SummaryRow, from?: { lat: number; lon: number }): PhotoSummary {
  return {
    id: r.id,
    title: r.title,
    yearLabel: yearLabel(r),
    yearFrom: r.yearFrom,
    thumbUrl: mediaUrl(r.thumbKey ?? r.imageKey),
    lat: r.lat,
    lon: r.lon,
    headingDeg: r.headingDeg,
    source: r.source,
    sourceRef: r.sourceRef,
    attribution: r.attribution,
    monumentInspireId: r.monumentInspireId,
    monumentName: r.monumentName,
    echoStatus: r.echoStatus,
    ...(from && {
      distanceM: Math.round(distanceM(from.lat, from.lon, r.lat, r.lon)),
      bearingDeg: Math.round(bearingDeg(from.lat, from.lon, r.lat, r.lon)),
    }),
  };
}

export async function photosNearby(lat: number, lon: number, radius: number, limit: number): Promise<PhotoSummary[]> {
  const here = sql`st_setsrid(st_makepoint(${lon}, ${lat}), 4326)::geography`;
  const rows = await sql<SummaryRow[]>`
    select ${summaryColumns}
    from archival_photos p ${summaryJoins}
    where p.status = 'verified' and p.location is not null
      and st_dwithin(p.location::geography, ${here}, ${radius})
    order by p.location::geography <-> ${here}
    limit ${limit}`;
  return rows.map((r) => toSummary(r, { lat, lon }));
}

export async function photosInBbox(bbox: [number, number, number, number]): Promise<PhotoSummary[]> {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const rows = await sql<SummaryRow[]>`
    select ${summaryColumns}
    from archival_photos p ${summaryJoins}
    where p.status = 'verified'
      and p.location && st_makeenvelope(${minLon}, ${minLat}, ${maxLon}, ${maxLat}, 4326)
    limit 500`;
  return rows.map((r) => toSummary(r));
}

export async function photosForMonument(inspireId: string): Promise<PhotoSummary[]> {
  const rows = await sql<SummaryRow[]>`
    select ${summaryColumns}
    from archival_photos p ${summaryJoins}
    where p.monument_inspire_id = ${inspireId} and p.status = 'verified' and p.location is not null
    order by p.year_from nulls last`;
  return rows.map((r) => toSummary(r));
}

export type PhotoRow = {
  id: string;
  source: PhotoSource;
  sourceRef: string;
  title: string;
  description: string | null;
  dateText: string | null;
  yearFrom: number | null;
  yearTo: number | null;
  author: string | null;
  license: string | null;
  attribution: string | null;
  originalUrl: string | null;
  remoteImageUrl: string | null;
  imageKey: string | null;
  thumbKey: string | null;
  width: number | null;
  height: number | null;
  city: string | null;
  lat: number | null;
  lon: number | null;
  headingDeg: number | null;
  hfovDeg: number;
  pitchDeg: number;
  geoConfidence: number | null;
  status: PhotoStatus;
  monumentInspireId: string | null;
};

export async function getPhotoRow(id: string): Promise<PhotoRow | null> {
  const [row] = await sql<PhotoRow[]>`
    select p.*, st_y(p.location) as lat, st_x(p.location) as lon
    from archival_photos p where p.id = ${id}`;
  return row ?? null;
}

export async function getPhotoDetail(id: string): Promise<PhotoDetail | null> {
  const p = await getPhotoRow(id);
  if (!p) return null;
  const [monument, echo] = await Promise.all([
    p.monumentInspireId ? getMonument(p.monumentInspireId) : null,
    getEchoForPhoto(p.id),
  ]);
  return {
    id: p.id,
    title: p.title,
    yearLabel: yearLabel(p),
    yearFrom: p.yearFrom,
    thumbUrl: mediaUrl(p.thumbKey ?? p.imageKey),
    lat: p.lat ?? 0,
    lon: p.lon ?? 0,
    headingDeg: p.headingDeg,
    source: p.source,
    sourceRef: p.sourceRef,
    attribution: p.attribution,
    monumentInspireId: p.monumentInspireId,
    monumentName: monument?.name ?? null,
    echoStatus: echo?.status ?? null,
    description: p.description,
    imageUrl: mediaUrl(p.imageKey) ?? p.remoteImageUrl,
    width: p.width,
    height: p.height,
    hfovDeg: p.hfovDeg,
    pitchDeg: p.pitchDeg,
    license: p.license,
    author: p.author,
    originalUrl: p.originalUrl,
    status: p.status,
    monument,
    echo: echo ? toEchoDto(echo) : null,
  };
}

export async function patchPhoto(id: string, patch: PhotoAdminPatch): Promise<boolean> {
  const { lat, lon, ...rest } = patch;
  const data = compact({ ...rest, updatedAt: new Date() });
  const res =
    lat !== undefined && lon !== undefined
      ? await sql`update archival_photos set ${sql(data)}, location = st_setsrid(st_makepoint(${lon}, ${lat}), 4326) where id = ${id}`
      : await sql`update archival_photos set ${sql(data)} where id = ${id}`;
  return res.count > 0;
}

export type PhotoUpsert = Omit<PhotoRow, 'id' | 'lat' | 'lon' | 'hfovDeg' | 'pitchDeg' | 'geoConfidence' | 'status' | 'monumentInspireId'> & {
  lat: number | null;
  lon: number | null;
  hfovDeg?: number;
  pitchDeg?: number;
  geoConfidence?: number | null;
  status?: PhotoStatus;
  monumentInspireId?: string | null;
  geoparse?: unknown;
};

/** Upsert by (source, source_ref). Location/heading set by curation are only overwritten by non-null values. */
export async function upsertPhoto(p: PhotoUpsert): Promise<string> {
  const { lat, lon, geoparse, ...rest } = p;
  const data = compact({ ...rest, geoparse: geoparse === undefined ? undefined : sql.json(geoparse as never) });
  const [row] = await sql<{ id: string }[]>`
    insert into archival_photos ${sql(data)}
    on conflict (source, source_ref) do update set
      title = excluded.title,
      description = excluded.description,
      date_text = excluded.date_text,
      year_from = excluded.year_from,
      year_to = excluded.year_to,
      author = excluded.author,
      license = excluded.license,
      attribution = excluded.attribution,
      original_url = excluded.original_url,
      remote_image_url = coalesce(excluded.remote_image_url, archival_photos.remote_image_url),
      image_key = coalesce(excluded.image_key, archival_photos.image_key),
      thumb_key = coalesce(excluded.thumb_key, archival_photos.thumb_key),
      width = coalesce(excluded.width, archival_photos.width),
      height = coalesce(excluded.height, archival_photos.height),
      heading_deg = coalesce(excluded.heading_deg, archival_photos.heading_deg),
      hfov_deg = excluded.hfov_deg,
      pitch_deg = excluded.pitch_deg,
      status = case when archival_photos.status = 'verified' then archival_photos.status else excluded.status end,
      monument_inspire_id = coalesce(excluded.monument_inspire_id, archival_photos.monument_inspire_id),
      updated_at = now()
    returning id`;
  const id = row!.id;
  if (lat !== null && lon !== null) {
    await sql`update archival_photos set location = st_setsrid(st_makepoint(${lon}, ${lat}), 4326) where id = ${id}`;
  }
  return id;
}

export async function setPhotoLocation(id: string, lat: number, lon: number, confidence: number, geoparse: unknown, monumentInspireId: string | null) {
  await sql`
    update archival_photos set
      location = st_setsrid(st_makepoint(${lon}, ${lat}), 4326),
      geo_confidence = ${confidence},
      geoparse = ${sql.json(geoparse as never)},
      monument_inspire_id = coalesce(${monumentInspireId}, monument_inspire_id),
      updated_at = now()
    where id = ${id}`;
}
