#!/usr/bin/env bash
# Start (or restart) the pressure-washing site at https://raul2.dev.marin.cr/
# Idempotent — safe to re-run anytime. Builds the site, brings up the shared
# api container + the raul2 nginx router, makes sure the host nginx map has
# the right entry, then smoke-tests the public URL.

set -euo pipefail
SITE_PKG="pressure-washing"
SUBDOMAIN="raul2.dev.marin.cr"
PORT=8325
DOCKER_SERVICE="raul2"

# shellcheck source=./_common.sh
source "$(dirname "$0")/_common.sh"

run_full_start
