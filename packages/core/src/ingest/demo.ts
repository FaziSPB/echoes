import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { promisify } from 'node:util';
import { migrate, sql } from '../db';
import { log } from '../log';
import type { WalkFrameRow } from '../repos/walks';
import { ensureBucket, getObjectBuffer, listKeys, putObject } from '../storage';

const run = promisify(execFile);
const FORMAT_VERSION = 1;

/**
 * Demo bundle = the expensive, non-reproducible part of a deployment: verified photos with their camera poses,
 * finished panoramas (with narration) and walks, plus every S3 object they reference. Everything else (the NID
 * register, geocoding) is free to rebuild with the ingest commands. No Gemini calls are needed to import it.
 */
type DemoData = {
  formatVersion: number;
  exportedAt: string;
  monuments: Array<Record<string, unknown> & { inspireId: string; lat: number | null; lon: number | null }>;
  photos: Array<Record<string, unknown> & { id: string; source: string; sourceRef: string; lat: number | null; lon: number | null }>;
  echoes: Array<Record<string, unknown> & { photoId: string; pipelineVersion: number }>;
  walks: Array<Record<string, unknown> & { photoId: string; frames: WalkFrameRow[] }>;
  objects: string[];
};

const contentType = (key: string) => (key.endsWith('.png') ? 'image/png' : key.endsWith('.json') ? 'application/json' : 'image/jpeg');

async function filesUnder(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await filesUnder(p)));
    else out.push(p);
  }
  return out;
}

export async function exportDemo(outFile: string, opts: { withDebug?: boolean } = {}) {
  const photos = await sql<DemoData['photos']>`
    select p.id, p.source, p.source_ref, p.title, p.description, p.date_text, p.year_from, p.year_to, p.author, p.license,
           p.attribution, p.original_url, p.remote_image_url, p.image_key, p.thumb_key, p.width, p.height, p.city,
           p.heading_deg, p.hfov_deg, p.pitch_deg, p.geo_confidence, p.status, p.monument_inspire_id,
           st_y(p.location) as lat, st_x(p.location) as lon
    from archival_photos p where p.status = 'verified'`;
  const photoIds = photos.map((p) => p.id);
  const echoes = await sql<DemoData['echoes']>`
    select photo_id, pipeline_version, status, step, pano_key, preview_key, pano_width, pano_height, photo_rect,
           sky_color, ground_color, narration, model, duration_ms, error
    from echoes where status = 'done' and photo_id in ${sql(photoIds)}`;
  const walks = await sql<DemoData['walks']>`
    select photo_id, status, length_m, subject_distance_m, frames, model, error
    from walks where status = 'done' and photo_id in ${sql(photoIds)}`;
  const monumentIds = [...new Set(photos.map((p) => p.monumentInspireId as string | null).filter((x): x is string => !!x))];
  const monuments = monumentIds.length
    ? await sql<DemoData['monuments']>`
        select inspire_id, name, protection_form, location_precision, chronology, function, registry_docs, entry_date,
               voivodeship, county, commune, city, street, house_number, zabytek_url, geocode_source, geocode_accuracy,
               st_y(location) as lat, st_x(location) as lon
        from monuments where inspire_id in ${sql(monumentIds)}`
    : [];

  const keys = new Set<string>();
  for (const p of photos) for (const k of [p.imageKey, p.thumbKey]) if (typeof k === 'string') keys.add(k);
  for (const e of echoes) for (const k of [e.panoKey, e.previewKey]) if (typeof k === 'string') keys.add(k);
  for (const w of walks) for (const f of w.frames) keys.add(f.imageKey);
  if (opts.withDebug) {
    // Intermediate frames make `echo:recompose` possible on the target machine (still no generation needed).
    for (const e of echoes) for (const k of await listKeys(`echoes/${e.photoId}/v${e.pipelineVersion}/debug/`)) keys.add(k);
    for (const w of walks) for (const k of await listKeys(`walks/${w.photoId}/debug/`)) keys.add(k);
  }

  const work = await mkdtemp(join(tmpdir(), 'echoes-demo-'));
  try {
    for (const key of keys) {
      const file = join(work, 'objects', key);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, await getObjectBuffer(key));
    }
    const data: DemoData = { formatVersion: FORMAT_VERSION, exportedAt: new Date().toISOString(), monuments, photos, echoes, walks, objects: [...keys] };
    await writeFile(join(work, 'data.json'), JSON.stringify(data, null, 1));
    await mkdir(dirname(outFile), { recursive: true });
    await run('tar', ['-czf', outFile, '-C', work, '.']);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  const size = (await stat(outFile)).size;
  const summary = { file: outFile, sizeMB: Number((size / 1e6).toFixed(1)), photos: photos.length, echoes: echoes.length, walks: walks.length, monuments: monuments.length, objects: keys.size };
  log.info(summary, 'demo exported');
  return summary;
}

