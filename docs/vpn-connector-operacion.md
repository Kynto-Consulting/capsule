# VPN Connector: operación del nodo de trabajo

Diseño: `docs/vpn-connector.md`. Skill: `.claude/skills/capsule/references/vpn-funciones.md`.

## 1. Piezas y dónde corren

| Pieza | Dónde | Notas |
|---|---|---|
| API, planificador de crons, cola, tokens `capfn_`, auditoría | backend de Capsule (`capsule-builder`) | no abre túneles ni ejecuta funciones |
| `capsule-fn-agent` + gateways + contenedores de funciones | **nodo de trabajo** (nunca `capsule-builder`) | solo conexiones salientes hacia `CAPSULE_API_URL` |
| Migración `000073_vpn_functions` | se aplica sola al arrancar el backend | aditiva; el `down` borra solo sus tablas |

## 2. Dar de alta un nodo

```bash
# en el backend (una vez por nodo; imprime el token capnode_ una sola vez)
docker exec capsule-backend /capsule-server fn-node nodo-1   # en producción el binario es /capsule-server (no /app/server)
```

En el nodo (Linux con Docker; para fortigate/ipsec/openvpn además `iproute2`, `iptables` y las herramientas del proveedor):

```bash
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o capsule-fn-agent ./cmd/capsule-fn-agent   # se compila en el PC, no en el host
CAPSULE_API_URL=https://api.tumi-ai.com CAPSULE_NODE_TOKEN=capnode_... ./capsule-fn-agent
```

Variables: `CAPSULE_FN_SOCKS_ROOT` (por omisión `/run/capsule/fn`), `CAPSULE_FN_PARALLEL` (corridas a la vez en el nodo, 2).
Unidad systemd sugerida: `Restart=always`, `User=root` solo si se usan netns (WireGuard no lo necesita más allá de acceso a Docker).
El backend entrega las credenciales del túnel solo a un nodo con token válido y solo para una corrida cuyo túnel esté habilitado.

## 3. Opciones para el nodo (decisión pendiente del usuario; no se creó nada en AWS)

| Opción | Costo recurrente | Seguridad | Veredicto |
|---|---|---|---|
| **A. EC2 `capsule-fn-node` t3.small spot, escala a cero** (patrón de `ci-runner-scale-to-zero.md`: `ciwake` lo enciende al haber una corrida en cola; se apaga tras 15 min sin contenedores) | cómputo solo mientras corre (~USD 0,007/h) + EBS 8 GB ≈ USD 0,64/mes | aislado del host de builds y de los datos de producción | **recomendada** |
| B. El PC o un servidor del estudio con el agente | 0 | los datos del estudio no salen de su red; depende de que esté encendido | válida para pruebas y para el go-live si el estudio lo prefiere |
| C. Una segunda instancia permanente | fijo (el usuario no lo quiere) | igual que A | descartada |
| D. `capsule-builder` | 0 | mezcla datos con builds; ya se congeló una vez | prohibida |

Para A falta (cuando el usuario apruebe): recurso Terraform análogo a `runner.tf`, rol de instancia sin permisos de datos, `user_data`
que instala Docker y el agente con el token del nodo desde SSM, y la generalización de `ciwake` para encender el nodo ante una corrida en cola
(`fn_runs.status='queued'` hace más de 30 s y nodo detenido).

El `user_data` de `deploy/terraform/fn_node.tf` ya compila `openfortivpn` desde el código fuente (Amazon Linux 2023 no lo trae en sus
repos) y renueva el login de Docker a ECR de esta cuenta cada 6 horas (el rol del nodo tiene permiso de lectura de cualquier repo de
este registro). Nada de esto hace falta si la imagen de la función vive en Docker Hub u otro registro público.
El runtime por defecto (`container`, corre en este nodo) basta para una función con túnel: el runtime `lambda` igual necesita el nodo
vivo para el túnel (ver 5b.), así que no simplifica nada aquí.

### 3b. Nodo en la Local Zone de Lima (06-nov-2026)

El FortiGate del estudio filtraba la IP del nodo (Virginia) y la TI no la iba a abrir. En vez de pedirle esa excepción,
el nodo se movió a `us-east-1-lim-1a`: una Local Zone de AWS físicamente en Lima pero dentro de la misma cuenta/VPC/región
`us-east-1` (solo es una subred nueva, `172.31.96.0/24`). Así el nodo sale con una IP peruana y, si el FortiGate solo
filtra por país, puede entrar sin que nadie en el estudio toque nada.

- `fn_node.tf` hace el opt-in a la zone group (`aws_ec2_availability_zone_group`, una vez por cuenta/región) y crea la
  subred ahí; el resto (rol, SG, agente) no cambió.
