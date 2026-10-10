import { UnrecoverableError, Worker } from 'bullmq';
import { BudgetExceededError, closeBudget, ECHO_QUEUE, ensureBucket, log, migrate, redisConnection, runEcho, sql, type EchoJobData } from '@echoes/core';

await migrate();
await ensureBucket();

/**
 * GenAI work is slow (tens of seconds) and rate-limited, so it runs here, off the request path.
 * Concurrency × replicas and the limiter cap our Gemini RPM; scale by adding worker replicas.
 */
const echoWorker = new Worker<EchoJobData>(
  ECHO_QUEUE,
  async (job) => {
    log.info({ jobId: job.id, ...job.data, attempt: job.attemptsMade + 1 }, 'echo job started');
    try {
      await runEcho(job.data.echoId);
    } catch (err) {
      // Retrying cannot help when today's budget is spent – fail the job for good.
      if (err instanceof BudgetExceededError) throw new UnrecoverableError(err.message);
      throw err;
    }
  },
  {
    connection: redisConnection(),
    concurrency: Number(process.env.ECHO_CONCURRENCY ?? 2),
    limiter: { max: Number(process.env.ECHO_MAX_PER_MINUTE ?? 10), duration: 60_000 },
    lockDuration: 180_000,
  },
);

echoWorker.on('failed', (job, err) => log.error({ jobId: job?.id, err: err.message }, 'echo job failed'));
echoWorker.on('completed', (job) => log.info({ jobId: job.id }, 'echo job completed'));
log.info('worker ready');

async function shutdown() {
  await echoWorker.close();
  await closeBudget();
  await sql.end({ timeout: 5 });
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