export async function importDemo(file: string) {
  await migrate();
  await ensureBucket();
  const work = await mkdtemp(join(tmpdir(), 'echoes-demo-'));
  try {
    await run('tar', ['-xzf', file, '-C', work]);
    const data = JSON.parse(await readFile(join(work, 'data.json'), 'utf8')) as DemoData;
    if (data.formatVersion !== FORMAT_VERSION) throw new Error(`unsupported demo format ${data.formatVersion}`);

    // Objects first: rows must never point at missing media.
    const objectsDir = join(work, 'objects');
    const files = await filesUnder(objectsDir).catch(() => [] as string[]);
    for (const f of files) {
      const key = relative(objectsDir, f).split('\\').join('/');
      await putObject(key, await readFile(f), contentType(key));
    }

    await sql.begin(async (tx) => {
      for (const m of data.monuments) {
        // The live register stays the source of truth; we only fill in rows/coordinates that are missing.
        await tx`
          insert into monuments (inspire_id, name, protection_form, location_precision, chronology, function, registry_docs,
                                 entry_date, voivodeship, county, commune, city, street, house_number, zabytek_url,
                                 geocode_source, geocode_accuracy, location)
          values (${m.inspireId}, ${m.name as string}, ${m.protectionForm as string | null}, ${m.locationPrecision as string | null},
                  ${m.chronology as string | null}, ${m.function as string | null}, ${m.registryDocs as string | null},
                  ${m.entryDate as string | null}, ${m.voivodeship as string | null}, ${m.county as string | null},
                  ${m.commune as string | null}, ${m.city as string | null}, ${m.street as string | null},
                  ${m.houseNumber as string | null}, ${m.zabytekUrl as string | null}, ${m.geocodeSource as string | null},
                  ${m.geocodeAccuracy as number | null},
                  ${m.lat !== null && m.lon !== null ? tx`st_setsrid(st_makepoint(${m.lon}, ${m.lat}), 4326)` : null})
          on conflict (inspire_id) do update set
            location = coalesce(monuments.location, excluded.location),
            geocode_source = coalesce(monuments.geocode_source, excluded.geocode_source)`;
      }

      // Photos are matched by (source, source_ref): a target that already ran seed:curated has its own UUIDs.
      const idMap = new Map<string, string>();
      for (const p of data.photos) {
        const location = p.lat !== null && p.lon !== null ? tx`st_setsrid(st_makepoint(${p.lon}, ${p.lat}), 4326)` : null;
        const [row] = await tx<{ id: string }[]>`
          insert into archival_photos (id, source, source_ref, title, description, date_text, year_from, year_to, author,
                                       license, attribution, original_url, remote_image_url, image_key, thumb_key, width,
                                       height, city, heading_deg, hfov_deg, pitch_deg, geo_confidence, status,
                                       monument_inspire_id, location)
          values (${p.id}, ${p.source}, ${p.sourceRef}, ${p.title as string}, ${p.description as string | null},
                  ${p.dateText as string | null}, ${p.yearFrom as number | null}, ${p.yearTo as number | null},
                  ${p.author as string | null}, ${p.license as string | null}, ${p.attribution as string | null},
                  ${p.originalUrl as string | null}, ${p.remoteImageUrl as string | null}, ${p.imageKey as string | null},
                  ${p.thumbKey as string | null}, ${p.width as number | null}, ${p.height as number | null},
                  ${p.city as string | null}, ${p.headingDeg as number | null}, ${p.hfovDeg as number},
                  ${p.pitchDeg as number}, ${p.geoConfidence as number | null}, ${p.status as string},
                  ${p.monumentInspireId as string | null}, ${location})
          on conflict (source, source_ref) do update set
            title = excluded.title, description = excluded.description, attribution = excluded.attribution,
            image_key = excluded.image_key, thumb_key = excluded.thumb_key, width = excluded.width, height = excluded.height,
            heading_deg = excluded.heading_deg, hfov_deg = excluded.hfov_deg, pitch_deg = excluded.pitch_deg,
            status = excluded.status, monument_inspire_id = excluded.monument_inspire_id,
            location = excluded.location, updated_at = now()
          returning id`;
        idMap.set(p.id, row!.id);
      }

      for (const e of data.echoes) {
        const photoId = idMap.get(e.photoId);
        if (!photoId) continue;
        await tx`
          insert into echoes (photo_id, pipeline_version, status, step, pano_key, preview_key, pano_width, pano_height,
                              photo_rect, sky_color, ground_color, narration, model, duration_ms, error)
          values (${photoId}, ${e.pipelineVersion}, ${e.status as string}, ${e.step as string | null}, ${e.panoKey as string},
                  ${e.previewKey as string | null}, ${e.panoWidth as number | null}, ${e.panoHeight as number | null},
                  ${e.photoRect ? tx.json(e.photoRect as never) : null}, ${e.skyColor as string | null},
                  ${e.groundColor as string | null}, ${e.narration as string | null}, ${e.model as string | null},
                  ${e.durationMs as number | null}, ${e.error as string | null})
          on conflict (photo_id, pipeline_version) do update set
            status = excluded.status, step = excluded.step, pano_key = excluded.pano_key, preview_key = excluded.preview_key,
            pano_width = excluded.pano_width, pano_height = excluded.pano_height, photo_rect = excluded.photo_rect,
            sky_color = excluded.sky_color, ground_color = excluded.ground_color, narration = excluded.narration,
            model = excluded.model, duration_ms = excluded.duration_ms, error = excluded.error, updated_at = now()`;
      }

      for (const w of data.walks) {
        const photoId = idMap.get(w.photoId);
        if (!photoId) continue;
        await tx`
          insert into walks (photo_id, status, length_m, subject_distance_m, frames, model, error)
          values (${photoId}, ${w.status as string}, ${w.lengthM as number}, ${w.subjectDistanceM as number},
                  ${tx.json(w.frames as never)}, ${w.model as string | null}, ${w.error as string | null})
          on conflict (photo_id) do update set
            status = excluded.status, length_m = excluded.length_m, subject_distance_m = excluded.subject_distance_m,
            frames = excluded.frames, model = excluded.model, error = excluded.error, updated_at = now()`;
      }
    });

    const summary = { photos: data.photos.length, echoes: data.echoes.length, walks: data.walks.length, monuments: data.monuments.length, objects: files.length, exportedAt: data.exportedAt };
    log.info(summary, 'demo imported');
    return summary;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
