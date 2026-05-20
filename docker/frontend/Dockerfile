FROM node:24-alpine AS builder

WORKDIR /app

RUN npm install -g pnpm

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig*.json ./
COPY lib/ ./lib/
COPY artifacts/dashboard/ ./artifacts/dashboard/

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @workspace/dashboard run build

FROM nginx:alpine AS runner

COPY --from=builder /app/artifacts/dashboard/dist/public /usr/share/nginx/html
COPY docker/frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
