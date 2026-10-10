import { z } from 'zod';

export const PhotoStatus = z.enum(['candidate', 'verified', 'rejected']);
export type PhotoStatus = z.infer<typeof PhotoStatus>;

export const PhotoSource = z.enum(['nac_curated', 'commons_nac', 'commons']);
export type PhotoSource = z.infer<typeof PhotoSource>;

export const EchoStatus = z.enum(['queued', 'running', 'done', 'failed']);
export type EchoStatus = z.infer<typeof EchoStatus>;

export const EchoStep = z.enum(['queued', 'prepare', 'outpaint', 'seam', 'compose', 'narration', 'upload', 'done']);
export type EchoStep = z.infer<typeof EchoStep>;

export const LatLon = z.object({ lat: z.number(), lon: z.number() });

/* ---------- monuments ---------- */

export const MonumentPoint = z.object({
  kind: z.literal('monument'),
  inspireId: z.string(),
  name: z.string(),
  function: z.string().nullable(),
  chronology: z.string().nullable(),
  lat: z.number(),
  lon: z.number(),
  echoCount: z.number().int(),
});
export type MonumentPoint = z.infer<typeof MonumentPoint>;

export const MonumentCluster = z.object({
  kind: z.literal('cluster'),
  lat: z.number(),
  lon: z.number(),
  count: z.number().int(),
});
export type MonumentCluster = z.infer<typeof MonumentCluster>;

export const MonumentMapItem = z.discriminatedUnion('kind', [MonumentPoint, MonumentCluster]);
export type MonumentMapItem = z.infer<typeof MonumentMapItem>;

export const MonumentsQuery = z.object({
  /** minLon,minLat,maxLon,maxLat */
  bbox: z
    .string()
    .transform((s) => s.split(',').map(Number))
    .pipe(z.tuple([z.number(), z.number(), z.number(), z.number()])),
  zoom: z.coerce.number().min(0).max(22).default(15),
});

export const MonumentsResponse = z.object({ items: z.array(MonumentMapItem) });

export const MonumentBrief = z.object({
  inspireId: z.string(),
  name: z.string(),
  chronology: z.string().nullable(),
  function: z.string().nullable(),
  street: z.string().nullable(),
  houseNumber: z.string().nullable(),
  city: z.string().nullable(),
  entryDate: z.string().nullable(),
  registryDocs: z.string().nullable(),
  zabytekUrl: z.string().nullable(),
  lat: z.number().nullable(),
  lon: z.number().nullable(),
});
export type MonumentBrief = z.infer<typeof MonumentBrief>;

/* ---------- echoes ---------- */

export const Rect = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
export type Rect = z.infer<typeof Rect>;

export const EchoDto = z.object({
  id: z.string(),
  photoId: z.string(),
  status: EchoStatus,
  step: z.string().nullable(),
  panoUrl: z.string().nullable(),
  previewUrl: z.string().nullable(),
  panoWidth: z.number().nullable(),
  panoHeight: z.number().nullable(),
  /** Where the untouched archival pixels sit inside the panorama (pixels). */
  photoRect: Rect.nullable(),
  /** Horizontal angle covered by the panorama strip (always 360 for v1). */
  hfovTotal: z.number(),
  skyColor: z.string().nullable(),
  groundColor: z.string().nullable(),
  narration: z.string().nullable(),
  error: z.string().nullable(),
});
export type EchoDto = z.infer<typeof EchoDto>;

/* ---------- photos ---------- */

export const PhotoSummary = z.object({
  id: z.string(),
  title: z.string(),
  yearLabel: z.string().nullable(),
  yearFrom: z.number().nullable(),
  thumbUrl: z.string().nullable(),
  lat: z.number(),
  lon: z.number(),
  headingDeg: z.number().nullable(),
  source: PhotoSource,
  sourceRef: z.string(),
  attribution: z.string().nullable(),
  monumentInspireId: z.string().nullable(),
  monumentName: z.string().nullable(),
  echoStatus: EchoStatus.nullable(),
  distanceM: z.number().optional(),
  bearingDeg: z.number().optional(),
});
export type PhotoSummary = z.infer<typeof PhotoSummary>;

export const PhotoDetail = PhotoSummary.extend({
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  hfovDeg: z.number(),
  pitchDeg: z.number(),
  license: z.string().nullable(),
  author: z.string().nullable(),
  originalUrl: z.string().nullable(),
  status: PhotoStatus,
  monument: MonumentBrief.nullable(),
  echo: EchoDto.nullable(),
});
export type PhotoDetail = z.infer<typeof PhotoDetail>;

export const MonumentDetail = MonumentBrief.extend({
  photos: z.array(PhotoSummary),
});
export type MonumentDetail = z.infer<typeof MonumentDetail>;

export const PhotosNearbyQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().min(10).max(50_000).default(3000),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const PhotosListResponse = z.object({ items: z.array(PhotoSummary) });

export const PhotoAdminPatch = z
  .object({
    headingDeg: z.number().min(0).max(360),
    hfovDeg: z.number().min(10).max(150),
    pitchDeg: z.number().min(-60).max(60),
    lat: z.number(),
    lon: z.number(),
    status: PhotoStatus,
    monumentInspireId: z.string().nullable(),
  })
  .partial();
export type PhotoAdminPatch = z.infer<typeof PhotoAdminPatch>;

export const ErrorResponse = z.object({ error: z.string() });
