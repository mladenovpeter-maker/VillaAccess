# ── Stage 1: builder — install deps + vite production build ───────────────────
FROM node:22-alpine AS builder

RUN npm install -g pnpm@10 --quiet

WORKDIR /workspace

# Copy entire workspace (.dockerignore excludes node_modules, dist, .env, etc.)
COPY . .

RUN pnpm install --frozen-lockfile

# BASE_PATH=/ → assets served from root so nginx SPA works correctly
# PORT can be any valid number for the build step; it's not embedded in output
# NODE_ENV=production skips Replit-only dev plugins (cartographer, etc.)
ENV NODE_ENV=production \
    BASE_PATH=/ \
    PORT=3000

RUN pnpm --filter @workspace/dashboard run build

# ── Stage 2: runner — nginx serves static build + proxies /api to backend ─────
FROM nginx:alpine AS runner

COPY --from=builder /workspace/artifacts/dashboard/dist/public /usr/share/nginx/html
COPY docker/frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
