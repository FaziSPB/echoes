/**
 * Echoes operational CLI.
 *   pnpm cli migrate
 *   pnpm cli registry:sync [--force]
 *   pnpm cli registry:geocode [--city Wrocław] [--limit 100]
 *   pnpm cli photos:harvest-commons [--city Wrocław] [--max 300]
 *   pnpm cli photos:geoparse [--city Wrocław] [--limit 50]
 *   pnpm cli photos:link
 *   pnpm cli seed:curated [--city Wrocław]
 *   pnpm cli echo:generate --photo <uuid>      (enqueue; --sync to run inline)
 *   pnpm cli echo:pregen [--sync]              (PAID: verified photos without any finished panorama)
 *   pnpm cli echo:recompose --photo <uuid>     (re-run compositing from saved frames, no GenAI cost)
 *   pnpm cli queue:drain                       (drop waiting jobs, e.g. before a pipeline bump)
 *   pnpm cli walk:generate --photo <uuid> [--frames 3] [--length 10] [--subject-distance 28] [--from-frame 2]  (PAID: one image per regenerated frame)
 *   pnpm cli demo:export [--out file] [--with-debug]   (photos, panoramas, walks + media → tar.gz, no GenAI)
 *   pnpm cli demo:import [--file file]                 (restore that bundle on another machine)
 *   pnpm cli budget                            (paid image generations used today / daily limit)
 *   pnpm cli smoke:gemini
 */
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  claimEcho,
  closeBudget,
  closeEchoQueue,
  editImage,
  env,
  ensureBucket,
  exportDemo,
  GeminiBillingError,
  generateWalk,
  geocodeMonuments,
  geoparseCandidates,
  generateText,
  getEchoForPhoto,
  imageBudget,
  importDemo,
  getEchoQueue,
  harvestCommons,
  linkPhotosToMonuments,
  listModels,
  log,
  migrate,
  runEcho,
  seedCurated,
  sql,
  syncRegistry,
} from '@echoes/core';
import sharp from 'sharp';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    city: { type: 'string' },
    limit: { type: 'string' },
    max: { type: 'string' },
    photo: { type: 'string' },
    frames: { type: 'string' },
    length: { type: 'string' },
    'subject-distance': { type: 'string' },
    'from-frame': { type: 'string' },
    out: { type: 'string' },
    file: { type: 'string' },
    'with-debug': { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
    sync: { type: 'boolean', default: false },
  },
});

const city = values.city ?? env.TARGET_CITIES[0]!;
/** Default demo bundle location (git-ignored; share it as a GitHub Release asset). */
const DEMO_FILE = fileURLToPath(new URL('../../../data/demo/echoes-demo.tar.gz', import.meta.url));
const num = (v: string | undefined) => (v ? Number(v) : undefined);

async function generate(photoId: string) {
  const { echo, enqueue } = await claimEcho(photoId);
  if (values.sync) {
    await runEcho(echo.id);
  } else if (enqueue) {
    await getEchoQueue().add('echo', { echoId: echo.id, photoId }, { jobId: `${echo.id}-${Date.now()}` });
  }
  log.info({ photoId, echoId: echo.id, enqueued: enqueue && !values.sync }, 'echo requested');
}

