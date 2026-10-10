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
 *   pnpm cli echo:pregen [--sync]              (all verified photos)
 *   pnpm cli echo:recompose --photo <uuid>     (re-run compositing from saved frames, no GenAI cost)
 *   pnpm cli smoke:gemini
 */
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  claimEcho,
  closeEchoQueue,
  editImage,
  env,
  ensureBucket,
  geocodeMonuments,
  geoparseCandidates,
  generateText,
  getEchoForPhoto,
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
    force: { type: 'boolean', default: false },
    sync: { type: 'boolean', default: false },
  },
});

const city = values.city ?? env.TARGET_CITIES[0]!;
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
  'echo:pregen': async () => {
    const rows = await sql<{ id: string }[]>`select id from archival_photos where status = 'verified' and location is not null`;
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
  log.error({ err }, `${name} failed`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
  await closeEchoQueue().catch(() => {});
}
