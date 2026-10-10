import sharp from 'sharp';
import { editImage, generateText, type ImageSize } from '../clients/gemini';
import { fetchWithRetry } from '../clients/http';
import { env } from '../env';
import { log } from '../log';
import { getEcho, updateEcho } from '../repos/echoes';
import { getMonument } from '../repos/monuments';
import { getPhotoRow, type PhotoRow } from '../repos/photos';
import { getObjectBuffer, putObject } from '../storage';
import { buildCanvas, edgeColors, grayBand, matchTone, mergeBand, normalizeToStrip, repastePhoto, rollX, toJpeg } from './compose';
import { contextLayout, contextRectInStrip, mapRectInto, type StripSpec } from './geometry';
import { contextPrompt, narrationPrompt, outpaintPrompt, seamPrompt } from './prompts';

/** 4:1 cylinder → 360° horizontally, 90° vertically. 4096 px is the safe max texture width on phones. */
export const STRIP: StripSpec = { width: 4096, height: 1024 };
const IMAGE_SIZE: ImageSize = (process.env.ECHO_IMAGE_SIZE as ImageSize | undefined) ?? '4K';
const SEAM_PASS = process.env.ECHO_SEAM_PASS !== 'false';

export async function loadPhotoImage(photo: PhotoRow): Promise<Buffer> {
  if (photo.imageKey) return getObjectBuffer(photo.imageKey);
  if (!photo.remoteImageUrl) throw new Error(`photo ${photo.id} has no image`);
  const res = await fetchWithRetry(photo.remoteImageUrl);
  if (!res.ok) throw new Error(`download ${photo.remoteImageUrl} → ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export type EchoArtifacts = {
  pano: Buffer;
  photoRect: { x: number; y: number; w: number; h: number };
  sky: string;
  ground: string;
};

/** Context canvas for progressive outpainting (21:9). */
const CONTEXT: StripSpec = { width: 2100, height: 900 };

/**
 * Pure image part of the pipeline (no DB).
 * v2 = progressive outpainting: photo → ~2× wider context (21:9) → 360° strip (4:1) → seam heal → tone + repaste.
 * Giving the model a seed that already fills a third of the strip keeps the scene at the photo's scale
 * (v1 seeded the strip with the bare photo and the model tended to "zoom in" and redraw it bigger).
 */
export async function generatePanorama(
  photo: PhotoRow,
  image: Buffer,
  prompts: { context: string; outpaint: string; seam: string },
  onStep: (step: 'outpaint' | 'seam' | 'compose') => Promise<void> = async () => {},
  debug: (name: string, img: Buffer) => Promise<void> = async () => {},
  /** Previously generated frames (from debug/) – lets us iterate on compositing without paying for generation. */
  reuse: { context?: Buffer; outpaint?: Buffer; seam?: Buffer } = {},
): Promise<EchoArtifacts> {
  const meta = await sharp(image).metadata();
  const geometry = { width: meta.width!, height: meta.height!, hfovDeg: photo.hfovDeg, pitchDeg: photo.pitchDeg };

  await onStep('outpaint');
  // Step 1 – context.
  const ctx = contextLayout(CONTEXT, geometry);
  const contextCanvas = await buildCanvas(image, CONTEXT, ctx.rect);
  await debug('canvas-context', contextCanvas);
  const contextImg = await normalizeToStrip(
    reuse.context ??
      (await editImage({ prompt: prompts.context, images: [{ data: contextCanvas, mime: 'image/png' }], aspectRatio: '21:9', imageSize: '2K' })),
    CONTEXT,
  );
  if (!reuse.context) await debug('context', contextImg);

  // Step 2 – full 360° strip seeded with the context at its true angular size.
  const ctxInStrip = contextRectInStrip(STRIP, CONTEXT, ctx.coverageDeg);
  const rect = mapRectInto(ctx.rect, CONTEXT, ctxInStrip);
  const stripCanvas = await buildCanvas(contextImg, STRIP, ctxInStrip);
  await debug('canvas', stripCanvas);
  const generated =
    reuse.outpaint ??
    (await editImage({ prompt: prompts.outpaint, images: [{ data: stripCanvas, mime: 'image/png' }], aspectRatio: '4:1', imageSize: IMAGE_SIZE }));
  let pano = await normalizeToStrip(generated, STRIP);
  if (!reuse.outpaint) await debug('outpaint', pano);

  if (SEAM_PASS || reuse.seam) {
    // The wrap seam sits at x=0; roll it to the centre, gray it out and let the model heal it.
    await onStep('seam');
    const band = Math.round(STRIP.width / 10);
    const rolled = await rollX(pano, STRIP.width / 2);
    const healed = await normalizeToStrip(
      reuse.seam ??
        (await editImage({
          prompt: prompts.seam,
          images: [{ data: await grayBand(rolled, band), mime: 'image/png' }],
          aspectRatio: '4:1',
          imageSize: IMAGE_SIZE,
        })),
      STRIP,
    );
    if (!reuse.seam) await debug('seam', healed);
    pano = await rollX(await mergeBand(rolled, healed, band), -STRIP.width / 2);
  }

  await onStep('compose');
  pano = await matchTone(pano, image);
  pano = await repastePhoto(pano, image, rect, Math.round(rect.w * 0.06));
  const { sky, ground } = await edgeColors(pano);
  return { pano, photoRect: rect, sky, ground };
}

/** Worker entry point: runs one echo end-to-end and persists every step for the app's progress UI. */
export async function runEcho(echoId: string, opts: { recompose?: boolean } = {}): Promise<void> {
  const started = Date.now();
  const echo = await getEcho(echoId);
  if (!echo) throw new Error(`echo ${echoId} not found`);
  if (echo.status === 'done' && !opts.recompose) return;

  const photo = await getPhotoRow(echo.photoId);
  if (!photo) throw new Error(`photo ${echo.photoId} not found`);
  const monument = photo.monumentInspireId ? await getMonument(photo.monumentInspireId) : null;

  try {
    await updateEcho(echoId, { status: 'running', step: 'prepare', error: null });
    const image = await loadPhotoImage(photo);

    const base = `echoes/${photo.id}/v${echo.pipelineVersion}`;
    const reuse = opts.recompose
      ? {
          context: await getObjectBuffer(`${base}/debug/context.jpg`).catch(() => undefined),
          outpaint: await getObjectBuffer(`${base}/debug/outpaint.jpg`),
          seam: await getObjectBuffer(`${base}/debug/seam.jpg`).catch(() => undefined),
        }
      : {};
    const art = await generatePanorama(
      photo,
      image,
      { context: contextPrompt(photo, monument), outpaint: outpaintPrompt(photo, monument), seam: seamPrompt() },
      (step) => updateEcho(echoId, { step }),
      // Intermediate frames help tune prompts; cheap compared to the generation itself.
      async (name, img) => putObject(`${base}/debug/${name}.jpg`, await toJpeg(img, undefined, 92), 'image/jpeg'),
      reuse,
    );

    await updateEcho(echoId, { step: 'narration' });
    const narration =
      (opts.recompose ? echo.narration : null) ??
      (await generateText(narrationPrompt(photo, monument)).catch((err) => {
        log.warn({ err: String(err) }, 'narration failed – continuing without it');
        return null;
      }));

    await updateEcho(echoId, { step: 'upload' });
    await putObject(`${base}/pano.jpg`, await toJpeg(art.pano, undefined, 88), 'image/jpeg');
    await putObject(`${base}/preview.jpg`, await toJpeg(art.pano, 1024, 80), 'image/jpeg');

    await updateEcho(echoId, {
      status: 'done',
      step: 'done',
      panoKey: `${base}/pano.jpg`,
      previewKey: `${base}/preview.jpg`,
      panoWidth: STRIP.width,
      panoHeight: STRIP.height,
      photoRect: art.photoRect,
      skyColor: art.sky,
      groundColor: art.ground,
      narration,
      model: env.GEMINI_IMAGE_MODEL,
      durationMs: Date.now() - started,
    });
    log.info({ echoId, photoId: photo.id, ms: Date.now() - started }, 'echo done');
  } catch (err) {
    await updateEcho(echoId, { status: 'failed', error: String(err instanceof Error ? err.message : err).slice(0, 500) });
    throw err;
  }
}
