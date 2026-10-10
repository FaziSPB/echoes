import { getObject } from '@echoes/core';
import type { FastifyPluginAsync } from 'fastify';

/**
 * Streams objects from S3 storage. In production this sits behind a CDN (keys are immutable,
 * versioned by pipeline); for the demo it means the phone only needs to reach one origin.
 */
export const mediaRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { '*': string } }>('/*', { schema: { hide: true } }, async (req, reply) => {
    const key = req.params['*'];
    if (!key || key.includes('..')) return reply.code(400).send({ error: 'bad key' });
    try {
      const obj = await getObject(key);
      reply.header('Content-Type', obj.contentType);
      reply.header('Cache-Control', 'public, max-age=31536000, immutable');
      if (obj.contentLength) reply.header('Content-Length', obj.contentLength);
      if (obj.etag) reply.header('ETag', obj.etag);
      return reply.send(obj.body);
    } catch {
      return reply.code(404).send({ error: 'not found' });
    }
  });
};
