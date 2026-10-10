import type { EchoDto, EchoStatus, Rect } from '@echoes/shared';
import { compact, sql } from '../db';
import { env } from '../env';
import { mediaUrl } from '../storage';

export type EchoRow = {
  id: string;
  photoId: string;
  pipelineVersion: number;
  status: EchoStatus;
  step: string | null;
  panoKey: string | null;
  previewKey: string | null;
  panoWidth: number | null;
  panoHeight: number | null;
  photoRect: Rect | null;
  skyColor: string | null;
  groundColor: string | null;
  narration: string | null;
  model: string | null;
  durationMs: number | null;
  error: string | null;
};

export function toEchoDto(e: EchoRow): EchoDto {
  return {
    id: e.id,
    photoId: e.photoId,
    status: e.status,
    step: e.step,
    panoUrl: mediaUrl(e.panoKey),
    previewUrl: mediaUrl(e.previewKey),
    panoWidth: e.panoWidth,
    panoHeight: e.panoHeight,
    photoRect: e.photoRect,
    hfovTotal: 360,
    skyColor: e.skyColor,
    groundColor: e.groundColor,
    narration: e.narration,
    error: e.error,
  };
}

export async function getEcho(id: string): Promise<EchoRow | null> {
  const [row] = await sql<EchoRow[]>`select * from echoes where id = ${id}`;
  return row ?? null;
}

export async function getEchoForPhoto(photoId: string, version = env.ECHO_PIPELINE_VERSION): Promise<EchoRow | null> {
  const [row] = await sql<EchoRow[]>`select * from echoes where photo_id = ${photoId} and pipeline_version = ${version}`;
  return row ?? null;
}

/**
 * What the app should show: the newest *finished* echo of any pipeline version (an older panorama beats none),
 * otherwise the current version's row (queued/running/failed).
 */
export async function getDisplayEcho(photoId: string, version = env.ECHO_PIPELINE_VERSION): Promise<EchoRow | null> {
  const [row] = await sql<EchoRow[]>`
    select * from echoes
    where photo_id = ${photoId} and (status = 'done' or pipeline_version = ${version})
    order by (status = 'done') desc, pipeline_version desc
    limit 1`;
  return row ?? null;
}

/**
 * Idempotent: one echo per (photo, pipeline version). Returns the row and whether the caller should enqueue work
 * (new row, or a previous failure being retried).
 */
export async function claimEcho(photoId: string, version = env.ECHO_PIPELINE_VERSION): Promise<{ echo: EchoRow; enqueue: boolean }> {
  const [inserted] = await sql<EchoRow[]>`
    insert into echoes (photo_id, pipeline_version, status, step)
    values (${photoId}, ${version}, 'queued', 'queued')
    on conflict (photo_id, pipeline_version) do nothing
    returning *`;
  if (inserted) return { echo: inserted, enqueue: true };

  const [retried] = await sql<EchoRow[]>`
    update echoes set status = 'queued', step = 'queued', error = null, updated_at = now()
    where photo_id = ${photoId} and pipeline_version = ${version} and status = 'failed'
    returning *`;
  if (retried) return { echo: retried, enqueue: true };

  const existing = await getEchoForPhoto(photoId, version);
  if (!existing) throw new Error('echo vanished during claim');
  return { echo: existing, enqueue: false };
}

export async function updateEcho(id: string, patch: Partial<Omit<EchoRow, 'id' | 'photoId' | 'pipelineVersion'>>): Promise<void> {
  const data = compact({ ...patch, photoRect: patch.photoRect ? sql.json(patch.photoRect) : undefined, updatedAt: new Date() });
  await sql`update echoes set ${sql(data)} where id = ${id}`;
}
