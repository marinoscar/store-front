#!/usr/bin/env bash
# Shared helpers sourced by scripts/start-*.sh.
#
# Each caller sets these vars before sourcing:
#   SITE_PKG        — pnpm workspace package name (e.g. "home-improvement")
#   SUBDOMAIN       — public hostname (e.g. "raul1.dev.marin.cr")
#   PORT            — host-bound port in deploy/compose.yml (e.g. 8324)
#   DOCKER_SERVICE  — compose service name (e.g. "raul1")

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/deploy/compose.yml"
WILDCARD_CONF="/etc/nginx/sites-available/dev-wildcard"

ensure_pnpm() {
  if ! command -v pnpm >/dev/null 2>&1; then
    echo "→ enabling pnpm via corepack"
    corepack enable >/dev/null 2>&1
    corepack prepare pnpm@9.12.0 --activate >/dev/null 2>&1
  fi
}

ensure_node_modules() {
  if [[ ! -d "$REPO_ROOT/node_modules" ]]; then
    echo "→ pnpm install"
    (cd "$REPO_ROOT" && pnpm install)
  fi
}

build_site_and_api() {
  echo "→ building $SITE_PKG + api"
  (cd "$REPO_ROOT" && pnpm --filter "$SITE_PKG" --filter api build)
}

ensure_runtime_config_readable() {
  # The api container runs as a different uid than the host owner — file perms
  # must allow it to read sites.config.json (security comes from directory perms
  # on the host, not from file perms on a bind-mounted runtime config).
  if [[ -f "$REPO_ROOT/deploy/sites.config.json" ]]; then
    chmod 644 "$REPO_ROOT/deploy/sites.config.json"
  else
    echo "⚠  $REPO_ROOT/deploy/sites.config.json is missing. Copy from sites.config.example.json and edit."
    exit 1
  fi
  if [[ ! -f "$REPO_ROOT/deploy/.env" ]]; then
    echo "⚠  $REPO_ROOT/deploy/.env is missing. Copy from .env.example and edit."
    exit 1
  fi
}

bring_up_docker() {
  echo "→ docker compose up: api + $DOCKER_SERVICE"
  docker compose -f "$COMPOSE_FILE" up -d --build api "$DOCKER_SERVICE"
}

ensure_wildcard_entry() {
  # Only insert if the exact `<subdomain>   <port>;` line isn't already present.
  if ! sudo grep -qE "^\s*${SUBDOMAIN//./\\.}\s+${PORT};" "$WILDCARD_CONF"; then
    echo "→ adding ${SUBDOMAIN} → ${PORT} to ${WILDCARD_CONF}"
    sudo sed -i "/^map \$host \$backend_port {/a\\    ${SUBDOMAIN}        ${PORT};" "$WILDCARD_CONF"
    sudo nginx -t
    sudo systemctl reload nginx
    echo "  ✓ host nginx reloaded"
  else
    echo "→ host nginx map already has ${SUBDOMAIN} → ${PORT}"
  fi
}

smoke_test() {
  echo "→ smoke test"
  sleep 2
  local fail=0
  for path in "/" "/api/health"; do
    local code
    code=$(curl -sS --resolve "${SUBDOMAIN}:443:127.0.0.1" \
                 -o /dev/null -w "%{http_code}" \
                 "https://${SUBDOMAIN}${path}")
    if [[ "$code" == "200" ]]; then
      printf "  ✓ https://%s%s  HTTP %s\n" "$SUBDOMAIN" "$path" "$code"
    else
      printf "  ✗ https://%s%s  HTTP %s\n" "$SUBDOMAIN" "$path" "$code"
      fail=1
    fi
  done
  return $fail
}

run_full_start() {
  ensure_pnpm
  ensure_node_modules
  build_site_and_api
  ensure_runtime_config_readable
  bring_up_docker
  ensure_wildcard_entry
  smoke_test
  local rc=$?
  echo ""
  if [[ $rc -eq 0 ]]; then
    echo "✓ Live at https://${SUBDOMAIN}/"
  else
    echo "⚠  Site started but smoke test reported a non-200 status."
    echo "   Check logs: docker compose -f $COMPOSE_FILE logs -f api ${DOCKER_SERVICE}"
  fi
  return $rc
}
