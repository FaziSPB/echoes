import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';
import { env } from './env';

export const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  forcePathStyle: true,
  credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
});

export async function ensureBucket(): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );
}

export async function getObject(key: string) {
  const res = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
  return {
    body: res.Body as Readable,
    contentType: res.ContentType ?? 'application/octet-stream',
    contentLength: res.ContentLength,
    etag: res.ETag,
  };
}

export async function getObjectBuffer(key: string): Promise<Buffer> {
  const { body } = await getObject(key);
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/**
 * Media is served through the API (`/media/*`) or a CDN in front of it. Without PUBLIC_MEDIA_URL we return
 * relative paths, so the same response works over LAN, a tunnel or localhost.
 */
export function mediaUrl(key: string | null | undefined): string | null {
  return key ? `${env.PUBLIC_MEDIA_URL.replace(/\/$/, '')}/media/${key}` : null;
}
