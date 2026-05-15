# Architecture

> Read this **before** changing structure, adding a new site, or extending the backend. It is the canonical reference for the repo.

---

## 1. Purpose & guiding principles

`store-front` is a **multi-site landing-page monorepo**: one repository, many independent business websites, each on its own brandable root domain. Initial businesses are home-improvement and pressure-washing services; more will be added over time. Each site is a fast, SEO-optimal marketing page with a rich interactive quote experience (multi-step wizard, photo uploads, chatbot, instant estimate, PDF + email).

What this repo **is**:
- A factory for **lead-generation landing pages** for local service businesses.
- A shared design system (components, layout, navigation) so every new business inherits a polished UI for free.
- A shared backend that grows with shared features (chat, uploads, address validation, PDF quotes) — every site benefits when capabilities are added.

What this repo **is not**:
- Not a CMS. Content is committed JSON, not edited in a UI.
- Not e-commerce. There is no cart, no payment processing.
- Not a multi-tenant SaaS. Sites are owned and operated by the same person; per-site config is private deploy state.
- Not a single-page app. Marketing pages are pre-rendered static HTML; only specific zones hydrate.

Guiding principles, in priority order:

1. **SEO first.** Every marketing page is pre-rendered HTML. Interactive widgets must never block the first paint or harm Lighthouse scores.
2. **Add a new business in ~15 minutes.** Copy a site folder, edit content JSON + theme.css, add a `sites.config.json` entry, add a vhost, deploy. No code changes to ship a new business.
3. **Stateless services.** The api container holds no customer data. All durable state lives in S3.
4. **Low ops overhead.** Manual `git pull` + `docker compose up -d --build` deploys. No CI/CD until the volume justifies it.
5. **AI-extensible.** Backend routes have small, clear contracts so adding a new island (e.g. an AI estimator) is mechanical.

---

## 2. High-level topology

```
                              Internet
                                 │
                                 ▼
                      ┌──────────────────────┐
                      │  /opt/infra/proxy    │
                      │  System Nginx (TLS)  │  ← Let's Encrypt
                      │  Ports 80 / 443      │
                      └──────────┬───────────┘
                                 │
            ┌────────────────────┼────────────────────────────┐
            │                    │                            │
   ┌────────▼──────────┐  ┌──────▼─────────┐         ┌────────▼─────────┐
   │ vhost: domain-A   │  │ vhost: domain-B│   ...   │ vhost: domain-N  │
   │  /api/* → api     │  │  /api/* → api  │         │  /api/* → api    │
   │  /     → static-A │  │  /     → static│         │  /     → static-N│
   └────────┬──────────┘  └──────┬─────────┘         └────────┬─────────┘
            │                    │                            │
   ┌────────▼──────────────────▼─────────────────────────────▼──────────┐
   │           /opt/infra/apps/store-front/ (compose stack)             │
   │                                                                    │
   │   ┌──────────────┐  ┌──────────────┐  ...  ┌──────────────────┐   │
   │   │ static-A     │  │ static-B     │       │ api (Fastify)    │   │
   │   │ nginx:alpine │  │ nginx:alpine │       │ Node 20 + TS     │   │
   │   │ serves       │  │ serves       │       │ stateless        │   │
   │   │ dist/        │  │ dist/        │       │ port 3000        │   │
   │   └──────────────┘  └──────────────┘       └──────┬───────────┘   │
   │                                                    │              │
   │   External network: proxy                          │              │
   └────────────────────────────────────────────────────┼──────────────┘
                                                        │
            ┌───────────────────┬───────────────────────┼────────────────┐
            │                   │                       │                │
       ┌────▼────┐         ┌────▼──────┐          ┌─────▼─────┐    ┌─────▼─────┐
       │ AWS S3  │         │ OpenAI    │          │ SMTP      │    │ Geocoder  │
       │ uploads │         │ (gpt-4o-  │          │ (provider │    │ (Mapbox / │
       │ + PDFs  │         │  mini)    │          │  TBD)     │    │  Google)  │
       └─────────┘         └───────────┘          └───────────┘    └───────────┘
```

