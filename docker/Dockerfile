# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/cli/package.json packages/cli/
COPY packages/kon/package.json packages/kon/

RUN npm ci

COPY packages/ packages/

RUN npx turbo build

# Stage 2: Production
FROM node:20-alpine AS runtime

RUN addgroup -S kond && adduser -S kond -G kond

WORKDIR /app

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/packages/shared/package.json packages/shared/
COPY --from=builder /app/packages/server/package.json packages/server/
COPY --from=builder /app/packages/cli/package.json packages/cli/

RUN npm ci --omit=dev

COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/packages/server/dist packages/server/dist
COPY --from=builder /app/packages/cli/dist packages/cli/dist

VOLUME /data

ENV KON_MODE=server
ENV NODE_ENV=production

USER kond

EXPOSE 7443

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:7443/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

ENTRYPOINT ["node", "packages/cli/dist/index.js"]
CMD ["start", "--config", "/data/kon.config.json"]
