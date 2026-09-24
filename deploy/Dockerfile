# OpenEOC images, built from the repository root (see deploy/README.md).
# Target `api` runs migrations and serves the API. TypeScript is executed at
# runtime with tsx, installed into the image so the repository's frozen
# lockfile is never modified for deployment. Target `web` is Caddy with the
# built web bundle, the TLS front end of the compose stack.
FROM node:22-slim AS api

# corepack ships with Node; it pins the pnpm version the repo expects.
RUN corepack enable && npm install -g tsx@4

WORKDIR /app
COPY . /app
RUN pnpm install --frozen-lockfile

ENV HOST=0.0.0.0
ENV PORT=8080
EXPOSE 8080

# migrate + seed + listen (server/src/main.ts guards its own boot).
CMD ["tsx", "server/src/main.ts"]

# The web bundle loads the runtime config script ahead of the app, as the
# Windows static host does. The build fails if the tag did not go in.
FROM api AS web-build
RUN pnpm --filter @openeoc/web build \
  && sed -i 's#</head>#<script src="/runtime-config.js"></script></head>#' web/dist/index.html \
  && grep -q 'src="/runtime-config.js"' web/dist/index.html

FROM caddy:2.10.0-alpine AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=web-build /app/web/dist /srv/web
