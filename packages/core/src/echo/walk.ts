import { distanceM, dollyCrop, frameScale } from '@echoes/shared';
import sharp from 'sharp';
import { BudgetExceededError, imageBudget } from '../budget';
import { editImage, type AspectRatio } from '../clients/gemini';
import { env } from '../env';
import { log } from '../log';
import { getMonument } from '../repos/monuments';
import { getPhotoRow } from '../repos/photos';
import { getWalkForPhoto, startWalk, updateWalk, type WalkFrameRow } from '../repos/walks';
import { getObjectBuffer, putObject } from '../storage';
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

export type WalkOptions = {
  frames?: number;
  lengthM?: number;
  subjectDistanceM?: number;
  /** Regenerate only frames ≥ fromFrame, keeping the earlier ones of the existing walk (default 1 = all). */
  fromFrame?: number;
};

/** Global correlation of two images (downscaled grayscale) – how well the model kept the prior's composition. */
async function compositionScore(a: Buffer, b: Buffer): Promise<number> {
  const gray = async (img: Buffer) => Float32Array.from(await sharp(img).resize(128, 96, { fit: 'fill' }).greyscale().raw().toBuffer());
  const [x, y] = await Promise.all([gray(a), gray(b)]);
  const mean = (v: Float32Array) => v.reduce((s, n) => s + n, 0) / v.length;
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i]! - mx) * (y[i]! - my);
    sxx += (x[i]! - mx) ** 2;
    syy += (y[i]! - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy || 1);
}

/**
 * "Walk in time": frame 0 is the archival photo; frames 1..N are generated in a chain. Each step enlarges the previous
 * frame by the pinhole dolly factor (a geometric prior) and asks the model to re-render it as seen from the new spot,
 * with the original as the style reference. Paid: N images, checked against the daily budget before starting.
 */
export async function generateWalk(photoId: string, opts: WalkOptions = {}) {
  const fromFrame = Math.max(1, opts.fromFrame ?? 1);
  const existing = fromFrame > 1 ? await getWalkForPhoto(photoId) : null;
  if (fromFrame > 1 && (!existing || existing.frames.length < fromFrame)) throw new Error(`no walk with ${fromFrame - 1} frames to continue from`);
  const frames = opts.frames ?? (existing ? existing.frames.length - 1 : 3);
  const lengthM = opts.lengthM ?? existing?.lengthM ?? 10;
  const photo = await getPhotoRow(photoId);
  if (!photo || photo.lat === null || photo.lon === null) throw new Error(`photo ${photoId} not found or not located`);
  const monument = photo.monumentInspireId ? await getMonument(photo.monumentInspireId) : null;

  const paidImages = frames - fromFrame + 1;
  const budget = await imageBudget();
  if (budget.remaining < paidImages) throw new BudgetExceededError(budget.used, budget.limit);

  const toSubject = monument?.lat != null && monument.lon != null ? distanceM(photo.lat, photo.lon, monument.lat, monument.lon) : 40;
  const D = opts.subjectDistanceM ?? existing?.subjectDistanceM ?? Math.min(150, Math.max(20, toSubject));
  // The path must end well before the subject, or the dolly factor explodes.
  if (lengthM > D * 0.7) throw new Error(`walk of ${lengthM} m is too long for a subject ${D.toFixed(0)} m away`);

  const original = await loadPhotoImage(photo);
  const meta = await sharp(original).metadata();
  const W = FRAME_WIDTH;
  const H = Math.round((W * meta.height!) / meta.width!);
  const aspect = closestAspect(W / H);
  const reference = await sharp(original).resize(W, H, { fit: 'fill' }).jpeg({ quality: 90 }).toBuffer();

  const kept = existing ? existing.frames.slice(0, fromFrame) : [];
  const walk = await startWalk(photo.id, lengthM, D, env.GEMINI_IMAGE_MODEL, kept);
  const base = `walks/${photo.id}`;
  // Media is cached as immutable on clients, so every regeneration gets new object keys.
  const rev = Date.now().toString(36);
  const out: WalkFrameRow[] = kept.length ? kept : [{ distanceM: 0, imageKey: photo.imageKey!, generated: false }];
  log.info({ photoId, frames, fromFrame, paidImages, lengthM, subjectDistanceM: Number(D.toFixed(1)), aspect, budget }, 'walk started');

  try {
    const last = out[out.length - 1]!;
    let prev = last.generated ? await sharp(await getObjectBuffer(last.imageKey)).resize(W, H, { fit: 'fill' }).jpeg({ quality: 90 }).toBuffer() : reference;
    let prevM = last.distanceM;
    for (let k = fromFrame; k <= frames; k++) {
      const atM = (lengthM * k) / frames;
      // Geometric prior: what the previous frame looks like from atM (centre crop, enlarged back to full size).
      const crop = dollyCrop(W, H, frameScale(D, prevM, atM));
      const prior = await sharp(prev).extract(crop).resize(W, H).jpeg({ quality: 90 }).toBuffer();
      await putObject(`${base}/debug/prior-${k}-${rev}.jpg`, prior, 'image/jpeg');

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
      const score = await compositionScore(prior, frame);
      if (score < 0.65) log.warn({ frame: k, score }, 'model drifted from the geometric prior – consider regenerating this frame');
      const key = `${base}/frame-${k}-${rev}.jpg`;
      await putObject(key, await toJpeg(frame, undefined, 88), 'image/jpeg');
      out.push({ distanceM: Number(atM.toFixed(2)), imageKey: key, generated: true });
      await updateWalk(walk.id, { frames: out });
      log.info({ photoId, frame: k, atM, compositionScore: Number(score.toFixed(3)) }, 'walk frame done');
      prev = await sharp(frame).jpeg({ quality: 90 }).toBuffer();
      prevM = atM;
    }
    await updateWalk(walk.id, { status: 'done', frames: out });
    return { walkId: walk.id, frames: out.length, subjectDistanceM: D };
  } catch (err) {
    const error = String(err instanceof Error ? err.message : err).slice(0, 500);
    if (existing?.status === 'done') {
      // A failed partial regeneration must not take a working walk offline – keep the previous frames.
      await updateWalk(walk.id, { status: 'done', frames: existing.frames, error: `regeneration failed: ${error}` });
    } else {
      await updateWalk(walk.id, { status: 'failed', error });
    }
    throw err;
  }
}
