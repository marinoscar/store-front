import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { siteFromOrigin } from '../config.js';
import { headObject, presignGet, putObject, quotePdfKey, quoteRecordKey } from '../lib/s3.js';
import { renderQuotePdf } from '../lib/pdf.js';
import { sendQuoteEmail } from '../lib/mailer.js';

const BodySchema = z.object({
  quoteId: z.string().uuid().optional(),
  serviceId: z.string().min(1),
  contact: z.object({
    name: z.string().min(1).max(120),
    email: z.string().email(),
    phone: z.string().min(5).max(40),
  }),
  address: z.object({
    formatted: z.string().min(3),
    lat: z.number().optional(),
    lng: z.number().optional(),
  }),
  notes: z.string().max(2000).optional(),
  estimate: z
    .object({
      low: z.number().nonnegative(),
      high: z.number().nonnegative(),
      currency: z.string(),
    })
    .optional(),
  photoKeys: z.array(z.string().min(1)).max(50).default([]),
  honeypot: z.string().max(0).optional(),
});

export async function registerQuote(app: FastifyInstance): Promise<void> {
  app.post('/api/quote', async (req, reply) => {
    const site = siteFromOrigin(req.headers.origin);
    if (!site) return reply.code(403).send({ error: 'unknown_origin' });

    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });
    }
    const data = parsed.data;

    // Bot trap — honeypot field must be empty or absent.
    if (data.honeypot && data.honeypot.length > 0) {
      return reply.code(204).send();
    }

    // Verify each photo actually landed in S3 to prevent forged keys.
    const verifiedKeys: string[] = [];
    for (const key of data.photoKeys) {
      const head = await headObject(key);
      if (head) verifiedKeys.push(key);
    }

    const quoteId = data.quoteId ?? randomUUID();
    const serviceName = data.serviceId; // Display name lives in the site's services.json; the API only needs the id.

    const pdfBuffer = await renderQuotePdf({
      quoteId,
      site,
      serviceName,
      customer: data.contact,
      address: data.address.formatted,
      notes: data.notes,
      estimate: data.estimate,
      photoKeys: verifiedKeys,
    });

    const pdfKey = quotePdfKey(quoteId);
    await putObject(pdfKey, pdfBuffer, 'application/pdf');

    const record = {
      quoteId,
      submittedAt: new Date().toISOString(),
      origin: req.headers.origin,
      site: site.brandName,
      serviceId: data.serviceId,
      contact: data.contact,
      address: data.address,
      notes: data.notes ?? '',
      estimate: data.estimate ?? null,
      photoKeys: verifiedKeys,
      pdfKey,
    };
    await putObject(
      quoteRecordKey(quoteId),
      Buffer.from(JSON.stringify(record, null, 2)),
      'application/json',
    );

    try {
      await sendQuoteEmail({
        to: data.contact.email,
        cc: site.ownerEmail,
        brandName: site.brandName,
        customerName: data.contact.name,
        pdfBuffer,
        pdfFilename: `quote-${quoteId.slice(0, 8)}.pdf`,
        estimate: data.estimate,
      });
    } catch (err) {
      req.log.error({ err, quoteId }, 'failed to send quote email');
      // Persist the quote regardless — owner can manually follow up via the record.
    }

    const pdfUrl = await presignGet(pdfKey);
    return { quoteId, pdfUrl };
  });
}
