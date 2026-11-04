# Gateway: plan de recursos del host

Host: un EC2 t3.medium (2 vCPU con créditos, ~3,8 GB de RAM útil) que ya corre backend, frontend, Redis, Forgejo (768 MB de tope), Caddy (128 MB), el trabajo de respaldo de Forgejo (512 MB, solo cuando corre) y los contenedores de proyecto y las bases de los clientes. Convención: **(medido)** = prototipo en WSL, loopback (`docs/gateway/spikes/results/`); **(derivado)** = cálculo a partir de lo medido; **(?)** = no verificado en el host real.

## 1. Cuánta memoria puede usar el gateway

Lo que consta en el compose de producción: solo Forgejo (768m), git-proxy (128m), git-backup (512m) y Redis (`maxmemory 256mb`) tienen tope. **Backend, frontend y los contenedores de proyecto no tienen tope**, y la RAM libre actual del host no está medida (**?**: hace falta `free -m` y `docker stats --no-stream` en el servidor; `verify.sh --host` los imprime, solo lectura). Por eso el gateway se dimensiona por tramos y se sube solo con medición:

| Tramo | `mem_limit` | `GOMEMLIMIT` | `CAPSULE_GW_MAX_CONNS` (de ellas, con TLS terminado) | Cuándo |
|---|---|---|---|---|
| F1 (PostgreSQL por SNI, 8443 de pruebas) | 384m (por defecto del compose) | 300MiB | 6000 (1500) | Hasta medir el host real |
| F2 (toma el 443, MySQL/Redis/Mongo, túnel) | 512m (presupuesto del plan, sección 15) | 400MiB | 6000 (1500) o más si se mide | Tras una semana de `docker stats` con margen libre ≥ 800 MB |
| Tope absoluto | 512m | — | — | Más allá exige decidir una instancia mayor, no subir el tope |

512 MB es ~13 % de la RAM. Derivación de las conexiones (cifras medidas: ~25-28 KB por conexión en passthrough, ~75 KB terminando TLS, base 5,6 MB; Caddy-l4 base 45 MB): 4500 passthrough × 28 KB = 126 MB, más 1500 terminadas × 75 KB = 112 MB, más base y tabla de rutas (< 50 MB) = **~290 MB de memoria de usuario (derivado)**. El resto de los 384-512 MB es margen para lo que el prototipo no mide:

- **El GC de Go retiene memoria**: tras cerrar 4000 conexiones el RSS no bajó (157 MB, medido). El margen debe cubrir ese pico residual.
- **Memoria del kernel de los sockets**: con cgroup v2 los buffers TCP de los sockets del contenedor se cargan a su `memory.max` (**?**, depende de la versión del kernel/Docker del host). Una conexión ociosa cuesta pocos KB; una conexión con tráfico sostenido puede crecer hasta el autoajuste de `tcp_rmem`/`tcp_wmem` (cientos de KB). El prototipo estaba ocioso, así que **6000 conexiones activas a la vez no están medidas**.
- Cada puerto arrendado del pool es un listener (~unos KB, 3.4 del plan): 10 000 listeners ≈ decenas de MB (derivado, no medido).

## 2. Qué pasa al llegar al límite (de menos a más grave)

| Límite | Síntoma | Qué hace el sistema | Qué se ve |
|---|---|---|---|
| `CAPSULE_GW_MAX_CONNS` / `_PER_IP` / `_PER_PROJECT` / tasa | Conexiones nuevas rechazadas | El gateway cierra la conexión nueva de inmediato (TLS: sin respuesta; túnel `capsule/1`: `CAPR` status 5 con `retry_after`). **Las conexiones existentes no se tocan** | `gw_conns_total{result="limit"}`; alerta al 80 % |
| `GOMEMLIMIT` | El GC corre más seguido | Sube la CPU; no se pierde ninguna conexión. En un t3 la CPU tiene **créditos**: si se agotan, el host entero se estrangula (backend y Forgejo incluidos) | CPU del contenedor alta sostenida; créditos en CloudWatch (**?** si el modo es `unlimited`) |
| `nofile` (131072) | `accept: too many open files` | Con 6 descriptores por conexión en passthrough (sección 3) el límite equivale a ~20 000 conexiones: queda por encima de `MAX_CONNS` a propósito, no debería alcanzarse. **Aviso para G4:** el prototipo hace `continue` sin pausa ante un error de `Accept` (bucle activo al 100 % de CPU con EMFILE); el binario real debe esperar ~50 ms y contar el error | Errores de accept en el log |
| `mem_limit` del contenedor | **El kernel mata el proceso (exit 137)** | Docker lo reinicia (`restart: always`, ~2-5 s). **Se cortan todas las conexiones del gateway** (sesiones SSH, bases); las bases siguen vivas y los **puertos directos 40000-41999 no se ven afectados** (son el respaldo, por eso se mantienen). Hasta que `/readyz` vuelva (tabla de rutas desde el control) el gateway no sirve | `docker inspect` `OOMKilled=true`; evento en `docker events` |
| RAM del host agotada | OOM global del kernel | `oom_score_adj: 300` hace que el gateway sea candidato **antes** que Forgejo, backend o las bases (valor por defecto 0). Sin swap (**?**, no verificado en el host) no hay amortiguación | Mensajes `Out of memory` en `dmesg` |

