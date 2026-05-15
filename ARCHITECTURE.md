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

Two-tier routing: the system Nginx terminates TLS and maps each subdomain to a different `127.0.0.1` port; a per-site Nginx container at that port serves the static `dist/` AND proxies `/api/*` to the shared backend. All inter-container traffic stays on an internal Docker network.

```
                              Internet
                                 │
                                 ▼
                      ┌──────────────────────────────┐
                      │  /opt/infra/proxy/ (system)  │
                      │  Nginx + *.marin.cr cert     │  ← wildcard Let's Encrypt
                      │  Ports 80 / 443              │
                      └──────────────┬───────────────┘
                                     │
                     map $host $store_front_port:
                       raul1.dev.marin.cr → 8324
                       raul2.dev.marin.cr → 8325
                       (more sites = more lines)
                                     │
                       proxy_pass http://127.0.0.1:$store_front_port
                                     │
              ┌──────────────────────┴────────────────────────┐
              │                                               │
   ┌──────────▼────────────┐                       ┌──────────▼────────────┐
   │ store-front-raul1     │                       │ store-front-raul2     │
   │ nginx:alpine          │                       │ nginx:alpine          │
   │ host port :8324       │                       │ host port :8325       │
   │  /api/* → api         │                       │  /api/* → api         │
   │  /     → dist (HI)    │                       │  /     → dist (PW)    │
   └──────────┬────────────┘                       └──────────┬────────────┘
              │                                               │
              └─────────────────────┬─────────────────────────┘
                                    │
                       internal docker network:
                            store-front-net
                                    │
                       ┌────────────▼───────────┐
                       │ store-front-api        │
                       │ Fastify Node 20        │
                       │ :3000 (internal only)  │
                       │ stateless              │
                       └────┬───────────────────┘
                            │
            ┌───────────────┼──────────────┬───────────────┐
            │               │              │               │
       ┌────▼────┐     ┌────▼──────┐  ┌────▼─────┐    ┌────▼─────┐
       │ AWS S3  │     │ OpenAI    │  │ SMTP     │    │ Geocoder │
       │ uploads │     │ (gpt-4o-  │  │ (TBD)    │    │ (Mapbox /│
       │ + PDFs  │     │  mini)    │  │          │    │  Google) │
       └─────────┘     └───────────┘  └──────────┘    └──────────┘
```

The system Nginx terminates TLS using the existing `*.marin.cr` wildcard certificate at `/opt/infra/proxy/letsencrypt/live/marin.cr/`. New subdomains under `*.marin.cr` need no new certbot run — just a line in the `map` block and a port-bound container. The store-front Docker stack joins **no external network**; the only ingress is via the per-site host-port bindings.