Inbound traffic terminates TLS at the system Nginx (already configured on the VPS). Nginx routes by hostname → one vhost per business domain. Within each vhost, `/api/*` is reverse-proxied to the `api` container; everything else is served by that domain's static container.

---

## 3. Repository map

```
store-front/
├── README.md                     Pitch + quickstart
├── ARCHITECTURE.md               This file
├── package.json                  pnpm workspaces root
├── pnpm-workspace.yaml
├── tsconfig.base.json            Strict TS base extended by every package
├── .prettierrc, .editorconfig
├── .gitignore
│
├── packages/
│   └── shared-ui/                ALL design-system code lives here
│       ├── components/
│       │   ├── layout/           BaseLayout, Header, Footer, StickyPhoneBar
│       │   └── sections/         Hero, Services, FAQ, Reviews, Process, etc.
│       ├── islands/              React components that hydrate on the client
│       │   ├── QuoteWizard/      5-step quote flow
│       │   ├── Chatbot/          Floating chat bubble (OpenAI streaming)
│       │   └── PhotoDropzone/    Reusable S3 upload component
│       ├── lib/
│       │   ├── seo.ts            Meta builder, OG, JSON-LD helpers
│       │   ├── schema.ts         LocalBusiness, FAQPage, Review schemas
│       │   └── apiClient.ts      Typed fetch wrappers for backend routes
│       └── styles/
│           ├── reset.css
│           ├── tokens.css        CSS custom properties (defaults)
│           └── base.css          Typography, spacing, utility classes
│
├── sites/                        One folder per business
│   ├── home-improvement/
│   │   ├── astro.config.mjs
│   │   ├── src/
│   │   │   ├── pages/index.astro Composes shared sections
│   │   │   ├── content/*.json    Brand, services, reviews, FAQ, process
│   │   │   └── styles/theme.css  Overrides --color-primary, --color-accent, fonts
│   │   └── public/               Images, favicon, robots.txt
│   └── pressure-washing/         Same shape; different content + palette
│
├── services/
│   └── api/                      Single shared backend
│       ├── src/
│       │   ├── server.ts         Fastify, CORS allowlist, rate limit
│       │   ├── config.ts         Loads .env + sites.config.json
│       │   ├── lib/              s3, openai, mailer, pdf, geocode
│       │   └── routes/           health, uploads, address, quote-calc, chat, quote
│       ├── Dockerfile
│       └── .env.example
│
└── deploy/
    ├── compose.yml               Production Docker Compose stack
    ├── nginx-site.conf.template  Per-site static-serving config (inside containers)
    ├── proxy-vhost.template.conf Template for /opt/infra/proxy/nginx/conf.d/
    ├── .env.example              Template for the real .env on the VPS
    ├── sites.config.example.json Template for the real sites.config.json on the VPS
    └── README.md                 Deploy steps + "add a new site" recipe
```

---

## 4. Core decisions and why