Acciones tras un OOM: no subir el tope a ciegas; comprobar `gw_conns_active`, la proporción de conexiones terminadas y la memoria del host. Si el host no tiene RAM libre, el gateway no es el problema que se arregla con más tope.

## 3. Los 6 descriptores por conexión (anomalía de la sección 9 del plan): explicada y medida

Hallazgo del plan: en passthrough 500 conexiones = 3008 descriptores (6 por conexión) frente a 1008 (2 por conexión) al terminar TLS. **Causa:** en passthrough `common.Pipe` hace `io.Copy` entre dos `*net.TCPConn`; en Linux Go lo implementa con `splice(2)` y reserva **un par de pipes del kernel por sentido** mientras la copia está bloqueada: 2 sockets + 2 sentidos × 2 extremos de pipe = **6**. Al terminar TLS el origen es un `*tls.Conn`, no hay splice y bastan los 2 sockets.

**Comprobación (medida en WSL, gateway del prototipo, 200 conexiones ociosas en passthrough):** 1208 descriptores = 400 sockets + **800 `pipe:`** + 8 de base (el listado `ls -l /proc/<pid>/fd` por tipo). Es decir, 2 sockets y 4 pipes por conexión.

Consecuencias y decisión:
- **No es una fuga.** Los pipes se liberan al cerrar la conexión (tras cerrar las 4000 conexiones el recuento volvió a 8, `gw-mem.txt`).
- Los pipes no ocupan RAM de usuario (no aparecen en el RSS medido) y las páginas del buffer del pipe se reservan al llevar datos; mantienen un descriptor y estructuras del kernel. **Se conserva el splice**: copia sin pasar por memoria de usuario (menos CPU) y evitaría 2 búferes de 32 KB por conexión que sí saldrían del RSS si se desactivara.
- **Dimensionar `nofile` a 6 por conexión + 1 por puerto de pool + holgura:** `6 × 6000 = 36 000` + `10 000` (pool) + `~1000` = 47 000; el valor de 131 072 deja más del doble de margen. Terminando TLS bastan 2 por conexión.
- Si algún día se quisiera desactivar el splice, es envolver el `net.Conn` para ocultar `ReadFrom`/`WriteTo` (sube la memoria, baja la CPU): solo con medición.
- Las cifras de descriptores del plan (sección 9: "`LimitNOFILE` ≥ 65 536") se confirman como suficientes para ~10 000 conexiones en passthrough.

## 4. Vigilancia mínima (antes de subir los límites)

1. `verify.sh --host`: descriptores/uso, pipes, RSS, `docker stats`, `free -m`, dueños del 443/80.
2. Métricas del plan (sección 9): `gw_conns_active`, `gw_conns_total{result}`, `gw_port_pool_free`.
3. Medir en el host real, con un cliente fuera de la instancia (no en loopback): 2000 conexiones ociosas de cada modo y un flujo con tráfico sostenido, anotando RSS del contenedor y `memory.stat` (`sock`) del cgroup. **Sin esa medición los topes de arriba son conservadores pero no verificados.**

## 5. UDP y puertos aleatorios (G17 + G16, plano de datos)

Medido en WSL con el binario real de `capsule-gateway` en un proceso aparte y los clientes en el proceso de prueba (N = 2000, `go test -run ProcessUDP`; **medido**, loopback, un destino de eco):

| Elemento | Descriptores en el gateway | RSS por unidad | Notas |
|---|---|---|---|
| Sesión UDP del túnel (transport 2) | **2** (socket TCP del cliente + socket UDP al destino) | **~63 kB** (incluye la conexión TLS 1.3: el grueso) | Al cerrar las 2000 los descriptores volvieron a la base (13); el RSS no baja (Go retiene el heap, como en TCP). |
| Flujo UDP de un puerto aleatorio (tabla NAT) | **1** (socket UDP conectado al destino; más 1 de escucha por lease) | **~8 kB** | Sin TLS: buffer de lectura de 2 KiB y una goroutine. Los flujos inactivos se cierran y devuelven el descriptor (13 al terminar). |
| Listener de un lease | 1 TCP y/o 1 UDP por puerto arrendado | pocos kB (no medido por separado) | Solo existen para leases activos. |

Presupuesto de descriptores (derivado): 10 000 leases con TCP y UDP añaden como máximo **20 000** descriptores de listener a los `6 x 6000 + 10 000 + ~1000` de la sección 3 (47 000 a ~57 000) y 6000 sesiones UDP de túnel añaden 12 000 (2 por sesión, sin pipes). El `nofile` de 131 072 sigue dejando más del doble de margen: no hace falta subirlo. Memoria (derivada): 2000 sesiones UDP de túnel son ~125 MB, así que **cada sesión UDP de túnel cuenta contra `CAPSULE_GW_MAX_CONNS` y compite con las 1500 conexiones con TLS terminado de la sección 1** (cuesta como una de ellas); los flujos de puertos aleatorios (~8 kB) son baratos. **No medido:** carga sostenida de datagramas (solo 5 por sesión) y la memoria de socket del kernel en el cgroup.

