# Stage 1: Lambda Web Adapter binary
FROM public.ecr.aws/awsguru/aws-lambda-adapter:0.8.4 AS lambda-adapter

# Stage 2: Build Next.js
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Stage 3: Runtime
FROM node:20-alpine AS runner
WORKDIR /app

# Lambda Web Adapter extension — translates Lambda invocations to HTTP requests
COPY --from=lambda-adapter /lambda-adapter /opt/extensions/lambda-adapter

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Port that Next.js standalone server listens on
ENV PORT=3000
# Lambda Web Adapter reads this to know which port to proxy to
ENV AWS_LWA_PORT=3000

# Copy standalone output (self-contained, no node_modules needed)
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000
CMD ["node", "server.js"]
