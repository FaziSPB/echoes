import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import { fetchWithRetry } from '../clients/http';
import { log } from '../log';
import { nearestMonument } from '../repos/monuments';
import { upsertPhoto } from '../repos/photos';
import { ensureBucket, putObject } from '../storage';

export const CuratedPhoto = z
  .object({
    source: z.enum(['nac_curated', 'commons_nac', 'commons']).default('nac_curated'),
    /** NAC signature (sygnatura) or Commons file title. */
    sourceRef: z.string(),
    file: z.string().optional(),
    remoteUrl: z.string().url().optional(),
    title: z.string(),
    description: z.string().nullable().default(null),
    dateText: z.string().nullable().default(null),
    yearFrom: z.number().int().nullable().default(null),
    yearTo: z.number().int().nullable().default(null),
    author: z.string().nullable().default(null),
    license: z.string().nullable().default(null),
    attribution: z.string(),
    originalUrl: z.string().nullable().default(null),
    lat: z.number(),
    lon: z.number(),
    headingDeg: z.number().min(0).max(360),
    hfovDeg: z.number().min(10).max(150).default(55),
    pitchDeg: z.number().default(0),
    monumentInspireId: z.string().nullable().default(null),
  })
  .refine((p) => p.file || p.remoteUrl, 'either file or remoteUrl is required');
export type CuratedPhoto = z.infer<typeof CuratedPhoto>;

const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 80);

async function loadImage(p: CuratedPhoto, baseDir: string): Promise<Buffer> {
  if (p.file) return readFile(resolve(baseDir, p.file));
  const res = await fetchWithRetry(p.remoteUrl!);
  if (!res.ok) throw new Error(`download ${p.remoteUrl} → ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Seeds hand-curated, verified photos (with location + heading) from data/curated/<city>/echoes.json. */
export async function seedCurated(jsonPath: string, city: string) {
  await ensureBucket();
  const baseDir = dirname(jsonPath);
  const items = z.array(CuratedPhoto).parse(JSON.parse(await readFile(jsonPath, 'utf8')));
  for (const p of items) {
    const raw = await loadImage(p, baseDir);
    // Normalise orientation/size once; the original stays in the archive, we keep a 2400 px working copy.
    const image = await sharp(raw).rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
    const thumb = await sharp(image).resize({ width: 480 }).jpeg({ quality: 78 }).toBuffer();
    const meta = await sharp(image).metadata();
    const key = `photos/${slug(p.sourceRef)}`;
    await putObject(`${key}/image.jpg`, image, 'image/jpeg');
    await putObject(`${key}/thumb.jpg`, thumb, 'image/jpeg');

    const monumentInspireId = p.monumentInspireId ?? (await nearestMonument(p.lat, p.lon, 120))?.inspireId ?? null;
    const id = await upsertPhoto({
      source: p.source,
      sourceRef: p.sourceRef,
      title: p.title,
      description: p.description,
      dateText: p.dateText,
      yearFrom: p.yearFrom,
      yearTo: p.yearTo,
      author: p.author,
      license: p.license,
      attribution: p.attribution,
      originalUrl: p.originalUrl,
      remoteImageUrl: p.remoteUrl ?? null,
      imageKey: `${key}/image.jpg`,
      thumbKey: `${key}/thumb.jpg`,
      width: meta.width ?? null,
      height: meta.height ?? null,
      city,
      lat: p.lat,
      lon: p.lon,
      headingDeg: p.headingDeg,
      hfovDeg: p.hfovDeg,
      pitchDeg: p.pitchDeg,
      geoConfidence: 1,
      status: 'verified',
      monumentInspireId,
    });
    log.info({ id, sourceRef: p.sourceRef, monumentInspireId }, 'curated photo seeded');
  }
  return { seeded: items.length };
}
