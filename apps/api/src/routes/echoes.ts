import { getEcho, toEchoDto } from '@echoes/core';
import { EchoDto, ErrorResponse } from '@echoes/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

export const echoRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/echoes/:id',
    {
      schema: {
        tags: ['echoes'],
        summary: 'Echo generation status / result (poll while status is queued|running)',
        params: z.object({ id: z.uuid() }),
        response: { 200: EchoDto, 404: ErrorResponse },
      },
    },
    async (req, reply) => {
      const echo = await getEcho(req.params.id);
      if (!echo) return reply.code(404).send({ error: 'echo not found' });
      if (echo.status === 'done') reply.header('Cache-Control', 'public, max-age=3600');
      return toEchoDto(echo);
    },
  );
};
