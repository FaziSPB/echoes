import { getMonument, monumentsInBbox, photosForMonument } from '@echoes/core';
import { ErrorResponse, MonumentDetail, MonumentsQuery, MonumentsResponse } from '@echoes/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

export const monumentRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/monuments',
    {
      schema: {
        tags: ['monuments'],
        summary: 'Registered monuments in a bounding box (clustered below zoom 16)',
        querystring: MonumentsQuery,
        response: { 200: MonumentsResponse },
      },
    },
    async (req, reply) => {
      reply.header('Cache-Control', 'public, max-age=300');
      return { items: await monumentsInBbox(req.query.bbox, req.query.zoom) };
    },
  );

  app.get(
    '/monuments/:inspireId',
    {
      schema: {
        tags: ['monuments'],
        params: z.object({ inspireId: z.string() }),
        response: { 200: MonumentDetail, 404: ErrorResponse },
      },
    },
    async (req, reply) => {
      const monument = await getMonument(req.params.inspireId);
      if (!monument) return reply.code(404).send({ error: 'monument not found' });
      return { ...monument, photos: await photosForMonument(monument.inspireId) };
    },
  );
};
