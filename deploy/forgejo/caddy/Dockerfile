# Caddy con limite de tasa (modulo comunitario mholt/caddy-ratelimit). OPCIONAL: sin esta imagen el servicio git-proxy usa la oficial
# y no hay limite de tasa en el borde (queda el del backend en /internal/git-auth). Para activarlo, en docker-compose.prod.yml:
#   git-proxy:  build: { context: ./deploy/forgejo/caddy }   (en lugar de image: caddy:2.11.7-alpine)
#               volumes: + ./deploy/forgejo/caddy/ratelimit.caddy:/etc/caddy/conf.d/ratelimit.caddy:ro
ARG CADDY_VERSION=2.11.7
FROM caddy:${CADDY_VERSION}-builder-alpine AS builder
# Versiones fijadas; la compilacion con estas versiones se probo en Windows con xcaddy 0.4.5 (no se probo esta imagen: no hay Docker).
RUN xcaddy build v${CADDY_VERSION} --with github.com/mholt/caddy-ratelimit@v0.1.0

FROM caddy:${CADDY_VERSION}-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
