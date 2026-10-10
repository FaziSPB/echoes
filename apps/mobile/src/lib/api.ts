import {
  EchoDto,
  MonumentDetail,
  MonumentsResponse,
  PhotoDetail,
  PhotosListResponse,
  type PhotoAdminPatch,
} from '@echoes/shared';
import type { z } from 'zod';
import { ADMIN_TOKEN, API_URL } from './config';

export type BBox = [minLon: number, minLat: number, maxLon: number, maxLat: number];

async function request<S extends z.ZodType>(path: string, schema: S, init?: RequestInit): Promise<z.infer<S>> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  });
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} → ${res.status}`);
  // Validate at the boundary: a backend/contract drift fails loudly here, not deep in the UI.
  return schema.parse(await res.json());
}

const bboxParam = (b: BBox) => b.map((n) => n.toFixed(5)).join(',');

export const api = {
  monuments: (bbox: BBox, zoom: number) => request(`/v1/monuments?bbox=${bboxParam(bbox)}&zoom=${Math.round(zoom)}`, MonumentsResponse),
  monument: (inspireId: string) => request(`/v1/monuments/${encodeURIComponent(inspireId)}`, MonumentDetail),
  photosInBbox: (bbox: BBox) => request(`/v1/photos?bbox=${bboxParam(bbox)}`, PhotosListResponse),
  nearby: (lat: number, lon: number, radius = 25_000) => request(`/v1/photos/nearby?lat=${lat}&lon=${lon}&radius=${radius}&limit=100`, PhotosListResponse),
  photo: (id: string) => request(`/v1/photos/${id}`, PhotoDetail),
  requestEcho: (photoId: string) => request(`/v1/photos/${photoId}/echo`, EchoDto, { method: 'POST' }),
  echo: (id: string) => request(`/v1/echoes/${id}`, EchoDto),
  patchPhoto: (id: string, patch: PhotoAdminPatch) =>
    request(`/v1/admin/photos/${id}`, PhotoDetail, {
      method: 'PATCH',
      body: JSON.stringify(patch),
      headers: { 'x-admin-token': ADMIN_TOKEN },
    }),
};
