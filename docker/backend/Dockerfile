# ── Stage 1: builder — full monorepo install + esbuild bundle ─────────────────
FROM node:22-alpine AS builder

RUN npm install -g pnpm@9 --quiet

WORKDIR /workspace

# Copy entire workspace (.dockerignore excludes node_modules, dist, .env, etc.)
COPY . .

# Install all workspace deps including devDeps (drizzle-kit lives in devDeps of lib/db)
RUN pnpm install --frozen-lockfile

# Bundle the API server — esbuild produces a fully self-contained dist/index.mjs
RUN pnpm --filter @workspace/api-server run build

# ── Stage 2: runner — only the compiled bundle, no source or node_modules ─────
FROM node:22-alpine AS runner

WORKDIR /app

# Copy the esbuild bundle (all workspace deps already bundled in)
COPY --from=builder /workspace/artifacts/api-server/dist ./dist

# Uploads dir — overridden by the named volume in compose
RUN mkdir -p uploads

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=6 \
  CMD wget -qO- http://localhost:8080/api/healthz || exit 1

CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