- La IP ahora es fija (`aws_eip` + `aws_eip_association`, output `fn_node_static_ip`): antes, al ser Spot con
  `instance_interruption_behavior = "stop"`, el nodo perdía su IP pública cada vez que una interrupción lo detenía y
  volvía a arrancar — habría roto cualquier regla de la TI basada en IP.
- Se quitó el Spot: las Local Zones normalmente no tienen mercado Spot (antes del opt-in, `describe-instance-type-offerings`
  en `us-east-1-lim-1a` no devolvió ningún tipo de instancia), y una interrupción además tira el túnel FortiGate. El nodo
  ahora es on-demand; el costo por hora en la Local Zone suele ser mayor que en `us-east-1` normal.
- Catálogo reducido de esta Local Zone, encontrado al aplicar (06-nov-2026): sin `t3.small` (el mínimo es `t3.medium`,
  por eso `fn_node_instance_type` cambió de default) y sin `gp3` en el volumen raíz (toca `gp2`). Si se cambia el
  `instance_type` de nuevo, revisar antes con `describe-instance-type-offerings --filters Name=location,Values=us-east-1-lim-1a`.
- La Elastic IP necesita `network_border_group = "us-east-1-lim-1"`: una EIP normal de `us-east-1` no se puede asociar
  a una instancia de una Local Zone (`AssociateAddress: OperationNotPermitted`).
- `data.aws_availability_zones.available` y `data.aws_subnets.default` (`main.tf`) ahora excluyen Local Zones
  (`filter { name = "zone-type" / "availability-zone" }`): sin eso, el opt-in a Lima metía la subred del nodo en el
  `for_each` de `ipv6.tf` (reordenaba el índice de TODAS las demás subredes IPv6 de producción, casi las reemplaza)
  y en el `aws_db_subnet_group` de RDS. Si se opta por otra Local Zone/Wavelength en el futuro, ese filtro ya las cubre.
- Bug de sangría en el `user_data` (ya corregido): los `cat <<UNIT ... UNIT` anidados dentro del heredoc `<<-EOT` de
  Terraform conservan la sangría del HCL, y un heredoc de bash sin `<<-` exige el delimitador en la columna 0 — por
  eso el primer `cat` nunca cerraba y se comía el resto del script (ni el timer de ECR ni la unidad del agente se
  creaban). Los delimitadores de cierre ahora van sin sangría.
- Esto reemplaza la instancia existente (subred nueva = recrear, no hay forma de "mover" una instancia de AZ);
  el plan guardado `fn_node.tfplan` quedó obsoleto, hay que generar uno nuevo. Tras el `apply`, el token guardado en
  SSM sigue sirviendo (no cambia), pero el nodo vuelve a aparecer `offline` hasta que el agente levante de nuevo — es
  normal, el `user_data` lo hace solo al arrancar. Dale la IP del output `fn_node_static_ip` a la TI del estudio.

## 4. Salud, reconexión, interruptor

* El agente reporta cada tunel cada 10 s (`up` si hubo apretón de manos en los últimos 3 min); `capsule vpn status` y el panel lo muestran.
  WireGuard reconecta solo (keepalive 25 s); los proveedores de kernel se reinician bajo supervisión y quedan `error` si no levantan en 90 s.
* `capsule vpn off <nombre>`: marca el túnel como apagado, cancela y revoca las corridas que lo usan; el agente baja el gateway en ≤ 10 s
  (el siguiente `sync`) y `claim` deja de entregar credenciales. Un gateway no puede reportar `up` un túnel apagado.
* Cada conexión, cada corrida (quién la lanzó, alcances, bytes) y cada destino denegado quedan en `vpn_events` (`capsule vpn logs`).

## 5. Topes

* Por túnel: `max_conns` (4) conexiones simultáneas y `bandwidth_bps` (8 MiB/s), compartidos entre todas las corridas del túnel.
* Por función: `max_concurrency` (1), memoria sin swap, CPU, `--pids-limit 256`, FS de solo lectura, sin capacidades, tiempo máximo.
* Una función con cron no se apila: si ya hay una corrida en cola, no se encola otra.

## 5b. Runtime `lambda` (opcional)

Se enciende con `CAPSULE_FN_LAMBDA=true` en el backend; sin eso `capsule fn deploy --runtime lambda` se rechaza. Requisitos: una imagen de la
función en ECR basada en una imagen Lambda de Node con `export const handler = lambdaHandler(defineFunction(...))` (`@kyntocg/capsule-fn`), y el
rol `capsule-lambda-role`. Para funciones con túnel, el nodo de trabajo debe estar vivo: él mantiene el túnel y se adjunta al relé de la API
(solo conexiones salientes; no se abre ningún puerto). Ver `docs/vpn-connector.md`, sección 7.