| Decision | Rationale |
|---|---|
| **Astro over Next.js / hand-HTML** | Astro pre-renders to static HTML with **zero JS by default** → best SEO + Lighthouse. Components let us reuse sections across all sites. Adding a single React island doesn't ship a 200KB framework runtime to every page. |
| **React islands over full SSR** | The marketing page must be cacheable static HTML. Only the wizard, chatbot, and dropzone need JS — those become islands hydrated on `client:visible` / `client:idle`. Best of both worlds. |
| **Separate Fastify backend over Astro hybrid/SSR** | The backend has different release cadence, scaling needs, and dependency surface than the marketing pages. PDF generation, OpenAI streaming, and S3 calls have no business inside the process that serves the hero image. Keeping them split means we can rebuild the api without redeploying every site, and vice versa. |
| **Per-site config JSON (`sites.config.json`) over per-site env files** | Adding a new business should not require rebuilding the api container. Config is loaded at runtime from a bind-mounted JSON file keyed by request `Origin`. Edit the file, restart the container, done. |
| **Presigned S3 PUT URLs over server-tunneled uploads** | Server signs a short-lived URL; browser PUTs the file directly to S3. The api process never touches photo bytes. Scales to multi-MB photos without backpressure on Node, and lets the container stay stateless and small. |
| **CSS custom properties over Tailwind theme forks** | Each business has a dramatically different palette. CSS variables let one component definition render in N color schemes by swapping one `theme.css`. No build-time theme-forking, no Tailwind config per site. |
| **pnpm workspaces over a single package** | Each site is an independent Astro project that can be built independently. Shared code is a regular workspace package. Adds zero overhead vs npm for this scale. |
| **pdfkit over Puppeteer for PDFs** | pdfkit is a few MB and runs in any Node container. Puppeteer drags Chrome and ~200MB into the image for a feature that needs simple branded layouts. Revisit if quote layouts become magazine-grade. |
| **OpenAI over Anthropic for the chatbot** | User preference; account is set up there. Swappable behind `lib/openai.ts` if that ever changes. |
| **Single shared backend over per-site backends** | Most features (chat, uploads, PDFs, geocode) are identical across businesses. Per-site behavior is config, not code. One service is dramatically less to operate. |

---

## 5. Per-site contract

To add a new business, the new `sites/<business>/` folder must provide:

| Item | Path | Purpose |
|---|---|---|
| Astro config | `astro.config.mjs` | Sets the `site` URL, registers `@astrojs/sitemap` + `@astrojs/react` |
| Index page | `src/pages/index.astro` | Composes shared sections in the agreed landing-page order |
| Brand & contact meta | `src/content/meta.json` | Brand name, phone (E.164), email, address, areaServed (city/region) |
| Services | `src/content/services.json` | Array of `{ id, name, description, image, base?, perUnit? }` |
| Customer reviews | `src/content/reviews.json` | Array of `{ author, text, rating, date? }` |
| FAQ | `src/content/faq.json` | Array of `{ q, a }` — also fed to the chatbot system prompt and JSON-LD |
| Process steps | `src/content/process.json` | Array of `{ step, title, description }` |
| Theme overrides | `src/styles/theme.css` | Overrides the design tokens — primary, accent, fonts, radii |
| OG / favicon / images | `public/` | Hero photo, before/after pairs, crew photos, favicon, og:image |
| robots.txt | `public/robots.txt` | Site-specific — points at this site's sitemap.xml |

Beyond the repo, the new business must also be added to:

| Where | What |
|---|---|
| `deploy/compose.yml` | A `static-<business>` service mirroring the existing ones |
| `deploy/sites.config.json` on the VPS | Entry keyed by the new domain — owner email, phone, chat system prompt, pricing rules, service area, PDF theme |
| `/opt/infra/proxy/nginx/conf.d/<domain>.conf` | New vhost copied from `deploy/proxy-vhost.template.conf` |
| Let's Encrypt | Run certbot for the new domain |

Step-by-step recipe lives in §7.

---

## 6. Backend contract (`services/api`)

All routes are mounted under `/api`. The `Origin` request header determines which entry in `sites.config.json` applies — `Origin` must match `ALLOWED_ORIGINS` or the request is rejected.

