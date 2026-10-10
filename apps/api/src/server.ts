import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { env, log, migrate, sql } from '@echoes/core';
import Fastify from 'fastify';
import { jsonSchemaTransform, serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { adminRoutes } from './routes/admin';
import { echoRoutes } from './routes/echoes';
import { mediaRoutes } from './routes/media';
import { monumentRoutes } from './routes/monuments';
import { photoRoutes } from './routes/photos';

export async function buildServer() {
  const app = Fastify({ loggerInstance: log }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cors, { origin: true });
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Echoes API',
        description: 'Archival photos (NAC) pinned to the NID monuments register (dane.gov.pl), extended to 360° with GenAI.',
        version: '0.1.0',
      },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  app.get('/health', { schema: { hide: true } }, async () => {
    await sql`select 1`;
    return { ok: true };
  });

  await app.register(monumentRoutes, { prefix: '/v1' });
  await app.register(photoRoutes, { prefix: '/v1' });
  await app.register(echoRoutes, { prefix: '/v1' });
  await app.register(adminRoutes, { prefix: '/v1/admin' });
  await app.register(mediaRoutes, { prefix: '/media' });
  return app;
}

await migrate();
const app = await buildServer();
await app.listen({ port: env.PORT, host: '0.0.0.0' });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    await sql.end({ timeout: 5 });
    process.exit(0);
  });
}
