# Runner de CI con escala a cero

El runner de Forgejo Actions (`aws_instance.ci_runner`, `capsule-ci-runner`, t3.small spot persistente con
comportamiento de interrupcion `stop`) no queda encendido todo el dia: se apaga solo cuando no tiene trabajo y el
backend de Capsule lo enciende cuando hay un push o un PR.

## Diagrama

```
 push / PR ──> Forgejo ──webhook──> Capsule API ──> bus de eventos (gitevents)
                                                      │  git.push, pr.opened, pr.updated, pr.ready_for_review
                                                      ▼
                                              ciwake (debounce 60 s, tope/hora)
                                                      │ DescribeInstances
                                                      │   stopped  ──> StartInstances
                                                      │   running/pending ──> nada
                                                      ▼
   EC2 runner  (boot ──> docker ──> forgejo-runner daemon ──> toma el job en cola)
        │
        │ cada minuto: forgejo-runner-idle-stop.timer
        │   uptime < 10 min (gracia)        -> contador = 0
        │   docker ps -q con contenedores   -> contador = 0   (job en curso)
        │   docker no responde              -> contador = 0   (se asume ocupado)
        │   sin contenedores                -> contador + 1
        │   contador >= 15                  -> systemctl poweroff  ==> estado `stopped`
        ▼
   stopped (sin computo; solo disco)
```

## Parte A: apagado (en el runner)

Archivos en `deploy/forgejo/runner-idle-stop/`:

| Archivo | Funcion |
|---|---|
| `idle-stop.sh` | Logica de decision (se instala en `/usr/local/sbin/forgejo-runner-idle-stop.sh`). |
| `forgejo-runner-idle-stop.service` / `.timer` | Oneshot + temporizador de 1 minuto (`OnBootSec=60`). |
| `install.sh` | Autocontenido e idempotente; lo genera `build-install.sh` desde los tres archivos anteriores. |
| `make-ssm-params.sh` | Imprime el JSON de parametros de `AWS-RunShellScript`. |
| `test.sh` | Prueba con `docker` y `poweroff` simulados. |

Como se sabe que hay un job: el runner ejecuta cada job en contenedores `GITEA-ACTIONS-TASK-*` /
`FORGEJO-ACTIONS-TASK-*` (y sus servicios) y el runner es el unico usuario de docker de la maquina, asi que
cualquier contenedor en ejecucion cuenta como actividad (`docker ps -q`). Si `docker ps` falla no se puede saber y
se asume ocupado. No se consultan los logs del demonio: el estado de los contenedores es la senal mas fiable y no
depende del formato de los logs. Un job en cola que el runner aun no tomo no es visible desde dentro; lo cubre el
periodo de gracia (10 min desde el boot).

Parametros en `/etc/forgejo-runner/idle-stop.env`: `IDLE_MINUTES` (15), `GRACE_MINUTES` (10).

Supuesto: los jobs corren en contenedores (las etiquetas del runner son de docker); un job de modo host no se detectaria. El contador vive en `/run` y se reinicia en cada boot.

### Instalarlo en el runner que ya existe (sin reemplazarlo)

El user_data de la instancia no se vuelve a ejecutar. Ademas `user_data_replace_on_change = true` en `runner.tf`:
verificado con `terraform plan -target=aws_instance.ci_runner` tras cambiar el user_data de prueba, resultado
`Plan: 1 to add, 0 to change, 1 to destroy` (reemplazo forzado). Por eso `runner.tf` y su plantilla NO se tocan y la
instalacion es solo por SSM:

```bash
cd deploy/forgejo/runner-idle-stop
bash build-install.sh                         # solo si cambiaste idle-stop.sh o las unidades
bash make-ssm-params.sh > ssm-params.json
MSYS_NO_PATHCONV=1 aws ssm send-command --profile tumi-admin --region us-east-1 \
  --instance-ids i-03e3e8ad27d3d8d85 --document-name AWS-RunShellScript \
  --parameters file://ssm-params.json --comment "runner idle-stop"
aws ssm get-command-invocation --command-id <id> --instance-id i-03e3e8ad27d3d8d85   # Status Success
```

Si en el futuro se recrea el runner por otro motivo, ejecutar el mismo comando una vez. El runner debe estar
encendido para recibir el comando (si esta `stopped`, enciendelo primero con `aws ec2 start-instances`).

## Parte B: encendido (backend)

Paquete `backend/internal/ciwake`. Se suscribe al bus (`git.push`, `pr.opened`, `pr.updated`,
`pr.ready_for_review`; `workflow.run.completed` no enciende nada: un run terminado no necesita runner). Ante un
evento con proyecto llama `DescribeInstances` y, solo si la instancia esta `stopped`, `StartInstances`:

* debounce de 60 s entre comprobaciones (los errores y el estado `stopping` no hacen debounce: el siguiente evento
  reintenta);
* tope de arranques por hora (`CAPSULE_CI_WAKE_MAX_PER_HOUR`, 6 por defecto) para cortar bucles y costo;
* `pending`/`running` -> no hace nada; `stopping` -> espera al siguiente evento; `terminated` o inexistente ->
  aviso en log;
