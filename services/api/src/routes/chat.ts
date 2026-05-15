import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { siteFromOrigin } from '../config.js';
import { streamChat } from '../lib/openai.js';

const BodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(40),
});

export async function registerChat(app: FastifyInstance): Promise<void> {
  app.post('/api/chat', async (req, reply) => {
    const site = siteFromOrigin(req.headers.origin);
    if (!site) return reply.code(403).send({ error: 'unknown_origin' });

    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      for await (const delta of streamChat(site.chatSystemPrompt, parsed.data.messages)) {
        send('delta', { text: delta });
      }
      send('done', { ok: true });
    } catch (err) {
      req.log.error({ err }, 'chat stream error');
      send('error', { message: 'Chat is temporarily unavailable.' });
    } finally {
      reply.raw.end();
    }
  });
}
