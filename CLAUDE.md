# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Always read this first

[**`ARCHITECTURE.md`**](./ARCHITECTURE.md) at the repo root is the canonical reference: topology, repo map, design decisions, per-site contract, backend route contracts, deployment, secrets, and recipes for adding a new business or a new backend feature. Read it before changing structure, adding a new site, or extending the backend — and update it in the same commit when topology or contracts change.

## Repo shape (one-line summary)

Multi-business landing-page monorepo. `packages/shared-ui/` holds all reusable Astro components + React islands. Each business lives in `sites/<business>/` as a thin shell of content JSON + a `theme.css` override. `services/api/` is one shared Fastify backend (OpenAI chat, AWS S3 presigned uploads, PDF quotes, address validation). `deploy/` contains the Docker Compose stack and Nginx templates for the existing VPS reverse proxy.

## Commands

Requires Node ≥ 20 and pnpm ≥ 9.

```bash
pnpm install              # install all workspaces
pnpm build                # build every site and the api
pnpm dev:hi               # dev server: home-improvement (http://localhost:4321)
pnpm dev:pw               # dev server: pressure-washing (http://localhost:4322)
pnpm dev:api              # dev server: api (http://localhost:3000)
pnpm typecheck            # type-check every workspace
pnpm format               # prettier write
```

Local end-to-end test:
```bash
docker run --rm -p 1025:1025 -p 8025:8025 axllent/mailpit   # SMTP capture at http://localhost:8025
pnpm dev:api &
pnpm dev:hi
# Use the wizard at http://localhost:4321 — emails will land in Mailpit.
```

Production deploy: see `deploy/README.md`.

## Conventions specific to this repo

- **Adding a business is config, not code.** Copy a site folder, swap content JSON and `theme.css`, add a `sites.config.json` entry and an Nginx vhost. Never fork shared components.
- **Per-site backend behavior** (system prompt, pricing, owner email, PDF branding) lives in `deploy/sites.config.json` keyed by the request `Origin` header. Never read env vars per-site.
- **Astro pages stay static.** Only `packages/shared-ui/islands/*` may hydrate. Use `client:visible` for below-the-fold widgets and `client:idle` for floating UI. Never `client:only` and never block first paint with an island.
- **Backend is stateless.** All durable customer state goes to S3 under `quotes/<quoteId>/`. Don't introduce a database without updating ARCHITECTURE.md §13.
- **Uploads use presigned PUTs.** Photos never go through Node — the api signs S3 URLs and the browser PUTs direct. Don't add multipart parsing to `services/api`.
- **Secrets only via `deploy/.env`** on the VPS. `.env.example` is committed; the real `.env` is gitignored and lives only on the server.
- **OpenAI for AI**, not Anthropic. The chat route streams via SSE through `services/api/src/lib/openai.ts`.

## What goes where

| You want to… | Edit |
|---|---|
| Change a marketing section's HTML / look | `packages/shared-ui/components/sections/<Name>.astro` |
| Change a business's copy, reviews, FAQ, services | `sites/<business>/src/content/*.json` |
| Change a business's color scheme or fonts | `sites/<business>/src/styles/theme.css` |
| Add a new interactive UI feature | New island under `packages/shared-ui/islands/<Feature>/`; mount from a section |
| Add a new backend capability | New file in `services/api/src/routes/`, wired in `server.ts`, typed client in `packages/shared-ui/lib/apiClient.ts` |
| Add a new business | Follow `ARCHITECTURE.md` §7 (10-step recipe) |
| Change deploy topology | Edit `deploy/compose.yml` and update `ARCHITECTURE.md` §2 in the same commit |

## Don't

- Don't add per-page TypeScript builds — every site uses Astro and `astro check`.
- Don't introduce a database layer or local data volumes; stay stateless and S3-backed.
- Don't `cd <cwd>` before git commands — git already operates on the working tree.
- Don't bake secrets into Docker images. Env loading happens at container start from `deploy/.env`.