| Method | Path | Body / Query | Response | Notes |
|---|---|---|---|---|
| GET | `/api/health` | — | `{ ok: true }` | Liveness for compose healthcheck |
| POST | `/api/uploads/sign` | `[{ filename, contentType, size }]` | `[{ id, key, putUrl, getUrl }]` | Validates MIME (`ALLOWED_UPLOAD_MIME`) and size (`MAX_UPLOAD_MB`). Presigned URLs expire in 15 minutes. |
| POST | `/api/validate-address` | `{ query }` | `{ address, lat, lng, confidence, inServiceArea }` | Calls the configured geocoder; compares against `serviceArea` from sites.config. |
| POST | `/api/quote-calc` | `{ serviceId, inputs }` | `{ low, high, currency }` | Pure function over `pricingRules` from sites.config. No I/O. |
| POST | `/api/chat` | `{ messages: [{role, content}] }` | SSE stream of token deltas | Per-site system prompt is prepended automatically. `messages` may not include `role: 'system'`. |
| POST | `/api/quote` | `{ contact, address, serviceId, photoKeys[], notes }` | `{ quoteId, pdfUrl }` | Verifies S3 keys (`HeadObject`), generates PDF, writes to S3, emails customer (cc owner). `pdfUrl` is a signed GET URL (1-hour expiry). |

Cross-cutting:
- **CORS**: only origins listed in `ALLOWED_ORIGINS` are accepted. Preflight handled by `@fastify/cors`.
- **Rate limiting**: per-IP via `@fastify/rate-limit`. Tighter limits on `/api/uploads/sign` and `/api/quote` than on chat (which is naturally rate-limited by OpenAI tokens).
- **Validation**: every route uses a Zod schema; invalid bodies return 400 with details.
- **Logging**: structured via `pino`. Include `requestId`, `origin`, `route`, and (when present) `quoteId`.
- **No auth on the public routes** — these are public-facing widgets. Defense is rate limiting + payload size caps + honeypot + (optionally) Cloudflare Turnstile in front of `/api/quote`.

### Per-site config shape

```jsonc
{
  "myhomeimprovementcompany.com": {
    "brandName": "Acme Home Improvement",
    "ownerEmail": "owner@acmehi.com",
    "phone": "+1-555-0100",
    "chatSystemPrompt": "You are the assistant for Acme Home Improvement, serving the Greater San José area...",
    "pricingRules": {
      "interior-paint":  { "base": 150, "perSqft": 2.50, "currency": "USD" },
      "deck-rebuild":    { "base": 400, "perSqft": 18,   "currency": "USD" }
    },
    "serviceArea": { "type": "radius", "centerLat": 9.93, "centerLng": -84.08, "radiusKm": 40 },
    "pdfTheme":    { "primary": "#1d4ed8", "logoS3Key": "branding/myhomeimprovementcompany.com/logo.png" }
  }
}
```

---

## 7. Adding a new business (recipe)

Estimated time: **~15 minutes** once you have copy and images ready.

1. **Copy a site** as a starting point:
   ```bash
   cp -r sites/home-improvement sites/<new-business>
   ```
2. **Edit `src/content/*.json`** — brand name, phone, services, reviews, FAQ, process. Replace every "Acme" string.
3. **Edit `src/styles/theme.css`** — set `--color-primary`, `--color-accent`, optional `--font-display`.
4. **Replace `public/images/`** — hero, before/after, crew, og:image. Update `favicon.svg`.
5. **Update `astro.config.mjs`** — set the `site` to the production URL.
6. **Update `package.json`** — change the package `name`.
7. **Add a service block to `deploy/compose.yml`** mirroring an existing `static-*` service.
8. **Add a vhost** to the system Nginx: copy `deploy/proxy-vhost.template.conf` into `/opt/infra/proxy/nginx/conf.d/<domain>.conf`, substitute domain and upstream container name.
9. **Run certbot** on the VPS for the new domain.
10. **Add the domain entry** to `deploy/sites.config.json` on the VPS (owner email, chat system prompt, pricing rules, service area, PDF theme).
11. **Deploy**:
    ```bash
    cd /opt/infra/apps/store-front
    git pull
    docker compose up -d --build
    docker exec proxy nginx -s reload
    ```
12. **Smoke test** — load HTTPS, submit a test quote, confirm email + PDF arrive.

---

## 8. Adding a new backend feature

Two patterns:

