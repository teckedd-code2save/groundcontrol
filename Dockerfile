# syntax=docker/dockerfile:1
FROM node:22-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

# Rebuild the source code only when needed
FROM base AS builder
RUN apk add --no-cache openssl
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN npx prisma generate
RUN npm run build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

LABEL org.opencontainers.image.source="https://github.com/teckedd-code2save/groundcontrol"
LABEL org.opencontainers.image.description="groundcontrol — Next.js app"
LABEL org.opencontainers.image.licenses="UNLICENSED"

# Install Docker CLI + Compose plugin for host Docker socket management.
RUN apk add --no-cache openssl docker-cli docker-cli-compose procps wget

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules ./node_modules

# Schema + migrations at an UNMASKED path: the groundcontrol-db volume mounts
# over /app/prisma at runtime, hiding the image copy. The entrypoint migrates
# the volume-resident DB using /app/db/schema.prisma.
COPY --from=builder /app/prisma /app/db

COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# Ensure db directory exists for SQLite
RUN mkdir -p /app/prisma

EXPOSE 3000

ENTRYPOINT ["/app/docker-entrypoint.sh"]
