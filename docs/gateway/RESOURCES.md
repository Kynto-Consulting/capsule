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
