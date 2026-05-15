import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  type HeadObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config.js';

export const s3 = new S3Client({
  region: env.AWS_REGION,
  credentials: env.AWS_ACCESS_KEY_ID
    ? {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      }
    : undefined,
});

export function quoteUploadKey(quoteId: string, fileId: string, filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  return `quotes/${quoteId}/uploads/${fileId}-${safe}`;
}

export function quotePdfKey(quoteId: string): string {
  return `quotes/${quoteId}/quote.pdf`;
}

export function quoteRecordKey(quoteId: string): string {
  return `quotes/${quoteId}/quote.json`;
}

export async function presignPut(key: string, contentType: string): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(s3, cmd, { expiresIn: env.S3_PUT_EXPIRES });
}

export async function presignGet(key: string, expiresIn = env.S3_GET_EXPIRES): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn });
}

export async function headObject(key: string): Promise<HeadObjectCommandOutput | undefined> {
  try {
    return await s3.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
  } catch {
    return undefined;
  }
}

export async function putObject(
  key: string,
  body: Buffer | Uint8Array | string,
  contentType: string,
): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function getObjectBuffer(key: string): Promise<Buffer | undefined> {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    if (!res.Body) return undefined;
    const chunks: Buffer[] = [];
    for await (const chunk of res.Body as AsyncIterable<Buffer | Uint8Array>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  } catch {
    return undefined;
  }
}