Límites propios de UDP (configurables, ver `RUNBOOK-udp-pool.md`): 50 sesiones por ruta, 10 por (ruta, IP), 50 por proyecto; cola de 256 KiB por sesión (lo que no cabe se descarta y se cuenta); 100 flujos nuevos por segundo y por puerto arrendado y 2048 flujos como tope por puerto.

## Adenda G11: MySQL/MariaDB, Redis y MongoDB (medido en WSL, binario real, loopback)

Base del proceso 10,5 MB. **1000 conexiones MySQL ociosas antes de enrutar** (saludo enviado, sin SSLRequest): +6,8 MB, **~7 KB por conexión**. **400 conexiones Redis TLS en passthrough** establecidas: **~15 KB por conexión**, 2 descriptores por conexión (815 con el resto del proceso). **120 conexiones MySQL en passthrough** establecidas: **~6,5 KB por conexión**. Tras cerrarlas todas los descriptores vuelven a 15 (sin fuga); el RSS no baja (el GC de Go retiene, como ya constaba). El presupuesto del plan (6000 conexiones, 512 MB) **no cambia**: cada protocolo suma ≤ 15 KB por conexión, dentro de los 25-75 KB de la derivación anterior. Nuevo tope por protocolo `CAPSULE_GW_PROTO_MAX_CONNS` (1500 por omisión para `mysql`, `redis` y `mongo`; la suma puede superar `CAPSULE_GW_MAX_CONNS`, que sigue mandando). Con `terminate` en MySQL hay dos sesiones TLS por conexión: contarlas como «terminadas» (~75 KB, **no medido** para MySQL).

## Adenda G10: el 443 compartido, passthrough hacia Caddy (medido en WSL2, binario real, Caddy 2.11.7 real, loopback)

Cuando el gateway toma el 443 (`CAPSULE_GW_TAKE_443=1`, `RUNBOOK-443.md`) todo el HTTPS de git y de la web pasa por él en passthrough hacia `127.0.0.1:8444`:

| Elemento | Descriptores en el gateway | RSS | Notas |
|---|---|---|---|
| Conexión HTTPS pasante hacia Caddy (500 ociosas por el 443) | **2** (socket del cliente + socket hacia Caddy; **sin pipes**: el relevo de `relay.go` es de espacio de usuario, no `splice`) | proceso 13,3 MB en reposo → 23,4 MB con 500 = **~20 kB por conexión** | Al cerrarlas, los descriptores volvieron a 11 (la base). Caddy aparte: 17,8 → 35,8 MB (~36 kB por conexión TLS terminada en Caddy, tope del contenedor 128 m). |

Consecuencias para los topes de las secciones 1-3:

* **Las conexiones de Caddy cuentan contra `CAPSULE_GW_MAX_CONNS`** (6000) y compiten con bases y túneles: una conexión de git/web cuesta como una de passthrough (~20-28 kB, 2 descriptores). 6000 pasantes ≈ 120-170 MB y 12 000 descriptores (derivado de lo medido); `nofile` de 131 072 sigue sobrando. Caddy ya tenía 128 m de tope propio: el HTTPS terminado sigue costando su memoria a Caddy, no al gateway.
* **El límite de tasa por IP (`CAPSULE_GW_NEW_CONNS_PER_IP`, 20/s, ráfaga 40) y de conexiones sin autenticar (`CAPSULE_GW_PREAUTH_PER_IP`, 100) se aplican antes de conocer el SNI**: también al HTTPS de git. Medido: 500 conexiones nuevas desde una sola IP en ráfaga fueron cortadas a partir de la ~40ª; repartidas entre 14 IP pasaron todas. Una oficina o CGNAT que clone/empuje con muchas conexiones nuevas puede toparlo: subir `CAPSULE_GW_NEW_CONNS_PER_IP` (sugerido 100) al tomar el 443.
* **El tope de memoria del contenedor (384-512 m) es ahora también el techo del HTTPS de git por el 443**, pero no su memoria de TLS (la sigue poniendo Caddy). Si el gateway muere por OOM, cae el 443 completo hasta el reinicio (`restart: always`, ~2-5 s).
* **Durante un relevo de gateway conviven dos procesos** (el viejo con las conexiones largas, hasta `CAPSULE_GW_DRAIN_TIMEOUT`, y el nuevo): sumar sus memorias y descriptores mientras dure. `git push` de 73 s medido a través de un relevo sin corte.
* **Latencia añadida por el salto** (gateway → docker-proxy → Caddy, dos saltos locales): **≈ +0,5 a +1 ms en p50**, dentro del ruido de la máquina de pruebas (medido en 3 pares alternados de 300 conexiones nuevas; el plan estimaba ~+0,15 ms sin docker-proxy). **No medido en el host real.**
* **No medido**: tráfico sostenido (MB/s) por el passthrough, más de 500 conexiones simultáneas, memoria de sockets del kernel en el cgroup.
