# Proyecto de Capsule "renovate-bot": imagen de Renovate con version FIJADA + config del bot.
# Verifica que el tag existe: docker manifest inspect ghcr.io/renovatebot/renovate:39.100.0
FROM ghcr.io/renovatebot/renovate:39.100.0
COPY config.js /usr/src/app/config.js
ENV RENOVATE_CONFIG_FILE=/usr/src/app/config.js
# Sin servidor: Capsule ejecuta el comando del cron (`renovate`). EXPOSE para que Capsule detecte un puerto no es necesario
# para workers/crons; si el despliegue lo exige, el proyecto debe crearse como worker.
