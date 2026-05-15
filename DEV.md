# Development Environment

Concrete reference for how store-front runs on the marin.cr VPS — paths, ports, certs, scripts, and the day-to-day operations you'll actually need. For *why* the architecture looks the way it does, see [`ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## Quick start

```bash
./scripts/start-raul1.sh   # home improvement → https://raul1.dev.marin.cr/
./scripts/start-raul2.sh   # pressure washing → https://raul2.dev.marin.cr/
```

Idempotent. Each script builds the site, runs docker compose, ensures the host nginx mapping is in place, reloads nginx if it changed it, then smoke-tests the public URL.

---

## VPS & hosting

| | |
|---|---|
| Public IP | `144.126.129.254` |
| Operating user | `marinoscar` (single human user; passwordless sudo) |
| Repo path | `/home/marinoscar/git/store-front` |
| Production app path on the VPS (per infra convention) | `/opt/infra/apps/store-front` *(not used yet; the repo currently runs from the dev path above)* |
| OS | Ubuntu (systemd-managed nginx) |

`/opt/infra/` is the [marin-server-infra](https://github.com/marinoscar/marin-server-infra) repo — VPS-level config (nginx, certs, certbot timer, shared infra). Don't put app code there; only edit it for infrastructure changes.

---

## DNS & TLS

### DNS

Wildcard A record: `*.dev.marin.cr → 144.126.129.254`. Already configured at the registrar. Any new `<name>.dev.marin.cr` resolves to this VPS automatically — no DNS work needed when adding a site.

### Wildcard cert (the single most important thing for new sites)

```
/etc/letsencrypt/live/dev.marin.cr/
├── fullchain.pem   ← cert
├── privkey.pem     ← private key
├── chain.pem
└── cert.pem
```

| | |
|---|---|
| Coverage | `*.dev.marin.cr` and `dev.marin.cr` (SANs) |
| Challenge type | DNS-01 (via Route 53 — the only way to validate a wildcard) |
| Renewal | systemd `certbot.timer` (runs twice daily; verify with `sudo systemctl status certbot.timer`) |
| Dry-run renewal test | `sudo certbot renew --dry-run` |

**Adding any new `*.dev.marin.cr` subdomain requires NO certbot run.** The wildcard cert covers it the moment you reload nginx with the new map entry.

A new domain *outside* `*.dev.marin.cr` (e.g. `raul1.marin.cr` proper, or a brand-new TLD) would need its own cert — either a new wildcard (preferred, DNS challenge) or a per-domain cert (HTTP-01 challenge via webroot).

---

## Host nginx (system-installed, not Docker)

### Files

| Path | Purpose |
|---|---|
| `/etc/nginx/nginx.conf` | Main config |
| `/etc/nginx/sites-available/dev-wildcard` | **The file you edit to add a new site** — symlinked into `sites-enabled/` |
| `/etc/nginx/sites-available/code-server`, `cockpit` | Other system services |
| `/etc/letsencrypt/options-ssl-nginx.conf` | TLS hardening, included by every vhost |
| `/etc/letsencrypt/ssl-dhparams.pem` | DH params, included by every vhost |

### How dev-wildcard works

One config file with a `map` block routing every `*.dev.marin.cr` hostname to a local port, then a single HTTPS vhost that does `proxy_pass http://127.0.0.1:$backend_port`.

```nginx
map $host $backend_port {
    modelgate.dev.marin.cr    8318;
    knecta.dev.marin.cr       8319;
    clipboard.dev.marin.cr    8320;
    semantic.dev.marin.cr     8321;
    vitalmesh.dev.marin.cr    8322;
    shellkeep.dev.marin.cr    8323;
    raul1.dev.marin.cr        8324;   # ← home-improvement
    raul2.dev.marin.cr        8325;   # ← pressure-washing
    sink.dev.marin.cr         3535;
    vault.dev.marin.cr        3536;
}

server {
    listen 443 ssl;
    server_name *.dev.marin.cr;
    ssl_certificate     /etc/letsencrypt/live/dev.marin.cr/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/dev.marin.cr/privkey.pem;
    # ...
    if ($backend_port = "") { return 444; }
    location / {
        proxy_pass http://127.0.0.1:$backend_port;
        # WebSocket + buffering off (good for SSE chat)
    }
}
```

### Commands

| Need | Command |
|---|---|
| Validate config syntax | `sudo nginx -t` |
| Reload after editing | `sudo systemctl reload nginx` (or `sudo nginx -s reload`) |
| See what's listening on host | `sudo ss -tlnp` |
| Watch nginx logs | `sudo tail -f /var/log/nginx/access.log /var/log/nginx/error.log` |

The start scripts handle all of this automatically — only run these commands manually for diagnostics.

---

## Port allocations

Reserved range for landing-page apps: **832x**. Add new sites here.

| Port | Owner |
|---|---|
| 8318 | modelgate |
| 8319 | knecta |
| 8320 | clipboard *(currently listening)* |
| 8321 | semantic *(mapped; not running)* |
| 8322 | vitalmesh *(mapped; not running)* |
| 8323 | shellkeep *(currently listening)* |
| **8324** | **store-front-raul1 (home-improvement)** |
| **8325** | **store-front-raul2 (pressure-washing)** |
| 8326+ | free — use for the next business |
| 3535 | sink |
| 3536 | vault |

The 832x ports are bound to `127.0.0.1` only (not `0.0.0.0`). Only the host nginx reaches them.

---

## Docker stack (store-front-specific)

| | |
|---|---|
| Compose file | `deploy/compose.yml` |
| Internal network | `store-front-net` (bridge; not shared with other stacks) |
| Stack name | `store-front` |

### Containers

| Container | Image | Role | Host exposure |
|---|---|---|---|
| `store-front-api` | built from `services/api/Dockerfile` | Fastify backend (chat, uploads/sign, validate-address, quote-calc, quote) | none — internal only |
| `store-front-raul1` | `nginx:1.27-alpine` | Serves `sites/home-improvement/dist/` + proxies `/api/*` to api | `127.0.0.1:8324:80` |
| `store-front-raul2` | `nginx:1.27-alpine` | Serves `sites/pressure-washing/dist/` + proxies `/api/*` to api | `127.0.0.1:8325:80` |

The two `raul*` containers share a single config file — `deploy/site.nginx.conf` — bind-mounted into each. They differ only in which `dist/` is mounted.

### api Dockerfile

Runtime-only. Relies on the host having already run `pnpm -r build` to produce `services/api/dist/`. Inside the container we install **only production deps with `npm`** (flat node_modules — pnpm workspace symlinks don't translate cleanly into Docker), then `node dist/server.js`.

Implication: **never `docker compose up --build` without first running `pnpm -r build` on the host.** The start scripts always do the host build first.

---

## Configuration files

| Path | Purpose | Gitignored? |
|---|---|---|
| `deploy/.env` | Backend secrets (OpenAI, AWS, SMTP, etc.) | **Yes** |
| `deploy/.env.example` | Template; committed | No |
| `deploy/sites.config.json` | Per-site config (brand, owner email, chat prompt, pricing, service area, PDF theme) | **Yes** |
| `deploy/sites.config.example.json` | Template; committed | No |
| `sites/<site>/src/content/*.json` | Per-site static content (meta, services, FAQ, reviews, process) | No (committed) |
| `sites/<site>/src/styles/theme.css` | Per-site CSS palette | No |
| `sites/<site>/public/images/` | Hero, before/after, crew photos | No |

### `deploy/.env` — required variables

(canonical list lives in `deploy/.env.example`)

| Var | Purpose | Currently |
|---|---|---|
| `OPENAI_API_KEY` | Chatbot streaming (`/api/chat`) | ✓ set |
| `OPENAI_MODEL` | Default `gpt-4o-mini`; switch to `gpt-4o` for quality | ✓ set |
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET` | Presigned PUTs + PDF storage | ✓ set (reusing Knecta bucket; store-front objects live under `quotes/` prefix) |
| `SMTP_HOST/PORT/USER/PASS/FROM` | Quote emails | **blank** — `/api/quote` won't email until set |
| `GEOCODE_PROVIDER`, `GEOCODE_API_KEY` | Address validation | **blank** — `/api/validate-address` returns `{ found: false }` |
| `ALLOWED_ORIGINS` | CORS allowlist; comma-separated full origins | `https://raul1.dev.marin.cr,https://raul2.dev.marin.cr` |
| `SITES_CONFIG` | Container path to mounted sites.config.json | `/app/sites.config.json` |
| `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW` | Per-IP throttling | 60 / 1 minute |
| `MAX_UPLOAD_MB`, `MAX_FILES_PER_QUOTE`, `ALLOWED_UPLOAD_MIME` | Upload validation | 15MB / 8 files / jpeg+png+webp |

### `deploy/sites.config.json` — schema per domain

```jsonc
{
  "raul1.dev.marin.cr": {
    "brandName": "Acme Home Improvement",
    "ownerEmail": "owner@example.com",
    "phone": "+1-555-0100",
    "chatSystemPrompt": "You are the assistant for Acme...",
    "pricingRules": { "interior-paint": { "base": 150, "perSqft": 2.5, "currency": "USD" } },
    "serviceArea": { "type": "radius", "centerLat": 9.93, "centerLng": -84.08, "radiusKm": 40 },
    "pdfTheme": { "primary": "#1d4ed8", "logoS3Key": "branding/raul1.dev.marin.cr/logo.png" }
  }
}
```

Permission note: **must be `644`** so the container user can read it. The start scripts enforce this automatically. Don't `chmod 600` — `EACCES` will crash-loop the api.

---

## Where artifacts end up

| Artifact | Location |
|---|---|
| Astro static build per site | `sites/<site>/dist/` (bind-mounted into nginx container) |
| Fastify backend build | `services/api/dist/` (copied into api image at build) |
| Uploaded photos | `s3://knecta/quotes/<quoteId>/uploads/...` |
| Generated PDFs | `s3://knecta/quotes/<quoteId>/quote.pdf` |
| Submission records | `s3://knecta/quotes/<quoteId>/quote.json` |
| Per-site branding assets | `s3://knecta/branding/<domain>/logo.png` |

---

## The start scripts

| Script | What it does |
|---|---|
| `scripts/start-raul1.sh` | Brings up home-improvement at `https://raul1.dev.marin.cr/` |
| `scripts/start-raul2.sh` | Brings up pressure-washing at `https://raul2.dev.marin.cr/` |
| `scripts/_common.sh` | Shared helpers; not run directly |

Each script does this, in order:

1. **Ensure pnpm available** (via corepack if missing)
2. **`pnpm install`** at the repo root if `node_modules/` is absent
3. **`pnpm --filter <site> --filter api build`** — host-side Astro + tsc
4. **Verify `deploy/.env` and `deploy/sites.config.json` exist; `chmod 644` the latter**
5. **`docker compose up -d --build api <site>`**
6. **Check the host nginx wildcard map**; insert the `<subdomain> → <port>;` line if missing, then `sudo nginx -t && sudo systemctl reload nginx`
7. **curl `https://<subdomain>/` and `https://<subdomain>/api/health`**, report HTTP codes

All steps are idempotent. Re-running an already-up site is fast (build skips unchanged, docker recreates if needed, nginx skips if entry exists, smoke test runs).

---

## Adding a new business

1. **Pick the next free `832x` port** (current next: `8326`).
2. **Copy a site folder** and customize:
   ```bash
   cp -r sites/home-improvement sites/<new-business>
   # then edit src/content/*.json, src/styles/theme.css, public/images/, package.json, astro.config.mjs
   ```
3. **Add a service block to `deploy/compose.yml`** mirroring `raul1`:
   ```yaml
   raul3:
     image: nginx:1.27-alpine
     container_name: store-front-raul3
     # ... same as raul1 but mount sites/<new-business>/dist and bind 127.0.0.1:8326:80
   ```
4. **Add a `sites.config.json` entry** keyed by the new subdomain.
5. **Add `https://<newsubdomain>` to `ALLOWED_ORIGINS`** in `deploy/.env`.
6. **Copy a start script** and edit its 4 vars:
   ```bash
   cp scripts/start-raul1.sh scripts/start-raul3.sh
   # edit SITE_PKG, SUBDOMAIN, PORT, DOCKER_SERVICE
   chmod +x scripts/start-raul3.sh
   ```
7. **Run it** — the script handles the nginx map insertion and reload itself.

Total: ~10 min.

---

## Common operations cheatsheet

| Need | Command |
|---|---|
| Bring up raul1 from cold | `./scripts/start-raul1.sh` |
| Restart everything | `docker compose -f deploy/compose.yml restart` |
| Stop everything | `docker compose -f deploy/compose.yml down` |
| Tail api logs | `docker compose -f deploy/compose.yml logs -f api` |
| Tail per-site nginx logs | `docker compose -f deploy/compose.yml logs -f raul1` |
| Container status | `docker compose -f deploy/compose.yml ps` |
| Rebuild only the api | `pnpm --filter api build && docker compose -f deploy/compose.yml up -d --build api` |
| Rebuild only a site's static output (no docker) | `pnpm --filter <site> build` *(picked up on next request via bind-mount)* |
| Test public URL from this server | `curl -sS --resolve raul1.dev.marin.cr:443:127.0.0.1 https://raul1.dev.marin.cr/` |
| Validate host nginx | `sudo nginx -t` |
| Reload host nginx | `sudo systemctl reload nginx` |
| See what's bound on the host | `sudo ss -tlnp` |
| Force-recreate a container | `docker compose -f deploy/compose.yml up -d --force-recreate <service>` |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `502` from `https://<subdomain>/api/...` | api container crashed or not on the docker network | `docker compose logs api`; common cause: `EACCES on sites.config.json` → `chmod 644` |
| `444` from `https://<subdomain>/` | Subdomain isn't in the dev-wildcard map | The start script should add it. Manually: edit `/etc/nginx/sites-available/dev-wildcard` + reload |
| `403 unknown_origin` from `/api/*` | The Origin header isn't in `ALLOWED_ORIGINS` | Add it to `deploy/.env` and `docker compose restart api` |
| TLS / cert error in browser | Wildcard cert path moved or expired | `ls /etc/letsencrypt/live/dev.marin.cr/`, `sudo certbot renew --dry-run` |
| `pnpm: command not found` | corepack disabled | `corepack enable && corepack prepare pnpm@9.12.0 --activate` |
| `docker compose up --build` fails on type errors | Stale Dockerfile that builds inside the container | Should already be runtime-only; if not, re-pull repo |
| Chat returns 500 | `OPENAI_API_KEY` invalid or out of quota | `docker compose logs api` shows the OpenAI error |
| Upload sign returns 500 | AWS creds invalid or bucket policy missing PutObject | `docker compose logs api`; verify IAM grants `s3:PutObject`/`GetObject`/`HeadObject` on the bucket |
| Quote submission succeeds but no email | `SMTP_*` blank | Set them in `deploy/.env` and `docker compose restart api` |
| Address validation always returns `found: false` | `GEOCODE_API_KEY` blank | Set it + `docker compose restart api` |

---

## Files & locations summary

```
/home/marinoscar/git/store-front/
├── ARCHITECTURE.md       why
├── DEV.md                this file (how)
├── CLAUDE.md             agent operating instructions
├── README.md             pitch + quickstart
│
├── scripts/
│   ├── _common.sh        shared script helpers
│   ├── start-raul1.sh    bring up home-improvement
│   └── start-raul2.sh    bring up pressure-washing
│
├── deploy/
│   ├── compose.yml       Docker stack
│   ├── site.nginx.conf   per-site router config (used by raul1 + raul2 containers)
│   ├── .env              runtime secrets (gitignored)
│   ├── .env.example      template (committed)
│   ├── sites.config.json runtime per-site config (gitignored, mode 644)
│   ├── sites.config.example.json template (committed)
│   └── README.md         deploy-specific notes
│
├── sites/<site>/         per-business code & content
└── services/api/         shared Fastify backend
```

```
/etc/nginx/sites-available/dev-wildcard    host-level vhost (map for all *.dev.marin.cr)
/etc/letsencrypt/live/dev.marin.cr/        wildcard cert
/opt/infra/                                marin-server-infra repo (VPS-level config)
```