**Pattern A — add a route.** Use for self-contained capabilities (e.g. `/api/calendar-availability`).
1. Create `services/api/src/routes/<name>.ts` with a Zod schema for the body, a handler, and an exported `register` function.
2. Wire it in `server.ts`.
3. If the feature is per-site (recipient, rules, prompts), add the relevant keys to the `SiteConfig` type and `sites.config.example.json`.
4. Add a typed client method to `packages/shared-ui/lib/apiClient.ts`.
5. Document the route in this file (§6 table) and in any island that consumes it.

**Pattern B — extend an island.** Use for new interactive UI that reuses existing routes (e.g. an "AI-recommended services" widget on top of `/api/chat`).
1. Add a new component under `packages/shared-ui/islands/<Feature>/`.
2. Decide hydration: `client:visible` for below-the-fold, `client:idle` for floating UI, `client:load` only when truly necessary above the fold.
3. Mount it from the relevant `.astro` section. The site's `index.astro` decides which sections to include.
4. Keep islands small — split into sub-islands rather than ship one mega-bundle.

Hard rules:
- **Never** reach into `process.env` from islands or `.astro` files — only `services/api/src/config.ts` reads env.
- **Never** add per-site behavior via env vars; add it to `sites.config.json`.
- **Never** make the marketing page block on an island (no `client:only`, no top-level `await` in islands).

---

## 9. Deployment & operations

**On the VPS** (`/opt/infra/apps/store-front/`):

```bash
git pull
docker compose up -d --build              # rebuild changed images, restart
docker compose logs -f api                # tail backend logs
docker compose logs -f static-home-improvement
docker compose ps                         # see container status
```

**System Nginx** (`/opt/infra/proxy/`):
```bash
docker exec proxy nginx -t                 # validate config
docker exec proxy nginx -s reload          # apply changes after editing a vhost
```

**TLS** (already automated):
- Renewal runs via cron on the host.
- For a new domain: `certbot certonly --webroot -w /opt/infra/proxy/webroot/ -d <domain>` then add the vhost.

**Rolling back**:
```bash
git log --oneline -10                      # find a known-good commit
git checkout <sha>
docker compose up -d --build
```

**Healthchecks**: each container declares one. `docker compose ps` shows status. `curl https://<domain>/api/health` exercises the full path.

---

## 10. Secrets & configuration

The api container loads **all** secrets from `/opt/infra/apps/store-front/deploy/.env`. The repo only commits `deploy/.env.example` as a template — the real file lives only on the VPS.

| Env var | Purpose | Format / example |
|---|---|---|
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Outbound email | Provider-dependent |
| `OPENAI_API_KEY` | Chatbot auth | `sk-…` |
| `OPENAI_MODEL` | Chat model | Default `gpt-4o-mini`; use `gpt-4o` if quality > cost |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_BUCKET` | S3 access | Restrict IAM to the bucket and to `s3:PutObject`, `s3:GetObject`, `s3:HeadObject` |
| `GEOCODE_PROVIDER` | Address validation | `mapbox` \| `google` \| `smarty` |
| `GEOCODE_API_KEY` | Provider auth | Per-provider |
| `ALLOWED_ORIGINS` | CORS allowlist | Comma-separated: `https://myhomeimprovementcompany.com,https://mypressurewashingcompany.com` |
| `SITES_CONFIG` | Path inside the container | Default `/app/sites.config.json` (bind-mounted from `deploy/sites.config.json`) |
| `MAX_UPLOAD_MB` | Per-file upload cap | e.g. `15` |
| `MAX_FILES_PER_QUOTE` | Per-quote file count cap | e.g. `8` |
| `ALLOWED_UPLOAD_MIME` | MIME allowlist | `image/jpeg,image/png,image/webp` |
| `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW` | Per-IP rate limit | e.g. `60` requests per `1 minute` |

Rules:
- **Never** commit real secrets. Pre-commit hooks should refuse `.env` if you bypass `.gitignore`.
- **Never** inject secrets at build time. Astro and shared-ui must not see backend secrets — only the api container does.
- Rotate keys yearly or whenever ownership changes.

