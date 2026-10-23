# Persistent FluxDesk API, NOT a Vercel Function. Deploy only behind HTTPS.
FROM node:22-bookworm-slim AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.18.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 DATA_DIR=/data
WORKDIR /app
# The current API uses the tsx runtime; copy the locked full dependency tree.
# This is a single-process backend, not a horizontally scaled worker cluster.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/server ./server
COPY --from=builder /app/src ./src
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/scripts/archive-cli.ts ./scripts/archive-cli.ts
RUN mkdir -p /data && chown node:node /data
USER node:node
EXPOSE 8787
# Startup fails closed unless REVERSE_PROXY_OIDC=true or a valid gateway
# credential (32+ bytes) is provided. No credential is baked into the image.
CMD ["node", "--import", "tsx", "server/index.ts"]
