# Prueba de punta a punta e interoperabilidad del gateway (paquete G14)

Todo lo construido para el gateway, probado junto, en local y desechable: sin AWS, sin servidor, sin produccion.

| Pieza real | Como se usa |
|---|---|
| Backend `backend/cmd/server` (binario real, las 64 migraciones, plano de control `gateway/api` + store) | Arranca completo contra un PostgreSQL local. Se eligio el backend entero y no un servidor minimo con solo `gwapi`: arranca con solo `DATABASE_URL` y `CAPSULE_SECRET_KEY` (Redis y AWS son opcionales y se dejan sin configurar; el entorno se lanza con `env -i` y sin credenciales). Asi se prueba tambien el cableado real (`router.go`, `gateway_wiring.go`, autenticacion `cap_`, `authz`, repositorios de puertos y bases) |
| `backend/cmd/capsule-gateway` (plano de datos) | Binario real, con certificados autofirmados de prueba, `CAPSULE_GW_SECRET`, claves publicas de `cgc_` leidas de `/internal/gateway/keys` |
| `cli/pkg/gatewayclient` (libreria Go) | En proceso, desde el arnes |
| `packages/gateway-js/dist` (libreria JS) | Con el `node.exe` de Windows lanzado desde WSL (WSL no tiene node) |
| CLI `capsule connect/tunnel/ssh` | Binario Linux real |
| psql 18, OpenSSH, openssl | Los de WSL |
| Codec del gateway (`data/tunnel`) | Copia generada (`gen_tunnelref.sh`) para compararlo byte a byte con la libreria Go y la JS |

Los destinos son reales: dos clusters PostgreSQL 18 con TLS (`pg`, `pg2`), servidores SSH (`golang.org/x/crypto/ssh`, con el cliente OpenSSH de verdad: en WSL no hay `sshd`), un servidor de eco con half-close y uno de volumen (`bench`). Corren dentro del arnes en loopback; el gateway los alcanza como alcanzaria un contenedor del proyecto.

## Como reproducir

Requisitos: Windows con Go (para compilar), WSL2 Ubuntu con PostgreSQL 18 (binarios en `/usr/lib/postgresql/18/bin`, sin tocar el cluster del sistema), `psql`, `ssh`, `openssl`, y Node en Windows.

```bash
# 1. desde Git Bash (Windows): compila todo en test/interop/bin (no usa -mod=mod en backend ni cli)
test/interop/build.sh

# 2. desde WSL como root: levanta, ejecuta todo, borra todo
wsl -d Ubuntu -u root -- bash /mnt/d/Github/Kynto/capsule/test/interop/run.sh            # todas las fases (~12,5 min; `second` anade ~30 s)
wsl -d Ubuntu -u root -- bash /mnt/d/Github/Kynto/capsule/test/interop/run.sh codec matrix   # fases sueltas
```

`run.sh` hace: certificados de prueba (`certs.sh`), tres clusters PostgreSQL desechables en `/tmp/capsule-interop/pg` (`infra.sh`), tokens aleatorios, base de control nueva + backend real (`reset_control.sh`, `control.sh`), siembra de organizacion, usuarios, proyectos, bases y puertos (`seed.sh`) y el arnes `bin/harness`. Al terminar (tambien si falla) `teardown.sh` mata los procesos, borra clusters, directorio de trabajo y copias, y **verifica** que no quedan procesos, puertos ni directorios. Salidas: `RESULTS.md` (matriz y criterios), `results.json`, `last-run.log`.

Fases del arnes (`bin/harness <fase>...`): `setup`, `codec`, `matrix`, `interop`, `resilience`, `second`, `bench`, `long`, `drain`, `leak`, `accept`; `relay` es un diagnostico del entorno.

