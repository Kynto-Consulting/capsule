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
docker exec capsule-backend /app/server fn-node nodo-1
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
