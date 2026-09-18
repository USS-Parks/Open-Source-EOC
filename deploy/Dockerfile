# OpenEOC API image (VEOC-40). Runs migrations and serves the API. The web
# bundle is built and served separately (see deploy/README.md). TypeScript is
# executed at runtime with tsx, installed into the image so the repository's
# frozen lockfile is never modified for deployment.
FROM node:22-slim

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
