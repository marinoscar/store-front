import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { allowedOrigins, env } from './config.js';
import { registerHealth } from './routes/health.js';
import { registerUploads } from './routes/uploads.js';
import { registerAddress } from './routes/address.js';
import { registerQuoteCalc } from './routes/quoteCalc.js';
import { registerChat } from './routes/chat.js';
import { registerQuote } from './routes/quote.js';

const app = Fastify({
  logger: {
    level: env.LOG_LEVEL,
    ...(env.NODE_ENV === 'development'
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } } }
      : {}),
  },
  bodyLimit: 1 * 1024 * 1024, // 1MB JSON bodies — uploads go direct to S3, not through here
  trustProxy: true,
});

await app.register(cors, {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // server-to-server, healthchecks, curl
    cb(null, allowedOrigins.includes(origin));
  },
  credentials: false,
  methods: ['GET', 'POST', 'OPTIONS'],
});

await app.register(rateLimit, {
  max: env.RATE_LIMIT_MAX,
  timeWindow: env.RATE_LIMIT_WINDOW,
  hook: 'preHandler',
});

await registerHealth(app);
await registerUploads(app);
await registerAddress(app);
await registerQuoteCalc(app);
await registerChat(app);
await registerQuote(app);

app.setNotFoundHandler((_req, reply) => {
  reply.code(404).send({ error: 'not_found' });
});

const port = env.PORT;
const host = '0.0.0.0';

app
  .listen({ port, host })
  .then(() => app.log.info({ port, host }, 'api listening'))
  .catch((err) => {
    app.log.error(err, 'failed to start');
    process.exit(1);
  });

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    app.log.info({ sig }, 'shutting down');
    await app.close();
    process.exit(0);
  });
}
