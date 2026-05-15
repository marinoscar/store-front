import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { siteFromOrigin } from '../config.js';
import { geocode } from '../lib/geocode.js';
import { isInServiceArea } from '../lib/serviceArea.js';

const BodySchema = z.object({
  query: z.string().min(3).max(300),
});

export async function registerAddress(app: FastifyInstance): Promise<void> {
  app.post('/api/validate-address', async (req, reply) => {
    const site = siteFromOrigin(req.headers.origin);
    if (!site) return reply.code(403).send({ error: 'unknown_origin' });

    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });
    }

    const result = await geocode(parsed.data.query);
    if (!result) return { found: false } as const;

    return {
      found: true,
      address: result.address,
      lat: result.lat,
      lng: result.lng,
      confidence: result.confidence,
      inServiceArea: isInServiceArea(site.serviceArea, result.lat, result.lng),
    } as const;
  });
}
