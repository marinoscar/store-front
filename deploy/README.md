# Deploy

Two-tier routing pattern matching `marinoscar/clipboard/docs/ssl-nginx-setup.md`:

```
Internet → host Nginx (TLS, *.marin.cr wildcard)
        → map by hostname to 127.0.0.1:8324 or 8322
        → per-site Docker Nginx (static dist + /api/ → backend)
        → store-front-api (shared Fastify backend)
```

## Target paths on the VPS

| Path | Purpose |
|---|---|
| `/opt/infra/proxy/` | System Nginx + Let's Encrypt (already running) |
| `/opt/infra/proxy/nginx/conf.d/raul-sites.conf` | This stack's host-level vhost (installed from `deploy/raul-sites.conf`) |
| `/opt/infra/proxy/letsencrypt/live/marin.cr/` | Wildcard `*.marin.cr` TLS cert (already issued) |
| `/opt/infra/apps/store-front/` | This repo (clone target) |
| `/opt/infra/apps/store-front/deploy/.env` | Real backend secrets (NOT git-tracked) |
| `/opt/infra/apps/store-front/deploy/sites.config.json` | Real per-site config (NOT git-tracked) |

## Domain map

| Site | Domain | Host-bound port |
|---|---|---|
| Home improvement | `raul1.dev.marin.cr` | `127.0.0.1:8324` |
| Pressure washing | `raul2.dev.marin.cr` | `127.0.0.1:8325` |

## First-time deploy

1. **DNS** — point A records for `raul1.dev.marin.cr` and `raul2.dev.marin.cr` at the VPS IP. Wait until they resolve (`dig +short raul1.dev.marin.cr`).

2. **Clone** the repo:
   ```bash
   cd /opt/infra/apps
   git clone <repo-url> store-front
   cd store-front
   ```

3. **Build the static sites**:
   ```bash
   pnpm install
   pnpm -r build
   ```
   Each site emits to `sites/<business>/dist/`.

4. **Create production config** files (not in git):
   ```bash
   cp deploy/.env.example deploy/.env
   cp deploy/sites.config.example.json deploy/sites.config.json
   $EDITOR deploy/.env                 # SMTP, OpenAI, AWS, geocoder keys
   $EDITOR deploy/sites.config.json    # owner emails, pricing rules, service areas, PDF themes
   ```

5. **Bring up the docker stack**:
   ```bash
   cd deploy
   docker compose up -d --build
   docker compose ps          # api, raul1, raul2 — all Up + healthy
   ```

   Quick check that the per-site routers respond locally:
   ```bash
   curl http://127.0.0.1:8324/nginx-health   # → ok
   curl http://127.0.0.1:8325/nginx-health   # → ok
   curl http://127.0.0.1:8324/api/health     # → {"ok":true}  (proxied to api)
   ```

6. **Install the host Nginx vhost**:
   ```bash
   sudo cp /opt/infra/apps/store-front/deploy/raul-sites.conf \
           /opt/infra/proxy/nginx/conf.d/raul-sites.conf
   ```

   Confirm the wildcard cert path is correct on this host (the file assumes
   `/opt/infra/proxy/letsencrypt/live/marin.cr/`). If the cert lives elsewhere,
   edit the `ssl_certificate*` lines in the installed file.

7. **Validate and reload** the system Nginx:
   ```bash
   docker exec proxy nginx -t          # or: sudo nginx -t  (depends on your setup)
   docker exec proxy nginx -s reload
   ```

8. **Smoke test** from outside the VPS:
   ```bash
   curl -I https://raul1.dev.marin.cr/                # 200 OK + TLS
   curl -I https://raul2.dev.marin.cr/                # 200 OK + TLS
   curl  https://raul1.dev.marin.cr/api/health        # {"ok":true}
   ```

   Then in a browser:
   - Load each site; confirm the marketing page renders and the wizard mounts
   - Open the chatbot bubble; confirm streaming response
   - Walk the quote wizard end-to-end with test data; confirm email + PDF arrive
   - Check S3 for `quotes/<id>/quote.pdf` and `quotes/<id>/uploads/...`

## Routine deploys

