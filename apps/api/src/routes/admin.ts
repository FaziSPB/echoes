import { env, getPhotoDetail, patchPhoto } from '@echoes/core';
import { ErrorResponse, PhotoAdminPatch, PhotoDetail } from '@echoes/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

/** Curation endpoints used by the in-app calibration mode ("save heading"). */
export const adminRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', async (req, reply) => {
    if (req.headers['x-admin-token'] !== env.ADMIN_TOKEN) return reply.code(401).send({ error: 'unauthorized' });
  });

  app.patch(
    '/photos/:id',
    {
      schema: {
        tags: ['admin'],
        params: z.object({ id: z.uuid() }),
        body: PhotoAdminPatch,
        response: { 200: PhotoDetail, 404: ErrorResponse },
      },
    },
    async (req, reply) => {
      const ok = await patchPhoto(req.params.id, req.body);
      if (!ok) return reply.code(404).send({ error: 'photo not found' });
      return (await getPhotoDetail(req.params.id))!;
    },
  );
};
