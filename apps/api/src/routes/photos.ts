import { claimEcho, getEchoQueue, getPhotoDetail, getPhotoRow, photosInBbox, photosNearby, toEchoDto } from '@echoes/core';
import { EchoDto, ErrorResponse, MonumentsQuery, PhotoDetail, PhotosListResponse, PhotosNearbyQuery } from '@echoes/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

export const photoRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/photos/nearby',
    {
      schema: {
        tags: ['photos'],
        summary: 'Verified archival photos around a point, nearest first (with distance and bearing)',
        querystring: PhotosNearbyQuery,
        response: { 200: PhotosListResponse },
      },
    },
    async (req) => ({ items: await photosNearby(req.query.lat, req.query.lon, req.query.radius, req.query.limit) }),
  );

  app.get(
    '/photos',
    {
      schema: {
        tags: ['photos'],
        summary: 'Verified archival photos in a bounding box (map "echo" markers)',
        querystring: MonumentsQuery.pick({ bbox: true }),
        response: { 200: PhotosListResponse },
      },
    },
    async (req) => ({ items: await photosInBbox(req.query.bbox) }),
  );

  app.get(
    '/photos/:id',
    {
      schema: {
        tags: ['photos'],
        params: z.object({ id: z.uuid() }),
        response: { 200: PhotoDetail, 404: ErrorResponse },
      },
    },
    async (req, reply) => {
      const photo = await getPhotoDetail(req.params.id);
      if (!photo) return reply.code(404).send({ error: 'photo not found' });
      return photo;
    },
  );

  app.post(
    '/photos/:id/echo',
    {
      schema: {
        tags: ['echoes'],
        summary: 'Request the 360° echo for a photo (idempotent; queued on first call)',
        params: z.object({ id: z.uuid() }),
        response: { 200: EchoDto, 202: EchoDto, 404: ErrorResponse },
      },
    },
    async (req, reply) => {
      const photo = await getPhotoRow(req.params.id);
      if (!photo) return reply.code(404).send({ error: 'photo not found' });
      const { echo, enqueue } = await claimEcho(photo.id);
      if (enqueue) {
        // claimEcho enqueues at most once per echo (or once per retry after a failure).
        await getEchoQueue().add('echo', { echoId: echo.id, photoId: photo.id }, { jobId: `${echo.id}-${Date.now()}` });
      }
      return reply.code(echo.status === 'done' ? 200 : 202).send(toEchoDto(echo));
    },
  );
};
