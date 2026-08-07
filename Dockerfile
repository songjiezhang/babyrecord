FROM node:22-alpine AS builder

WORKDIR /app
RUN npm install --global pnpm@9.15.5

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY app.json index.ts tsconfig.json App.tsx ./
COPY src ./src
RUN pnpm exec expo export --platform web --output-dir dist

FROM nginx:1.27-alpine

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/health || exit 1