* logs estructurados (instancia, motivo, estado) y contadores (`Waker.Stats()`); nunca credenciales;
* los eventos que publica el bus provienen de proyectos con repositorio en Git Capsule; los eventos sin proyecto se
  ignoran. `Handle` nunca devuelve error para que el bus no re-entregue.

Variables de entorno (`docker-compose.prod.yml` del backend):

| Variable | Efecto |
|---|---|
| `CAPSULE_CI_RUNNER_INSTANCE_ID` | `i-03e3e8ad27d3d8d85`; vacio = funcion apagada. |
| `CAPSULE_CI_WAKE_MAX_PER_HOUR` | Arranques maximos por hora (6). |
| `CAPSULE_CI_RUNNER_REGION` | Opcional; debe coincidir con `AWS_REGION` del backend (si no, se desactiva con aviso). |

Cableado: bloque `// ciwake:wiring begin/end` en `backend/cmd/server/main.go` (despues del bloque git-capsule: usa el bus).

## Parte C: permisos (Terraform)

`deploy/terraform/ci_runner_wake.tf`, detras de `ci_runner_enabled`: politica NUEVA `capsule-api-ci-runner-wake` en el
usuario IAM `capsule-api` con `ec2:StartInstances` solo sobre el ARN de la instancia y `ec2:DescribeInstances` (IAM no
admite restringirlo por recurso). Output `ci_runner_wake_instance_id`. Plan de solo lectura con `-target`: 1 a
crear, 0 a cambiar, 0 a destruir.

## Costos esperados

| Concepto | Encendido | Apagado |
|---|---|---|
| Computo t3.small (spot) | segun horas encendido | 0 |
| Disco gp3 30 GB | ~2,40 USD/mes (0,08 USD/GB-mes) | ~2,40 USD/mes (se sigue pagando) |
| IPv4 publica | solo mientras esta encendida (la IP publica automatica se libera al detenerse) | 0 |

Compute ≈ 0 apagado; el piso fijo es el disco. Verifica las tarifas vigentes en la pagina de precios de AWS.

## Latencia de arranque en frio

No hay una cifra oficial publicada por AWS para pasar de `stopped` a `running` y la cadena completa (boot de
Amazon Linux, `docker`, `runner-firewall`, `forgejo-runner` y registro en Forgejo) no esta medida en este
repositorio, asi que no se da un numero. Medir la primera vez: tras `StartInstances`, comparar la hora del evento
con el inicio del job en Forgejo, o `aws ec2 describe-instances` hasta `running` y luego `systemctl status
forgejo-runner` por SSM. El job queda en cola en Forgejo y arranca solo cuando el runner se conecta.

## Que pasa si un job llega durante el apagado

* Instancia `running` y en gracia/ocupada: el job lo toma el runner normalmente.
* Instancia `stopping` (ya ejecuto `poweroff`): `ciwake` no puede arrancarla; el job queda en cola y el siguiente
  evento (otro push/PR, tras el debounce) la enciende. Un push aislado en esa ventana de segundos puede quedar en
  cola hasta el siguiente evento o hasta encender el runner a mano (`aws ec2 start-instances --instance-ids
  i-03e3e8ad27d3d8d85`). Es la unica carrera sin cerrar del diseno.
* Instancia `stopped`: se enciende, vuelve a empezar la gracia de 10 minutos y toma el job.
* Spot: `StartInstances` sobre una instancia detenida puede fallar por falta de capacidad; queda en el log
  (`start failed`) y el siguiente evento reintenta. No verificado en esta cuenta.

## Reversa

* Backend: dejar `CAPSULE_CI_RUNNER_INSTANCE_ID` vacio y redesplegar (no se enciende nada).
* Runner: `touch /etc/forgejo-runner/idle-stop.disabled` por SSM (inmediato, no se apaga mas), o
  `systemctl disable --now forgejo-runner-idle-stop.timer`.
* Siempre encendido: ambas cosas, y encender la instancia (`aws ec2 start-instances ...`).
* Terraform: quitar `ci_runner_wake.tf` destruye solo la politica IAM nueva.

## Pruebas

```bash
cd backend && go test -count=1 ./internal/ciwake        # debounce, tope/hora, estados, errores SDK, filtro de eventos
bash deploy/forgejo/runner-idle-stop/test.sh              # gracia, contadores, docker simulado, apagado
```

## git en el host

El runner ejecuta `git` en el host (para clonar acciones como `actions/checkout`); sin el, todo job falla con
`exec: "git": executable file not found in $PATH`. `install.sh` lo instala si falta (`dnf install -y git`). En la
instancia actual ya esta (git 2.50.1). Cambiar el user_data de `runner.tf` fuerza el reemplazo, asi que la plantilla
no se toco: al recrear el runner, ejecutar `install.sh` por SSM o incorporar `git` a `runner_user_data.sh.tftpl`
en esa recreacion (nota en `runner.tf`).
