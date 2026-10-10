import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// .env lives at the monorepo root; real env vars (docker, CI) take precedence.
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });

const Env = z.object({
  DATABASE_URL: z.string().default('postgres://echoes:echoes@localhost:5432/echoes'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  S3_ENDPOINT: z.string().default('http://localhost:9000'),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string().default('echoes'),
  S3_SECRET_KEY: z.string().default('echoes-secret'),
  S3_BUCKET: z.string().default('echoes'),
  PORT: z.coerce.number().default(3000),
  /** CDN/origin for media URLs; empty = relative `/media/...` paths resolved by the client against its API URL. */
  PUBLIC_MEDIA_URL: z.string().default(''),
  ADMIN_TOKEN: z.string().default('change-me'),
  GEMINI_API_KEY: z.string().default(''),
  GEMINI_IMAGE_MODEL: z.string().default('gemini-nano-banana-2.1'),
  GEMINI_TEXT_MODEL: z.string().default('gemini-flash-latest'),
  ECHO_PIPELINE_VERSION: z.coerce.number().int().default(1),
  /** Output size of the paid 4:1 generations (context pass is always 2K). 2K is plenty for a phone. */
  ECHO_IMAGE_SIZE: z.enum(['1K', '2K', '4K']).default('2K'),
  /** Extra generation that heals the 360° wrap seam (behind the viewer). Off = cheaper, visible seam at 180°. */
  ECHO_SEAM_PASS: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  /** Hard cap on paid image generations per day (Europe/Warsaw), across all workers and CLI runs. */
  ECHO_DAILY_IMAGE_LIMIT: z.coerce.number().int().min(0).default(10),
  TARGET_CITIES: z
    .string()
    .default('Wrocław')
    .transform((s) => s.split(',').map((c) => c.trim()).filter(Boolean)),
  LOG_LEVEL: z.string().default('info'),
});

export const env = Env.parse(process.env);
export type Env = typeof env;
