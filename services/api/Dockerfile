# syntax=docker/dockerfile:1.7
#
# Runtime-only image: relies on the host having already run `pnpm -r build`
# to produce ./dist. We install production deps in the container (flat node_modules
# via npm — pnpm workspace symlinks don't translate cleanly into Docker), then
# `node dist/server.js`.

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# Production dependencies only. Flat tree, no workspace symlinks.
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund \
 && npm cache clean --force

# Pre-built JS from the host (tsc output)
COPY dist ./dist

RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "dist/server.js"]
