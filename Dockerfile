# RupAI Phase 1 backend. One image: build, then on start apply migrations and run the API.
# The full toolchain stays in the image so `docker compose exec api npm run seed` works.
FROM node:24-bookworm-slim
WORKDIR /app
ENV PRISMA_HIDE_UPDATE_MESSAGE=1
# The Prisma CLI's schema engine needs OpenSSL, which the slim image lacks.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma/schema.prisma ./prisma/schema.prisma
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build
ENV NODE_ENV=production PORT=4100 UPLOAD_DIR=/app/uploads
RUN mkdir -p /app/uploads
EXPOSE 4100
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4100/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
