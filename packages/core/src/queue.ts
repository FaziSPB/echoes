import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from './env';

export const ECHO_QUEUE = 'echo-generation';
export const INGEST_QUEUE = 'ingest';

export type EchoJobData = { echoId: string; photoId: string };
export type IngestJobData = { step: string; args?: Record<string, unknown> };

export function redisConnection(): Redis {
  // BullMQ workers require maxRetriesPerRequest = null for blocking commands.
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
}

let echoQueue: Queue<EchoJobData> | undefined;
export function getEchoQueue(): Queue<EchoJobData> {
  echoQueue ??= new Queue<EchoJobData>(ECHO_QUEUE, {
    connection: redisConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    },
  });
  return echoQueue;
}

/** Close the queue only if this process opened it (CLI commands that never enqueue must still exit). */
export async function closeEchoQueue(): Promise<void> {
  if (!echoQueue) return;
  await echoQueue.close();
  echoQueue = undefined;
}