const commands: Record<string, () => Promise<unknown>> = {
  migrate: () => migrate(),
  'registry:sync': () => syncRegistry({ force: values.force }),
  'registry:geocode': () => geocodeMonuments([city], { limit: num(values.limit) }),
  'photos:harvest-commons': () => harvestCommons(city, { max: num(values.max) }),
  'photos:geoparse': () => geoparseCandidates(city, { limit: num(values.limit) }),
  'photos:link': () => linkPhotosToMonuments(),
  'seed:curated': () =>
    seedCurated(fileURLToPath(new URL(`../../../data/curated/${city.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace('ł', 'l')}/echoes.json`, import.meta.url)), city),
  'echo:generate': async () => {
    if (!values.photo) throw new Error('--photo <uuid> required');
    await generate(values.photo);
  },
  'echo:recompose': async () => {
    if (!values.photo) throw new Error('--photo <uuid> required');
    const echo = await getEchoForPhoto(values.photo);
    if (!echo) throw new Error('no echo for this photo yet');
    await runEcho(echo.id, { recompose: true });
  },
  'walk:generate': async () => {
    // PAID: one image per frame (default 3). Offline on purpose – the API never triggers it.
    if (!values.photo) throw new Error('--photo <uuid> required');
    log.info({ budget: await imageBudget() }, 'budget before walk');
    const result = await generateWalk(values.photo, {
      frames: num(values.frames),
      lengthM: num(values.length),
      subjectDistanceM: num(values['subject-distance']),
      fromFrame: num(values['from-frame']),
    });
    log.info({ budget: await imageBudget() }, 'budget after walk');
    return result;
  },
  'demo:export': () => exportDemo(values.out ?? DEMO_FILE, { withDebug: values['with-debug'] }),
  'demo:import': () => importDemo(values.file ?? DEMO_FILE),
  'echo:pregen': async () => {
    // Paid: only photos without any finished panorama (an older pipeline version counts as done).
    const rows = await sql<{ id: string }[]>`
      select p.id from archival_photos p
      where p.status = 'verified' and p.location is not null
        and not exists (select 1 from echoes e where e.photo_id = p.id and e.status = 'done')`;
    log.info({ count: rows.length, budget: await imageBudget() }, 'photos without a panorama');
    for (const r of rows) await generate(r.id);
  },
  'smoke:gemini': async () => {
    const models = await listModels();
    log.info({ image: models.filter((m) => m.includes('image') || m.includes('banana')), text: models.filter((m) => m.includes('flash')).slice(0, 15) }, 'models');
    log.info({ text: await generateText('Odpowiedz jednym słowem: stolica Dolnego Śląska?') }, 'text ok');
    const canvas = await sharp({ create: { width: 1024, height: 256, channels: 3, background: { r: 128, g: 128, b: 128 } } })
      .composite([{ input: await sharp({ create: { width: 160, height: 120, channels: 3, background: { r: 60, g: 60, b: 60 } } }).png().toBuffer(), left: 432, top: 68 }])
      .png()
      .toBuffer();
    const out = await editImage({
      prompt: 'Fill the gray areas with a seamless black-and-white 1930s European town square panorama. No text.',
      images: [{ data: canvas, mime: 'image/png' }],
      aspectRatio: '4:1',
      imageSize: '1K',
    });
    const meta = await sharp(out).metadata();
    await sharp(out).toFile('/tmp/echoes-smoke.png').catch(() => {});
    log.info({ width: meta.width, height: meta.height }, 'image ok (4:1)');
  },
  bucket: () => ensureBucket(),
  budget: () => imageBudget(),
  'queue:drain': async () => {
    // Removes waiting/delayed jobs (active ones finish); their echoes stay "queued" and can be re-requested.
    const q = getEchoQueue();
    const counts = await q.getJobCounts('waiting', 'delayed', 'active');
    await q.drain(true);
    await sql`update echoes set status = 'failed', error = 'cancelled (queue drained)' where status = 'queued'`;
    return counts;
  },
};

const name = positionals[0];
const cmd = name ? commands[name] : undefined;
if (!cmd) {
  console.error(`Unknown command "${name ?? ''}". Available: ${Object.keys(commands).join(', ')}`);
  process.exit(1);
}
try {
  const result = await cmd();
  if (result !== undefined) log.info({ result }, `${name} done`);
} catch (err) {
  if (err instanceof GeminiBillingError) log.error({ status: (err.cause as { status?: number }).status }, `${name} failed: ${err.message}`);
  else log.error({ err }, `${name} failed`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
  await closeEchoQueue().catch(() => {});
  await closeBudget().catch(() => {});
}