```bash
cd /opt/infra/apps/store-front
git pull
pnpm install
pnpm -r build
cd deploy
docker compose up -d --build
```

Static `dist/` directories are bind-mounted, so the new build is picked up by the per-site routers immediately on the next request. The api container restarts with the new image.

If `deploy/raul-sites.conf` itself changes:
```bash
sudo cp deploy/raul-sites.conf /opt/infra/proxy/nginx/conf.d/raul-sites.conf
docker exec proxy nginx -t && docker exec proxy nginx -s reload
```

## Adding a new business under `*.marin.cr`

The wildcard cert means no new TLS issuance is needed. Steps:

1. **Pick a free port** in the 832x range (current: 8321, 8322 in use; doc convention: 8320+ reserved for app containers).
2. **Copy a site folder** in the repo and customize:
   ```bash
   cp -r sites/home-improvement sites/<new-business>
   ```
   Edit `package.json`, `astro.config.mjs` (SITE_URL), `src/content/*.json`, `src/styles/theme.css`, `public/images/`, `public/favicon.svg`, `public/robots.txt`.
3. **Add a service block** to `deploy/compose.yml` mirroring `raul1`. Use a unique `container_name` and bind to `127.0.0.1:<new-port>:80`.
4. **Add a line** to the `map` block in `deploy/raul-sites.conf`:
   ```nginx
   map $host $store_front_port {
       raul1.dev.marin.cr   8321;
       raul2.dev.marin.cr   8322;
       newsite.marin.cr 8323;
   }
   ```
   And add the new host to both `server_name` directives in that file.
5. **Add a domain entry** to `deploy/sites.config.json` (owner email, chat prompt, pricing rules, service area, PDF theme).
6. **Update `ALLOWED_ORIGINS`** in `deploy/.env` to include `https://<newdomain>` (comma-separated).
7. **Deploy**:
   ```bash
   git pull && pnpm install && pnpm -r build && cd deploy && docker compose up -d --build
   sudo cp deploy/raul-sites.conf /opt/infra/proxy/nginx/conf.d/raul-sites.conf
   docker exec proxy nginx -t && docker exec proxy nginx -s reload
   ```
8. **Point DNS** for the new subdomain at the VPS.

Total: ~10 min once the template is solid.

## If the wildcard cert does NOT exist yet

The plan assumes `*.marin.cr` is already issued (per the doc, via DNS challenge with Route53). If it isn't, you have two options:

**Option A — issue a wildcard** (preferred; one cert for all subdomains):
```bash
sudo certbot certonly --dns-route53 --key-type ecdsa \
  -d "*.marin.cr" -d "marin.cr"
```

**Option B — per-domain cert via HTTP challenge** (works without DNS API access):
Temporarily add an HTTP-01 challenge block to `raul-sites.conf`, then:
```bash
certbot certonly --webroot -w /opt/infra/proxy/webroot/ -d raul1.dev.marin.cr
certbot certonly --webroot -w /opt/infra/proxy/webroot/ -d raul2.dev.marin.cr
```
Then edit the `ssl_certificate*` paths in `raul-sites.conf` to point at the per-domain cert dirs.

## Troubleshooting

| Symptom | Where to look |
|---|---|
| `502` / `connection refused` from host | `docker compose ps` — is the per-site container Up on `127.0.0.1:832x`? `ss -tlnp` on the host |
| `444` returned | Subdomain isn't in the `map` block — only configured hosts are routed |
| Chat returns `403` | `ALLOWED_ORIGINS` in `deploy/.env` doesn't include the requesting domain |
| Chat returns `500` | `docker compose logs api` — usually `OPENAI_API_KEY` missing or invalid |
| Upload sign returns `500` | AWS keys / region / bucket misconfigured in `deploy/.env`; container needs `s3:PutObject`/`GetObject`/`HeadObject` on the bucket |
| Email never arrives | SMTP keys in `deploy/.env`; logs from the `quote` route |
| Static page is 404 | Wrong bind-mount in compose — confirm `sites/<business>/dist/` exists after `pnpm -r build` |
| Cert renewal failing | Wildcard certs renew via DNS challenge (systemd timer); `sudo systemctl status certbot.timer` + `sudo certbot renew --dry-run` |