## 6. Pasos que ejecuta el usuario (AWS y producción)

Requieren la sesión `aws login --profile tumi-admin`. En PowerShell, desde `deploy/terraform`:

```powershell
$env:AWS_PROFILE = "tumi-admin"   # si terraform no encuentra credenciales: aws configure export-credentials --profile tumi-admin --format powershell | iex
# 1. subir el agente (compilado en el PC)
cd ..\..\backend
$env:CGO_ENABLED="0"; $env:GOOS="linux"; $env:GOARCH="amd64"; go build -o capsule-fn-agent .\cmd\capsule-fn-agent
Remove-Item Env:GOOS, Env:GOARCH, Env:CGO_ENABLED
# comprimir a .gz (7z a -tgzip capsule-fn-agent.gz capsule-fn-agent) y:
aws s3 cp capsule-fn-agent.gz s3://capsule-artifacts-598806201852/deploy/capsule-fn-agent.gz
# 2. plan guardado (revisable): deben ser 6 recursos nuevos y 0 cambios/destrucciones
cd ..\deploy\terraform
terraform plan -var fn_node_enabled=true "-target=aws_instance.fn_node" "-target=aws_iam_role_policy.fn_node" "-target=aws_iam_role_policy_attachment.fn_node_ssm" -out fn_node.tfplan
terraform show fn_node.tfplan
terraform apply fn_node.tfplan
```

Después: desplegar el backend con la migración `000073` (binario por S3, sin compilar en el host), `server fn-node nodo-1`, guardar el token con
`aws ssm put-parameter --name /capsule/fn-node/token --type SecureString --value capnode_...`, reiniciar el servicio (`aws ssm start-session` al nodo:
`systemctl restart capsule-fn-agent`) y comprobar `capsule vpn status` y `journalctl -u capsule-fn-agent`. El plan guardado `fn_node.tfplan` ya existe en esa carpeta.

## 7. Builds de imágenes de funciones (`capsule fn deploy --source`)

Ver `docs/vpn-connector.md` 7b. Corren en el host `capsule-builder` dentro del worker de despliegue, en la misma cola que los despliegues
(uno a la vez); no hace falta nada en el nodo ni en AWS a mano: el backend crea `capsule/fn-<id>` en ECR con sus permisos (`ecr:*`).
Requisito: el backend con AWS configurado (`awsClients.ECR`) y la migración `000077_fn_builds` (se aplica sola al arrancar).
Revisión: `capsule fn builds <nombre>`, `capsule fn build-log <id>`; en el host, `docker logs capsule-backend | grep "function build"`.

## 8. Desplegar backend y CLI (lo hace el usuario; nunca compilar Go en el host)

El SSH de administración del host está en el puerto **2200** (el 22 es el SSH de Git de Forgejo). El binario del backend en producción es
**`/capsule-server`** (imagen `capsule/server`, `ENTRYPOINT ["/capsule-server"]`), no `/app/server`.

1. Backend, cross-compile en el PC (PowerShell, desde `backend`):
   `$env:CGO_ENABLED="0"; $env:GOOS="linux"; $env:GOARCH="amd64"; go build -trimpath -ldflags "-s -w" -o capsule-server .\cmd\server; Remove-Item Env:GOOS, Env:GOARCH, Env:CGO_ENABLED`
2. Comprimir y subir: `7z a -tgzip capsule-server.gz capsule-server` y
   `aws s3 cp capsule-server.gz s3://capsule-artifacts-598806201852/deploy/capsule-server.gz --profile tumi-admin`.
3. En el host (`ssh -p 2200 …`), sin ningún build en curso (`pgrep -f "docker build"` vacío y `capsule deployments list` sin `building`):
   etiquetar la imagen actual para volver atrás, bajar el `.gz`, `docker build` de un Dockerfile mínimo
   (`FROM alpine` + `RUN apk add --no-cache ca-certificates tzdata docker-cli docker-cli-buildx nodejs npm zip git` + `COPY capsule-server /capsule-server`
   + `ENTRYPOINT ["/capsule-server"]`) etiquetado como `capsule/server:latest` del ECR, y `docker compose -f docker-compose.prod.yml up -d --no-deps backend`.
   Nunca `up` del gateway. La migración `000077_fn_builds` se aplica sola al arrancar.
4. CLI (desde `cli`): `foreach ($t in "windows/amd64","linux/amd64","darwin/arm64") { $o,$a = $t.Split("/"); $env:GOOS=$o; $env:GOARCH=$a; $env:CGO_ENABLED="0"; go build -trimpath -o "dist\capsule-$o-$a$(if($o -eq 'windows'){'.exe'})" .\cmd\capsule }`
   y publicar como las versiones anteriores del CLI.