---

## 11. SEO conventions

Every site must:
- Set per-page `<title>` (≤ 60 chars) and `<meta name="description">` (≤ 160 chars) in `BaseLayout`.
- Emit OpenGraph + Twitter card tags. Provide `public/images/og-image.jpg` at 1200×630.
- Render the FAQ section's data into both visible HTML *and* a `FAQPage` JSON-LD `<script>`.
- Render `LocalBusiness` JSON-LD using `meta.json` (name, telephone, address, areaServed, geo).
- Use `@astrojs/sitemap` to auto-generate `sitemap.xml` at build time.
- Ship a `public/robots.txt` pointing at this site's sitemap.
- Use semantic HTML5 landmarks (`<header> <nav> <main> <section> <article> <footer>`).
- Use Astro's `<Image>` component for every photo — width/height always set; lazy by default below the fold; eager only for the LCP hero.
- Self-host fonts via `@fontsource` to avoid render-blocking third parties.
- Canonical URL on every page.

Image guidelines:
- Hero / OG: 1200×630 minimum, `.jpg` or `.webp`.
- Before/after pairs: same dimensions per pair, ≥ 1200px wide.
- Crew photos: 4:5 portrait, ≥ 1000px wide.
- Convert to webp/avif at build time (Astro handles this).

URL structure: every business is single-page. If a site grows, additional pages go under `/services/<slug>`, `/areas/<slug>`, `/faq` — never deeper than two levels for crawl-budget reasons.

---

## 12. Cost & quota notes

**OpenAI**:
- Default `gpt-4o-mini` keeps per-conversation cost in low cents even with chatty users.
- Cap chat turn length: enforce `max_tokens` ~ 600 and stop the stream after N tokens to bound runaway prompts.
- Embed FAQ into the system prompt at request time (cheap and accurate) rather than vector-searching (overkill for the volume).
- Set `RATE_LIMIT_MAX` low on `/api/chat` to catch abuse before the bill does.

**S3**:
- One bucket, prefixed per quote: `quotes/<quoteId>/uploads/...`, `quotes/<quoteId>/quote.pdf`, `quotes/<quoteId>/quote.json`. Branding assets at `branding/<domain>/...`.
- Lifecycle rule: delete objects under `quotes/*/uploads/` older than 7 days if there is no sibling `quote.json` (orphaned wizard sessions).
- Lifecycle rule: keep completed quotes (with `quote.json`) for at least 1 year for follow-up.
- Public bucket access **off** — all reads go through signed URLs.

**Geocoder**:
- Cap free-tier usage with `RATE_LIMIT_MAX` on `/api/validate-address`. The wizard step debounces typing, so a few requests per user is plenty.

---

## 13. Known limits & deferred work

Deferred deliberately — don't waste time rediscovering these as gaps:

- **No analytics yet.** Add Plausible or umami when there is traffic to measure. Privacy-respecting, no cookie banner needed.
- **No CMS / content editor.** Owners cannot edit content themselves; changes are PRs / commits. Acceptable for now; revisit if content updates become frequent.
- **No A/B testing.** Out of scope until traffic warrants statistical significance.
- **No multi-language.** Sites are single-locale (Spanish or English per business). Adding `astro-i18n` is straightforward if needed.
- **No CI/CD.** Manual `git pull && docker compose up -d --build` on the VPS. Add GitHub Actions for build + push once deploy frequency justifies it.
- **No server-side request log retention.** Logs are in `docker compose logs`. Pipe to a real sink (Loki / Datadog / CloudWatch) once volume matters.
- **No payment integration.** Quotes only — payment is offline. Stripe Checkout would slot in as an island and a route if/when required.
- **No tests yet.** Add Playwright for end-to-end of the quote wizard before the second business launches; that's the highest-value coverage.

---

*Keep this document current. When you change the topology, contracts, or recipes, update this file in the same commit.*
