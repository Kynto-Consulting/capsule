# Hallazgos de la prueba de punta a punta del gateway (G14)

Resultado de la última corrida de `run.sh all`: 197 PASA, 11 FALLA, 38 N/A. Las 11 fallas salen de 5 defectos de otros paquetes, no del arnés. El detalle de la matriz está en `RESULTS.md` y `results.json`.

## H1 (alto): el acceso por nombre SNI nunca autoriza
- Dónde: `backend/internal/gateway/api/authorize.go` (`authenticate` deniega `credential_type: none`) frente a `backend/internal/gateway/data/handlers.go` (envía `none` con `access: sni_name`) y a `data/portpool*.go` (puerto aleatorio).
- Esperado: la conexión por nombre se autoriza si la IP está en la lista del servicio.
- Obtenido: `{"allow":false,"deny_reason":"unauthorized"}`; `psql` termina en `unexpected eof` y `ssh` por openssl también.
- Por qué pasaron las pruebas de cada lado: cada una usa un doble del otro.
- Responsable: G3. Estado: se pidió la corrección (`none` válido con `sni_name` y `random_port`; lista de IP vacía deniega).

## H2 (medio): `capsule ssh ... -- <opciones> <comando>` pone el comando donde va el host
- Dónde: `cli/cmd/capsule/sshcmd.go`, `sshArgs`.
- Obtenido: el alias queda al final y ssh toma `uptime` como host.
- Responsable: G12. Estado: se pidió la corrección y pruebas.

## H3 (alto con solo sesión de login): el CLI pide el `cgc_` a una ruta inexistente
- Dónde: `cli/cmd/capsule/connect.go`, `mintConnectionToken`, llama a `/api/v1/projects/{p}/gateway/...`; el backend solo sirve `/api/v1/orgs/{org}/projects/{p}/gateway/...`.
- Con `cap_` o `cgs_` en el entorno no se llama a esa ruta y todo funciona.
- Responsable: G12. Estado: se pidió la corrección.

## H4 (medio): la actualización sin cortes rechaza conexiones nuevas durante la gracia
- Dónde: `capsule-gateway` `Drain` (gracia de 2 s con `SO_REUSEPORT`).
- Obtenido: 6 a 9 de unas 40 conexiones nuevas rechazadas con 6/0x0601 en los primeros ~1,9 s.
- Responsable: G4. Estado: se pidió la corrección y una prueba que repita el escenario.

## H5 (bajo): API de relleno distinta entre librerías
- Go acepta `Padding` mayor que 255 y lo reparte en varias TLV `0x80`; JS y el gateway lo rechazan. En el cable no hay diferencia hasta 255.
- Responsable: G12. Estado: se pidió rechazarlo también en Go.

## Observaciones
- JS destruye el socket al cancelar aun después de conectar; Go no cierra la conexión al cancelar el contexto de `Dial` tras devolver.
- El gateway no consulta `/internal/gateway/keys`; las claves van por `CAPSULE_GW_CGC_KEYS` y rotar exige reiniciar. Sin claves locales el control verifica los `cgc_`.
- `begin` en `api/http_user.go` convierte cualquier error de `GetByID` en 404 `not_found` y oculta fallos internos.
- Con el control caído el gateway sigue listo, pero rechaza las conexiones nuevas (falla cerrada, como está documentado).

## No verificado
Puertos directos 40000-40199 y el security group; gateway en 5432 y 443 con DNS real; informe de deploy v1; UDP/QUIC y pool de puertos aleatorios (afectados por H1); MySQL, Redis y Mongo; `cgc_` expirado y `cgt_`; flujo `login` y `connect` con JWT; librería JS en Linux o navegador; red real, Happy Eyeballs, más de 2000 conexiones y cualquier cosa de AWS.

## Segunda corrida (tras las correcciones de H1-H5)

Resultado de `run.sh all` con el arbol corregido: 252 PASA, 0 FALLA, 38 N/A (ver `RESULTS.md` y `results.json`). H1-H5 quedan verificados como corregidos: psql por nombre (clasico y `sslnegotiation=direct`, IPv4 y ::1, dos bases), `ssh` con openssl por SNI a dos sshd, y 443/5432 (en 127.0.0.77) pasan; `capsule ssh -- <opciones> <comando>` ejecuta el comando; el drenado no rechaza conexiones; Go rechaza `Padding` > 255 como JS y el codec del gateway; el CLI obtiene el `cgc_` de la ruta con organizacion.

Anadido en esta corrida (fase `second`), todo PASA:
- Flujo real `capsule login` -> `connect`: usuario sembrado con hash bcrypt, JWT del endpoint de login real, `CAPSULE_TOKEN`=JWT + `CAPSULE_ORG_ID`; `connect --exec psql`, `connect --stdio` y `capsule ssh` con comando remoto (IPv4 y ::1). Sin organizacion configurada: mensaje claro y salida 1.
- `cgc_` expirado: 0x0202 `TokenExpired` en Go, JS y CLI (salida 3, IPv4 y ::1); firmado con otra clave o para otra ruta: 0x0201 uniforme; un `cgc_` forjado con la semilla real y ventana valida se acepta (informativo: quien tiene la semilla emite tokens).
- Pool de puerto aleatorio (`CAPSULE_GW_POOL=20000-20019` en control y gateway, lease por `POST .../services/{s}/port`): idempotente; TCP (Go y `nc`), `psql` y UDP (Go y `nc -u`) con lista permitida funcionan en IPv4 y ::1; con lista denegada la conexion se cierra sin eco, `psql` falla y UDP no responde; la liberacion cierra el puerto; la sexta concesion devuelve `409 port_quota_exceeded` (cuota por defecto 5) y con la cuota subida el agotamiento devuelve `409 port_pool_exhausted`.
- Tunel UDP capsule/1: 200/200 datagramas intactos con la libreria Go, con la JS y con `capsule tunnel` (IPv4 y ::1); IP no permitida: `IpDenied`.
- Servicio con lista de IP vacia: por nombre (clasico y directo) se deniega, por `capsule/1` con token valido da `IpDenied`, y `authorize none/sni_name` devuelve `allow:false`.

Observaciones nuevas (no son fallos):
- La cuota de puertos aleatorios por proyecto/organizacion no tiene endpoint en la API de usuario (solo la politica `warn|error`); la prueba la subio por SQL en `gateway_org_quotas`.
- El registro (`POST /auth/register`) falla en una base nueva con `global 2fa secret is not set yet; please retrieve onboarding status first` (500 INTERNAL_ERROR): es el flujo de arranque del backend, no del gateway; la prueba sembro el usuario y uso el login real.
- Una vez, tras reiniciar el gateway, el relevo de localhost de Windows tardo en reenviar `::1` al cliente JS (ECONNREFUSED); el arnes espera al relevo tras cada reinicio.

Sigue sin probarse: puertos directos 40000-40199 y security group, 5432/443 con DNS real, informe de deploy v1, QUIC, MySQL/Redis/Mongo, `cgt_`, red real y todo AWS.
