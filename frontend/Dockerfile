FROM oven/bun:1-alpine AS base
WORKDIR /app

FROM base AS development
COPY package.json bun.lock* ./
RUN bun install
COPY . .
EXPOSE 3000
CMD ["bun", "run", "dev"]

FROM base AS deps
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

FROM base AS builder
ARG NEXT_PUBLIC_API_URL=https://api.tumi-ai.com
ARG NEXT_PUBLIC_WS_URL=wss://api.tumi-ai.com
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_WS_URL=${NEXT_PUBLIC_WS_URL}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run build

FROM node:20-alpine AS production
WORKDIR /app
ARG NEXT_PUBLIC_API_URL=https://api.tumi-ai.com
ARG NEXT_PUBLIC_WS_URL=wss://api.tumi-ai.com
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_WS_URL=${NEXT_PUBLIC_WS_URL}
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
