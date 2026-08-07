FROM node:22-alpine

WORKDIR /app
COPY index.mjs ./index.mjs

ENV NODE_ENV=production
ENV PORT=3000
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/health || exit 1

CMD ["node", "index.mjs"]
