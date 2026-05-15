import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { env, allowedUploadMime, siteFromOrigin } from '../config.js';
import { presignPut, presignGet, quoteUploadKey } from '../lib/s3.js';

const BodySchema = z.object({
  quoteId: z.string().uuid().optional(),
  files: z
    .array(
      z.object({
        filename: z.string().min(1).max(200),
        contentType: z.string().min(1),
        size: z.number().int().nonnegative(),
      }),
    )
    .min(1),
});

export async function registerUploads(app: FastifyInstance): Promise<void> {
  app.post('/api/uploads/sign', async (req, reply) => {
    if (!siteFromOrigin(req.headers.origin)) {
      return reply.code(403).send({ error: 'unknown_origin' });
    }

    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });
    }
    const { files } = parsed.data;

    if (files.length > env.MAX_FILES_PER_QUOTE) {
      return reply.code(400).send({ error: 'too_many_files', max: env.MAX_FILES_PER_QUOTE });
    }
    const maxBytes = env.MAX_UPLOAD_MB * 1024 * 1024;
    for (const f of files) {
      if (!allowedUploadMime.includes(f.contentType)) {
        return reply.code(400).send({ error: 'unsupported_mime', mime: f.contentType });
      }
      if (f.size > maxBytes) {
        return reply.code(400).send({ error: 'file_too_large', max_mb: env.MAX_UPLOAD_MB });
      }
    }

    const quoteId = parsed.data.quoteId ?? randomUUID();
    const signed = await Promise.all(
      files.map(async (f) => {
        const id = randomUUID();
        const key = quoteUploadKey(quoteId, id, f.filename);
        const [putUrl, getUrl] = await Promise.all([
          presignPut(key, f.contentType),
          presignGet(key),
        ]);
        return { id, key, putUrl, getUrl };
      }),
    );

    return { quoteId, files: signed };
  });
}
