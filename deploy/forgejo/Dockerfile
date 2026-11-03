# Imagen SOLO para el respaldo (servicio `git-backup` de docker-compose.prod.yml, profile "backup").
# El servicio `git` usa la imagen oficial sin modificar; su configuracion son variables FORGEJO__* del compose.
# Anade aws-cli y openssl para subir el dump cifrado a S3 y trae los scripts de administracion.
# Verifica que el tag existe antes de construir: docker manifest inspect codeberg.org/forgejo/forgejo:<tag>
ARG FORGEJO_VERSION=15.0.11
FROM codeberg.org/forgejo/forgejo:${FORGEJO_VERSION}

RUN apk add --no-cache aws-cli openssl bash

COPY scripts/forgejo-backup.sh scripts/forgejo-bootstrap.sh /usr/local/bin/
RUN chmod 0755 /usr/local/bin/forgejo-backup.sh /usr/local/bin/forgejo-bootstrap.sh
