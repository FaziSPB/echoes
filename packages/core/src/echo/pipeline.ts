import sharp from 'sharp';
import { editImage, generateText, type ImageSize } from '../clients/gemini';
import { fetchWithRetry } from '../clients/http';
import { env } from '../env';
import { log } from '../log';
import { getEcho, updateEcho } from '../repos/echoes';
import { getMonument } from '../repos/monuments';
import { getPhotoRow, type PhotoRow } from '../repos/photos';
import { getObjectBuffer, putObject } from '../storage';
import { buildCanvas, edgeColors, grayBand, isMonochrome, matchTone, mergeBand, normalizeToStrip, repastePhoto, rollX, toJpeg } from './compose';
import { photoRectInStrip, type StripSpec } from './geometry';
import { narrationPrompt, outpaintPrompt, seamPrompt } from './prompts';

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

/** Pure image part of the pipeline (no DB) – also used by the CLI for quick experiments. */
export async function generatePanorama(
  photo: PhotoRow,
  image: Buffer,
  prompts: { outpaint: string; seam: string },
  onStep: (step: 'outpaint' | 'seam' | 'compose') => Promise<void> = async () => {},
): Promise<EchoArtifacts> {
  const meta = await sharp(image).metadata();
  const rect = photoRectInStrip(STRIP, {
    width: meta.width!,
    height: meta.height!,
    hfovDeg: photo.hfovDeg,
    pitchDeg: photo.pitchDeg,
  });
  const canvas = await buildCanvas(image, STRIP, rect);

  await onStep('outpaint');
  const generated = await editImage({
    prompt: prompts.outpaint,
    images: [{ data: canvas, mime: 'image/png' }],
    aspectRatio: '4:1',
    imageSize: IMAGE_SIZE,
  });
  let pano = await normalizeToStrip(generated, STRIP);

  if (SEAM_PASS) {
    // The wrap seam sits at x=0; roll it to the centre, gray it out and let the model heal it.
    await onStep('seam');
    const band = Math.round(STRIP.width / 10);
    const rolled = await rollX(pano, STRIP.width / 2);
    const healed = await normalizeToStrip(
      await editImage({
        prompt: prompts.seam,
        images: [{ data: await grayBand(rolled, band), mime: 'image/png' }],
        aspectRatio: '4:1',
        imageSize: IMAGE_SIZE,
      }),
      STRIP,
    );
    pano = await rollX(await mergeBand(rolled, healed, band), -STRIP.width / 2);
  }

  await onStep('compose');
  pano = await matchTone(pano, image);
  pano = await repastePhoto(pano, image, rect, Math.round(rect.w * 0.03));
  const { sky, ground } = await edgeColors(pano);
  return { pano, photoRect: rect, sky, ground };
}

/** Worker entry point: runs one echo end-to-end and persists every step for the app's progress UI. */
export async function runEcho(echoId: string): Promise<void> {
  const started = Date.now();
  const echo = await getEcho(echoId);
  if (!echo) throw new Error(`echo ${echoId} not found`);
  if (echo.status === 'done') return;

  const photo = await getPhotoRow(echo.photoId);
  if (!photo) throw new Error(`photo ${echo.photoId} not found`);
  const monument = photo.monumentInspireId ? await getMonument(photo.monumentInspireId) : null;

  try {
    await updateEcho(echoId, { status: 'running', step: 'prepare', error: null });
    const image = await loadPhotoImage(photo);
    const monochrome = await isMonochrome(image);

    const art = await generatePanorama(
      photo,
      image,
      { outpaint: outpaintPrompt(photo, monument, monochrome), seam: seamPrompt(monochrome) },
      (step) => updateEcho(echoId, { step }),
    );

    await updateEcho(echoId, { step: 'narration' });
    const narration = await generateText(narrationPrompt(photo, monument)).catch((err) => {
      log.warn({ err: String(err) }, 'narration failed – continuing without it');
      return null;
    });

    await updateEcho(echoId, { step: 'upload' });
    const base = `echoes/${photo.id}/v${echo.pipelineVersion}`;
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
