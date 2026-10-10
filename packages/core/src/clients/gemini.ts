import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { env } from '../env';

let client: GoogleGenAI | undefined;
function ai(): GoogleGenAI {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set (see .env)');
  client ??= new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  return client;
}

/** Image generation at 4K takes ~30–90 s; never let a hung request block a worker slot. */
const IMAGE_REQUEST = { timeout: 180_000, maxRetries: 1 };
const TEXT_REQUEST = { timeout: 60_000, maxRetries: 2 };

export type AspectRatio = '1:1' | '16:9' | '21:9' | '4:1' | '8:1' | '3:2' | '4:3';
export type ImageSize = '1K' | '2K' | '4K';

/**
 * Image-to-image edit with Nano Banana via the Interactions API.
 * `images` are passed in order after the text prompt (first = canvas to edit, rest = references).
 */
export async function editImage(opts: {
  prompt: string;
  images: Array<{ data: Buffer; mime: 'image/png' | 'image/jpeg' }>;
  aspectRatio: AspectRatio;
  imageSize: ImageSize;
  model?: string;
}): Promise<Buffer> {
  const interaction = await ai().interactions.create({
    model: opts.model ?? env.GEMINI_IMAGE_MODEL,
    input: [
      { type: 'text', text: opts.prompt },
      ...opts.images.map((img) => ({ type: 'image' as const, mime_type: img.mime, data: img.data.toString('base64') })),
    ],
    response_format: {
      type: 'image',
      mime_type: 'image/jpeg', // the only output type the Interactions API accepts for images
      aspect_ratio: opts.aspectRatio,
      image_size: opts.imageSize,
    },
  }, IMAGE_REQUEST);
  const out = interaction.output_image;
  if (!out?.data) {
    throw new Error(`Gemini returned no image${interaction.output_text ? `: ${interaction.output_text.slice(0, 300)}` : ''}`);
  }
  return Buffer.from(out.data, 'base64');
}

/** Structured JSON output validated against a zod schema. */
export async function generateJson<S extends z.ZodType>(prompt: string, schema: S, model = env.GEMINI_TEXT_MODEL): Promise<z.infer<S>> {
  const interaction = await ai().interactions.create({
    model,
    input: prompt,
    response_format: { type: 'text', mime_type: 'application/json', schema: z.toJSONSchema(schema) as Record<string, unknown> },
  }, TEXT_REQUEST);
  const text = interaction.output_text ?? '';
  return schema.parse(JSON.parse(text));
}

export async function generateText(prompt: string, model = env.GEMINI_TEXT_MODEL): Promise<string> {
  const interaction = await ai().interactions.create({ model, input: prompt }, TEXT_REQUEST);
  return (interaction.output_text ?? '').trim();
}

export async function listModels(): Promise<string[]> {
  const names: string[] = [];
  const pager = await ai().models.list();
  for await (const m of pager) if (m.name) names.push(m.name.replace(/^models\//, ''));
  return names;
}