| Fase | Que comprueba |
|---|---|
| codec | CAP1/CAPR: libreria Go = codec del gateway = libreria JS sobre todos los vectores de `docs/gateway/testvectors`, mas truncados, mutaciones y 600 solicitudes aleatorias para codificar |
| matrix | 10 clientes x {IPv4, ::1} x {`cap_`, `cgs_`, `cgc_` de un uso, token invalido, otra organizacion, token acotado a otro proyecto, IP no permitida, servicio inexistente}; consulta real, error uniforme, codigos de salida del CLI; reuso de `cgc_`; igualdad de mensaje y de tiempo entre las causas de rechazo |
| interop | Go = JS = CLI sobre el MISMO gateway: eco de 1 KiB y 5 MB con half-close (sha256), descarga/subida de 5 MB, cancelacion (durante el handshake y despues), reintentos con el destino caido, mismo status/code |
| resilience | ruta en caliente (revision, long-poll, efectiva en < 5 s), baja de ruta, reinicio del control con el gateway sirviendo la tabla, gateway nuevo desde su cache sin control, recarga de certificados por SIGHUP (valido y roto) |
| second | `cgc_` expirado (0x0202), de otra clave y de otra ruta con Go, JS y CLI; flujo `capsule login` (JWT real del endpoint de login) -> `connect`/`ssh`; pool de puerto aleatorio (lease por la API real, `nc`, `nc -u`, Go y `psql` con lista de IP permitida y denegada, liberacion, cuota y agotamiento); tunel UDP con Go, JS y `capsule tunnel`; servicio por nombre con lista de IP vacia |
| bench | latencia p50/p99 tunel vs directo, 1 GiB tunel vs directo (bajada y subida), 2000 tuneles ociosos (memoria y descriptores del gateway) |
| long | una sesion SSH real y un tunel de 10 min que viven entre recargas de ruta, reinicio del control, recarga de certificados y carga |
| drain | procedimiento de actualizacion: segundo proceso en los mismos puertos, SIGTERM al viejo |
| leak | ningun secreto en logs del backend/gateway (nivel debug), tabla de auditoria ni salida de herramientas; contenido de la auditoria |
| accept | criterios de F1 del PLAN 12.2 uno por uno |

## Notas del entorno (limites reales de esta prueba)

- **node.exe y la red de WSL.** El cliente JS es un proceso de Windows. IPv4 va por la direccion de la interfaz virtual de WSL; `::1` va por el relevo de localhost de Windows a WSL. Ese relevo **rompe el half-close** (se comprueba con un eco TCP plano sin gateway ni TLS, ver la fase `relay`); por eso los escenarios de half-close de la libreria JS sobre `::1` figuran como no aplicables, y se verifican por IPv4.
- **Limitador de fallos por IP** (10 por minuto y bloqueo de 5 min, en el control y en el gateway): la matriz tiene decenas de rechazos desde `127.0.0.1`; el arnes reinicia el control y el gateway cada 6 rechazos para no medir el limitador en vez de la causa.
- **2000 conexiones ociosas**: el control limita 200 conexiones por ruta y 50 por IP de origen (por diseno), asi que se usan 40 direcciones de origen `127.0.0.2-41` y 10 servicios.
- No hay firewall ni AWS: el camino directo (puertos 40000-40199, security group) no se puede probar aqui.
- El gateway escucha en 18443 (IPv4 e IPv6, dos sockets con SO_REUSEPORT); el criterio de 443 y 5432 se comprueba con un segundo proceso en `127.0.0.77`.

## Archivos

`build.sh`, `run.sh`, `teardown.sh`, `certs.sh`, `infra.sh`, `reset_control.sh`, `control.sh`, `gateway.sh`, `seed.sh`, `gen_tunnelref.sh`, `cmd/harness/*.go` (el arnes), `js/client.mjs` y `js/oracle.mjs` (escenarios y oraculo de codec con la libreria JS), `js/rawecho.mjs`, `go.mod` (modulo propio que importa `cli/pkg/gatewayclient` con `replace`), `RESULTS.md` y `results.json` (los genera el arnes).
