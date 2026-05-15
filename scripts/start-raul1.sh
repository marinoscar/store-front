#!/usr/bin/env bash
# Start (or restart) the home-improvement site at https://raul1.dev.marin.cr/
# Idempotent — safe to re-run anytime. Builds the site, brings up the shared
# api container + the raul1 nginx router, makes sure the host nginx map has
# the right entry, then smoke-tests the public URL.

set -euo pipefail
SITE_PKG="home-improvement"
SUBDOMAIN="raul1.dev.marin.cr"
PORT=8324
DOCKER_SERVICE="raul1"

# shellcheck source=./_common.sh
source "$(dirname "$0")/_common.sh"

run_full_start
