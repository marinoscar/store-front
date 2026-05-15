import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { siteFromOrigin } from '../config.js';

const BodySchema = z.object({
  serviceId: z.string().min(1),
  sqft: z.number().nonnegative().optional(),
  units: z.number().nonnegative().optional(),
});

export async function registerQuoteCalc(app: FastifyInstance): Promise<void> {
  app.post('/api/quote-calc', async (req, reply) => {
    const site = siteFromOrigin(req.headers.origin);
    if (!site) return reply.code(403).send({ error: 'unknown_origin' });

    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });
    }

    const rule = site.pricingRules[parsed.data.serviceId];
    if (!rule) return reply.code(400).send({ error: 'unknown_service' });

    const sqftCost = rule.perSqft && parsed.data.sqft ? rule.perSqft * parsed.data.sqft : 0;
    const unitCost = rule.perUnit && parsed.data.units ? rule.perUnit * parsed.data.units : 0;
    const center = rule.base + sqftCost + unitCost;

    // ±15% range to communicate uncertainty
    return {
      low: Math.round(center * 0.85),
      high: Math.round(center * 1.15),
      currency: rule.currency,
    };
  });
}
