# store-front

Multi-site landing-page monorepo for small businesses. Shared UI, per-site theming, single self-hosted backend (OpenAI chatbot, AWS S3 photo uploads, PDF quote generation, address validation).

Initial sites:
- **Home Improvement** — `sites/home-improvement/`
- **Pressure Washing** — `sites/pressure-washing/`

More businesses added as needed by copying a site folder and overriding content + theme — see [`ARCHITECTURE.md`](./ARCHITECTURE.md) §7 "Adding a new business."

## Read this first

[**`ARCHITECTURE.md`**](./ARCHITECTURE.md) — purpose, topology, repo map, decisions, contracts, and the recipes for adding new sites and backend features. Always start there before changing structure.

## Quickstart

Requires Node ≥ 20 and pnpm ≥ 9.

```bash
pnpm install

# Run a site in dev (port 4321 / 4322)
pnpm dev:hi          # home-improvement
pnpm dev:pw          # pressure-washing

# Run the backend in dev (port 3000)
pnpm dev:api

# Build everything (CI / pre-deploy)
pnpm build
```

To run the full stack locally with Docker Compose (mirrors production), see `deploy/README.md`.

## Layout

```
packages/shared-ui/      Shared Astro components, React islands, design tokens
sites/<business>/        One folder per business — content JSON + theme.css
services/api/            Single Fastify backend used by all sites
deploy/                  compose.yml, nginx templates, env templates, deploy guide
```

## Tech

Astro (static pages, zero JS by default) + React islands for interactivity • Fastify backend on Node 20 • OpenAI for chat • AWS S3 (presigned PUTs) for photo storage • pdfkit for quote PDFs • nodemailer for email • Docker Compose behind the existing Nginx reverse proxy on the VPS.
