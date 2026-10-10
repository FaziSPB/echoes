import { distanceM, dollyCrop, frameScale } from '@echoes/shared';
import sharp from 'sharp';
import { BudgetExceededError, imageBudget } from '../budget';
import { editImage, type AspectRatio } from '../clients/gemini';
import { env } from '../env';
import { log } from '../log';
import { getMonument } from '../repos/monuments';
import { getPhotoRow } from '../repos/photos';
import { startWalk, updateWalk, type WalkFrameRow } from '../repos/walks';
import { putObject } from '../storage';
import { matchTone, toJpeg } from './compose';
import { loadPhotoImage } from './pipeline';
import { walkStepPrompt } from './prompts';

const FRAME_WIDTH = 1600;
const ASPECTS: Array<[AspectRatio, number]> = [
  ['1:1', 1],
  ['4:3', 4 / 3],
  ['3:2', 3 / 2],
  ['16:9', 16 / 9],
  ['21:9', 21 / 9],
];
const closestAspect = (ratio: number) => ASPECTS.reduce((best, cur) => (Math.abs(cur[1] - ratio) < Math.abs(best[1] - ratio) ? cur : best))[0];

export type WalkOptions = { frames?: number; lengthM?: number; subjectDistanceM?: number };

/**
 * "Walk in time": frame 0 is the archival photo; frames 1..N are generated in a chain. Each step enlarges the previous
 * frame by the pinhole dolly factor (a geometric prior) and asks the model to re-render it as seen from the new spot,
 * with the original as the style reference. Paid: N images, checked against the daily budget before starting.
 */
export async function generateWalk(photoId: string, opts: WalkOptions = {}) {
  const frames = opts.frames ?? 3;
  const lengthM = opts.lengthM ?? 10;
  const photo = await getPhotoRow(photoId);
  if (!photo || photo.lat === null || photo.lon === null) throw new Error(`photo ${photoId} not found or not located`);
  const monument = photo.monumentInspireId ? await getMonument(photo.monumentInspireId) : null;

  const budget = await imageBudget();
  if (budget.remaining < frames) throw new BudgetExceededError(budget.used, budget.limit);

  const toSubject = monument?.lat != null && monument.lon != null ? distanceM(photo.lat, photo.lon, monument.lat, monument.lon) : 40;
  const D = opts.subjectDistanceM ?? Math.min(150, Math.max(20, toSubject));
  // The path must end well before the subject, or the dolly factor explodes.
  if (lengthM > D * 0.7) throw new Error(`walk of ${lengthM} m is too long for a subject ${D.toFixed(0)} m away`);

  const original = await loadPhotoImage(photo);
  const meta = await sharp(original).metadata();
  const W = FRAME_WIDTH;
  const H = Math.round((W * meta.height!) / meta.width!);
  const aspect = closestAspect(W / H);
  const reference = await sharp(original).resize(W, H, { fit: 'fill' }).jpeg({ quality: 90 }).toBuffer();

  const walk = await startWalk(photo.id, lengthM, D, env.GEMINI_IMAGE_MODEL);
  const base = `walks/${photo.id}`;
  const out: WalkFrameRow[] = [{ distanceM: 0, imageKey: photo.imageKey!, generated: false }];
  log.info({ photoId, frames, lengthM, subjectDistanceM: Number(D.toFixed(1)), aspect, budget }, 'walk started');

  try {
    let prev = reference;
    let prevM = 0;
    for (let k = 1; k <= frames; k++) {
      const atM = (lengthM * k) / frames;
      // Geometric prior: what the previous frame looks like from atM (centre crop, enlarged back to full size).
      const crop = dollyCrop(W, H, frameScale(D, prevM, atM));
      const prior = await sharp(prev).extract(crop).resize(W, H).jpeg({ quality: 90 }).toBuffer();
      await putObject(`${base}/debug/prior-${k}.jpg`, prior, 'image/jpeg');

      const generated = await editImage({
        prompt: walkStepPrompt(photo, monument, atM, atM - prevM),
        images: [
          { data: prior, mime: 'image/jpeg' },
          { data: reference, mime: 'image/jpeg' },
        ],
        aspectRatio: aspect,
        imageSize: '2K',
      });
      // Same geometry as the original (cover-crop to its aspect), same tonality.
      const frame = await matchTone(await sharp(generated).resize(W, H, { fit: 'cover' }).png().toBuffer(), original);
      const key = `${base}/frame-${k}.jpg`;
      await putObject(key, await toJpeg(frame, undefined, 88), 'image/jpeg');
      out.push({ distanceM: Number(atM.toFixed(2)), imageKey: key, generated: true });
      await updateWalk(walk.id, { frames: out });
      log.info({ photoId, frame: k, atM }, 'walk frame done');
      prev = await sharp(frame).jpeg({ quality: 90 }).toBuffer();
      prevM = atM;
    }
    await updateWalk(walk.id, { status: 'done', frames: out });
    return { walkId: walk.id, frames: out.length, subjectDistanceM: D };
  } catch (err) {
    await updateWalk(walk.id, { status: 'failed', error: String(err instanceof Error ? err.message : err).slice(0, 500) });
    throw err;
  }
}
