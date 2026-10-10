import { Redis } from 'ioredis';
import { env } from './env';

/** Thrown when today's paid image-generation allowance is used up. Never worth retrying. */
export class BudgetExceededError extends Error {
  constructor(
    readonly used: number,
    readonly limit: number,
  ) {
    super(`Dzienny limit generacji obrazów wyczerpany (${used}/${limit}). Zwiększ ECHO_DAILY_IMAGE_LIMIT albo spróbuj jutro.`);
    this.name = 'BudgetExceededError';
  }
}

let redis: Redis | undefined;
const client = () => (redis ??= new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 }));

/** One counter per calendar day in Warsaw, shared by every worker/CLI process. */
const dayKey = () => `echoes:genai:images:${new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Warsaw' })}`;

/**
 * Atomically reserves one paid image generation for today, before the request is sent.
 * Attempts are counted even if the request then fails – we would rather under-spend than overshoot.
 */
export async function reserveImageGeneration(): Promise<void> {
  const key = dayKey();
  const used = await client().incr(key);
  if (used === 1) await client().expire(key, 3 * 24 * 3600);
  if (used > env.ECHO_DAILY_IMAGE_LIMIT) {
    await client().decr(key);
    throw new BudgetExceededError(used - 1, env.ECHO_DAILY_IMAGE_LIMIT);
  }
}

export async function imageBudget(): Promise<{ used: number; limit: number; remaining: number }> {
  const used = Number((await client().get(dayKey())) ?? 0);
  return { used, limit: env.ECHO_DAILY_IMAGE_LIMIT, remaining: Math.max(0, env.ECHO_DAILY_IMAGE_LIMIT - used) };
}

export async function closeBudget(): Promise<void> {
  await redis?.quit();
  redis = undefined;
}
