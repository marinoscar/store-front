import { readFileSync } from 'node:fs';
import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.string().default('info'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),

  SITES_CONFIG: z.string().min(1),
  ALLOWED_ORIGINS: z.string().default(''),

  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_WINDOW: z.string().default('1 minute'),

  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  SMTP_FROM: z.string().default(''),

  OPENAI_API_KEY: z.string().default(''),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  OPENAI_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(600),

  AWS_REGION: z.string().default('us-east-1'),
  AWS_ACCESS_KEY_ID: z.string().default(''),
  AWS_SECRET_ACCESS_KEY: z.string().default(''),
  S3_BUCKET: z.string().default(''),
  S3_PUT_EXPIRES: z.coerce.number().int().positive().default(900),
  S3_GET_EXPIRES: z.coerce.number().int().positive().default(3600),

  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(15),
  MAX_FILES_PER_QUOTE: z.coerce.number().int().positive().default(8),
  ALLOWED_UPLOAD_MIME: z.string().default('image/jpeg,image/png,image/webp'),

  GEOCODE_PROVIDER: z.enum(['mapbox', 'google', 'smarty']).default('mapbox'),
  GEOCODE_API_KEY: z.string().default(''),
});

export type Env = z.infer<typeof EnvSchema>;

const PricingRuleSchema = z.object({
  base: z.number().nonnegative(),
  perSqft: z.number().nonnegative().optional(),
  perUnit: z.number().nonnegative().optional(),
  currency: z.string().default('USD'),
});

const ServiceAreaSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('radius'),
    centerLat: z.number(),
    centerLng: z.number(),
    radiusKm: z.number().positive(),
  }),
  z.object({
    type: z.literal('polygon'),
    coordinates: z.array(z.tuple([z.number(), z.number()])).min(3),
  }),
]);

const SiteConfigSchema = z.object({
  brandName: z.string().min(1),
  ownerEmail: z.string().email(),
  phone: z.string().min(1),
  chatSystemPrompt: z.string().min(1),
  pricingRules: z.record(PricingRuleSchema),
  serviceArea: ServiceAreaSchema,
  pdfTheme: z.object({
    primary: z.string(),
    accent: z.string().optional(),
    logoS3Key: z.string().optional(),
  }),
});

export type PricingRule = z.infer<typeof PricingRuleSchema>;
export type ServiceArea = z.infer<typeof ServiceAreaSchema>;
export type SiteConfig = z.infer<typeof SiteConfigSchema>;

const SitesConfigSchema = z.record(SiteConfigSchema);
export type SitesConfig = z.infer<typeof SitesConfigSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.message}`);
  }
  return parsed.data;
}

function loadSitesConfig(path: string): SitesConfig {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(`Failed to read SITES_CONFIG at ${path}: ${(err as Error).message}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new Error(`SITES_CONFIG at ${path} is not valid JSON: ${(err as Error).message}`);
  }
  const parsed = SitesConfigSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`SITES_CONFIG schema mismatch: ${parsed.error.message}`);
  }
  return parsed.data;
}

export const env = loadEnv();

export const allowedOrigins = env.ALLOWED_ORIGINS.split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

export const allowedUploadMime = env.ALLOWED_UPLOAD_MIME.split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

export const sitesConfig = loadSitesConfig(env.SITES_CONFIG);

/**
 * Resolve a site config from a request's Origin header.
 * Returns undefined if the origin is not in the allowlist or has no config entry.
 */
export function siteFromOrigin(origin: string | undefined): SiteConfig | undefined {
  if (!origin) return undefined;
  if (!allowedOrigins.includes(origin)) return undefined;
  let hostname: string;
  try {
    hostname = new URL(origin).hostname;
  } catch {
    return undefined;
  }
  return sitesConfig[hostname];
}
