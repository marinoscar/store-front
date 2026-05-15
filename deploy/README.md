# Deploy

How to bring the stack up on the VPS, and how to add a new business once it's running.

## Target paths on the VPS

| Where | What |
|---|---|
| `/opt/infra/proxy/` | System Nginx + Let's Encrypt (already configured) |
| `/opt/infra/proxy/nginx/conf.d/` | Per-domain vhost configs |
| `/opt/infra/proxy/letsencrypt/` | TLS certificate store |
| `/opt/infra/proxy/webroot/` | ACME challenge directory |
| `/opt/infra/apps/store-front/` | This repo (clone target) |
| `/opt/infra/apps/store-front/deploy/.env` | Real backend secrets (NOT git-tracked) |
| `/opt/infra/apps/store-front/deploy/sites.config.json` | Real per-site config (NOT git-tracked) |

## First-time deploy

1. **Clone** the repo onto the VPS:
   ```bash
   cd /opt/infra/apps
   git clone <repo-url> store-front
   cd store-front
   ```

2. **Build the sites** locally (or on the VPS — same result):
   ```bash
   pnpm install
   pnpm -r build
   ```
   Output goes to `sites/<business>/dist/` for each site.

3. **Create production config** files (not in git):
   ```bash
   cp deploy/.env.example deploy/.env
   cp deploy/sites.config.example.json deploy/sites.config.json
   $EDITOR deploy/.env                 # fill in SMTP, OpenAI, AWS, geocoder keys
   $EDITOR deploy/sites.config.json    # match production domains, contacts, pricing
   ```

4. **Make sure the `proxy` external network exists** (created by the system Nginx stack):
   ```bash
   docker network ls | grep proxy   # should show 'proxy' (external)
   ```

5. **Bring up the stack**:
   ```bash
   cd deploy
   docker compose up -d --build
   docker compose ps           # all three should be Up + healthy
   curl http://store-front-api:3000/api/health   # from another container on the proxy net, or skip
   ```

6. **Add a vhost per domain** to the system Nginx. For each site:
   ```bash
   # On the VPS
   cp /opt/infra/apps/store-front/deploy/proxy-vhost.template.conf \
      /opt/infra/proxy/nginx/conf.d/myhomeimprovementcompany.com.conf

   # Substitute placeholders
   sed -i 's/{{DOMAIN}}/myhomeimprovementcompany.com/g' \
          /opt/infra/proxy/nginx/conf.d/myhomeimprovementcompany.com.conf
   sed -i 's/{{STATIC_CONTAINER}}/store-front-home-improvement/g' \
          /opt/infra/proxy/nginx/conf.d/myhomeimprovementcompany.com.conf
   ```

   Repeat for `mypressurewashingcompany.com` with container `store-front-pressure-washing`.

7. **Issue TLS certs**:
   ```bash
   certbot certonly --webroot -w /opt/infra/proxy/webroot/ \
     -d myhomeimprovementcompany.com
   certbot certonly --webroot -w /opt/infra/proxy/webroot/ \
     -d mypressurewashingcompany.com
   ```

8. **Validate and reload** the system Nginx:
   ```bash
   docker exec proxy nginx -t
   docker exec proxy nginx -s reload
   ```

9. **Smoke test** in a browser:
   - Load each domain over HTTPS, confirm the marketing page renders
   - Open the chatbot bubble, ask a question, confirm streaming response
   - Walk the quote wizard to completion with test data
   - Check that the PDF arrives by email and lives at `s3://<bucket>/quotes/<id>/quote.pdf`

## Routine deploys

```bash
cd /opt/infra/apps/store-front
git pull
pnpm install
pnpm -r build
cd deploy
docker compose up -d --build
```

That rebuilds the static dist directories and the api container. The bind-mounts pick up the new `dist/` immediately; the api container restarts with the new image.

## Adding a new business

1. **Create the site folder** in the repo:
   ```bash
   cp -r sites/home-improvement sites/<new-business>
   ```
2. **Edit** `sites/<new-business>/`:
   - `package.json` — change `name` and the dev port
   - `astro.config.mjs` — set the production `SITE_URL`
   - `src/content/*.json` — brand, services, reviews, FAQ, process
   - `src/styles/theme.css` — new color palette
   - `public/images/` — replace all placeholders
   - `public/favicon.svg`, `public/robots.txt`
3. **Add a service block** to `deploy/compose.yml`, mirroring an existing `static-*` service. Use a unique `container_name`.
4. **Add a domain entry** to `deploy/sites.config.json` on the VPS (brand, owner email, chat prompt, pricing, service area, PDF theme).
5. **Update `ALLOWED_ORIGINS`** in `deploy/.env` on the VPS to include the new domain (with `https://`).
6. **Add a vhost** in `/opt/infra/proxy/nginx/conf.d/`, run certbot, reload nginx (steps 6–8 above).
7. **Deploy**:
   ```bash
   git pull && pnpm install && pnpm -r build && cd deploy && docker compose up -d --build
   ```

## Troubleshooting

| Symptom | Where to look |
|---|---|
| Wizard upload fails | `docker compose logs api`, check `S3_*` and `AWS_*` env vars; verify the IAM key has `s3:PutObject` on the bucket |
| Chat returns 403 | Origin mismatch — confirm the domain is in `ALLOWED_ORIGINS` and in `sites.config.json` |
| Chat returns 500 | Check `OPENAI_API_KEY` and account balance; logs include the OpenAI error |
| Submit succeeds but no email | SMTP creds; test by `docker compose logs api` for `sendQuoteEmail` errors |
| Static page is 502 | The static-* container isn't running or isn't on the `proxy` network. `docker compose ps`, `docker network inspect proxy` |
| Cert renewal failing | Confirm `webroot` mount and that the HTTP-only vhost block above is in place to serve `/.well-known/acme-challenge/` |
