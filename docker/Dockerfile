# Build with the repository root as the context:
# docker build --target api -f docker/Dockerfile -t rce-api:local .
# docker build --target worker -f docker/Dockerfile -t rce-worker:local .
# docker build --target client -f docker/Dockerfile -t rce-client:local .

FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat openssl
WORKDIR /repo
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
COPY application/apps/api-server/package.json application/apps/api-server/package.json
COPY application/apps/client/package.json application/apps/client/package.json
COPY application/apps/worker-node/package.json application/apps/worker-node/package.json
COPY application/packages/database/package.json application/packages/database/package.json
COPY application/packages/database/prisma.config.ts application/packages/database/prisma.config.ts
COPY application/packages/database/prisma/schema.prisma application/packages/database/prisma/schema.prisma
COPY application/packages/queue/package.json application/packages/queue/package.json
COPY application/packages/shared-types/package.json application/packages/shared-types/package.json
COPY application/packages/storage/package.json application/packages/storage/package.json
RUN npm ci
RUN cd application/packages/database \
    && DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build npx prisma generate

FROM deps AS build
COPY application/ application/
RUN npm run build --workspace=client

FROM base AS api
ENV NODE_ENV=production \
    PRISMA_SKIP_POSTINSTALL_GENERATE=true
COPY package.json package-lock.json ./
COPY application/ application/
RUN npm ci --omit=dev \
    --workspace=api-server \
    --workspace=database \
    --workspace=queue \
    --workspace=storage \
    --include-workspace-root
COPY --from=deps /repo/node_modules/.prisma /repo/node_modules/.prisma
USER node
EXPOSE 8000
CMD ["./node_modules/.bin/tsx", "application/apps/api-server/src/index.ts"]

FROM base AS worker
ENV NODE_ENV=production \
    PRISMA_SKIP_POSTINSTALL_GENERATE=true
COPY package.json package-lock.json ./
COPY application/ application/
RUN npm ci --omit=dev \
    --workspace=worker-node \
    --workspace=database \
    --workspace=queue \
    --workspace=storage \
    --include-workspace-root
COPY --from=deps /repo/node_modules/.prisma /repo/node_modules/.prisma
USER node
CMD ["./node_modules/.bin/tsx", "application/apps/worker-node/src/index.ts"]

FROM base AS client
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /repo/application/apps/client/.next/standalone/ ./
COPY --from=build --chown=node:node /repo/application/apps/client/.next/static ./application/apps/client/.next/static
COPY --from=build --chown=node:node /repo/application/apps/client/public ./application/apps/client/public
USER node
EXPOSE 3000
CMD ["node", "application/apps/client/server.js"]