Why two tiers rather than letting the system Nginx route `/api/*` directly:
- A single shared file (`deploy/site.nginx.conf`) defines per-site routing rules; adding a business is `map` + new container, no system-Nginx rewrite per route.
- The api container has zero host-port exposure — only the per-site routers can reach it.
- Each container's responsibility is narrow: TLS at the edge, hostname mapping next, then path splitting, then the backend itself.

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
    ├── site.nginx.conf           Per-site internal nginx (static dist + /api/ proxy)
    ├── raul-sites.conf           Host-level nginx vhost — installed to /opt/infra/proxy/nginx/conf.d/
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
| `deploy/compose.yml` | A service block mirroring `raul1` — bound to a fresh `127.0.0.1:<port>:80`, same `site.nginx.conf`, mount the new site's `dist/` |
| `deploy/sites.config.json` on the VPS | Entry keyed by the new domain — owner email, phone, chat system prompt, pricing rules, service area, PDF theme |
| `deploy/raul-sites.conf` | Add a line to the `map` block + append the host to both `server_name` directives |
| Let's Encrypt | Only if the new domain is **outside** `*.marin.cr`. Subdomains of `marin.cr` are already covered by the wildcard cert. |

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
  "raul1.dev.marin.cr": {
    "brandName": "Rivadeneira Home Improvement",
    "ownerEmail": "owner@rivadeneirahi.com",
    "phone": "+1-555-0100",
    "chatSystemPrompt": "You are the assistant for Rivadeneira Home Improvement, serving the wooded north-Houston suburbs (The Woodlands, Conroe, Willis, Tomball, Montgomery)...",
    "pricingRules": {
      "interior-paint":  { "base": 150, "perSqft": 2.50, "currency": "USD" },
      "deck-rebuild":    { "base": 400, "perSqft": 18,   "currency": "USD" }
    },
    "serviceArea": { "type": "radius", "centerLat": 9.93, "centerLng": -84.08, "radiusKm": 40 },
    "pdfTheme":    { "primary": "#1d4ed8", "logoS3Key": "branding/raul1.dev.marin.cr/logo.png" }
  }
}
```

---

## 7. Adding a new business (recipe)

Estimated time: **~10 minutes** under `*.marin.cr` (no new TLS cert needed). ~15 min under a brand-new root domain with cert issuance.

1. **Pick a free 832x port.** Current allocations: 8324 (raul1), 8325 (raul2). Keep the convention.
2. **Copy a site** as a starting point:
   ```bash
   cp -r sites/home-improvement sites/<new-business>
   ```
3. **Edit `src/content/*.json`** — brand name, phone, services, reviews, FAQ, process. Replace every brand-name string.
4. **Edit `src/styles/theme.css`** — set `--color-primary`, `--color-accent`, optional `--font-display`.
5. **Replace `public/images/`** — hero, before/after, crew, og:image. Update `favicon.svg`.
6. **Update `astro.config.mjs`** — set `site` to the production URL.
7. **Update `package.json`** — change the package `name` and dev port.
8. **Add a service block to `deploy/compose.yml`** mirroring `raul1`: unique `container_name`, `127.0.0.1:<new-port>:80`, mount the new site's `dist/`, reuse `./site.nginx.conf`.
9. **Edit `deploy/raul-sites.conf`** — add a line to the `map $host $store_front_port` block and append the new host to both `server_name` directives.
10. **Add the domain entry** to `deploy/sites.config.json` on the VPS (owner email, chat system prompt, pricing rules, service area, PDF theme).
11. **Update `ALLOWED_ORIGINS`** in `deploy/.env` to include `https://<newdomain>`.
12. **Point DNS** for the new subdomain at the VPS.
13. **Deploy**:
    ```bash
    cd /opt/infra/apps/store-front
    git pull && pnpm install && pnpm -r build
    cd deploy && docker compose up -d --build
    sudo cp deploy/raul-sites.conf /opt/infra/proxy/nginx/conf.d/raul-sites.conf
    docker exec proxy nginx -t && docker exec proxy nginx -s reload
    ```
14. **Smoke test** — load HTTPS, submit a test quote, confirm email + PDF arrive, check S3.

If the new business is **not** under `*.marin.cr`, also issue a cert for it before step 13 — either DNS-challenge (`certbot certonly --dns-route53 -d <domain>`) or HTTP-challenge via `/opt/infra/proxy/webroot/` — and adjust `ssl_certificate*` paths in `raul-sites.conf` (or move that domain to its own vhost file).

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
docker compose -f deploy/compose.yml up -d --build  # rebuild + restart
docker compose -f deploy/compose.yml logs -f api    # tail backend logs
docker compose -f deploy/compose.yml logs -f raul1  # tail per-site nginx logs
docker compose -f deploy/compose.yml ps             # container status
```

If `deploy/raul-sites.conf` changed in this pull, install it and reload the system Nginx:
```bash
sudo cp deploy/raul-sites.conf /opt/infra/proxy/nginx/conf.d/raul-sites.conf
docker exec proxy nginx -t                  # validate
docker exec proxy nginx -s reload           # apply
```

**TLS** (already automated):
- Wildcard `*.marin.cr` cert at `/opt/infra/proxy/letsencrypt/live/marin.cr/`. Renewal runs via the certbot systemd timer (DNS challenge).
- **New `*.marin.cr` subdomains need NO new certbot run** — wildcard covers them automatically.
- For a brand-new domain outside `*.marin.cr`: issue a per-domain cert (preferably DNS-challenge: `certbot certonly --dns-route53 -d <domain>`, or webroot HTTP-challenge via `/opt/infra/proxy/webroot/`) and update `ssl_certificate*` paths.

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
| `ALLOWED_ORIGINS` | CORS allowlist | Comma-separated: `https://raul1.dev.marin.cr,https://raul2.dev.marin.cr` |
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
