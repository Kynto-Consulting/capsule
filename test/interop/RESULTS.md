# Resultados de la prueba de interoperabilidad del gateway

Generado por `run.sh` (2026-11-03 21:03). Componentes reales: backend `cmd/server` con las 64 migraciones, `capsule-gateway`, libreria Go `gatewayclient`, libreria JS (`packages/gateway-js/dist` bajo node.exe), CLI `capsule`, psql 18, OpenSSH, openssl. Todo en loopback dentro de WSL.

Total: **252 PASA, 0 FALLA, 38 no aplica**.

## Criterios de aceptacion de F1 (PLAN 12.2)

| # | Criterio | Estado | Evidencia |
|---|---|---|---|
| 1 | psql "host=<name> sslmode=require" (libpq >= 14) connects on 5432 and routes 2 databases | **PASA** | psql (PostgreSQL) 18.6 (Ubuntu 18.6-0ubuntu0.26.04.1); pg/v4:interop-row-one pg2/v4:interop-row-two pg/v6:interop-row-one pg2/v6:interop-row-two; port 5432: psql exit=0 interop-row-one \| listener handshake: depth=1 CN=interop test CA depth=0 CN=pg.target.test |
| 2 | gateway answers on 443 and 5432 (loopback address 127.0.0.77, not the production host) | **PASA** | tunnel via 127.0.0.77:443: allow row="interop-row-one" ; 5432: psql exit=0 interop-row-one \| listener handshake: depth=1 CN=interop test CA depth=0 CN=pg.target.test |
| 3a | ssh with the ProxyCommand of `capsule ssh --print` reaches 2 different sshd (capsule/1 tunnel) | **PASA** | ssh (v4) -> "interop-ssh-one" ; ssh2 (::1) -> "interop-ssh-two" |
| 3b | ssh with ProxyCommand `openssl s_client -servername <name>` reaches 2 different sshd (SNI name, gateway terminates TLS) | **PASA** | ssh (v4) -> "interop-ssh-one" ; ssh2 (::1) -> "interop-ssh-two" |
| 3c | cgc_ tokens also work when the gateway has no local signing keys (control plane verifies) | **PASA** | gateway started with CAPSULE_GW_CGC_KEYS empty: allow row="interop-row-one"; replay of the same token: deny |
| 4 | a new route is effective in < 5 s | **PASA** | PATCH=200, before: gateway: no autorizado (estado...; effective after 26 ms (ok=true); routes 24 -> 25, rev 104 -> 106 |
| 5 | invalid token and non-existent route are indistinguishable (same error, same time; every client) | **PASA** | uniform error+time: 2/2; refusal cells over every client and family: 56/56. 1 distinct: [deny: gateway: no autorizado (estado 2, código 0x0201): not authorized] |
| 6 | a 10 minute connection survives route reloads (and control restart, certificate reload, load) | **PASA** | 4/4 checks. lived 10m15s, exit=0, ticks=41, done=true \| gw_route_rev 102 -> 191 (14 enable/disable toggles) |
| 7 | dual-stack gateway: same result over IPv4 and over ::1 for every client and credential | **PASA** | 66/66 matrix cells identical in both families (differences: []); matrix passes: v4 69/69, v6 66/66; Go lib, JS lib (v4 over the WSL NIC, ::1 over the relay), capsule CLI, psql and OpenSSH all connect on ::1 |
| 8 | ports 40000-40199 keep connecting with the same IP list (regression of the direct path) | **NO PROBADO** | the direct path is the AWS security group plus docker published ports: no firewall or AWS exists in this local run (and none may be touched). Only the gateway side of the single list is checked, see criterion 9. |
| 9 | one IP list: editing the database access rules changes the gateway decision (gateway side of the single list) | **PASA** | rules deleted -> IpDenied after 0s (data-plane cache of allow decisions is 30 s); rules restored -> allowed after 5s |
| 10 | connection_strings: the gateway entry comes first (legacy field keeps the direct string) | **PASA** | pg: HTTP 200 first=gateway all=[gateway/sni_name gateway/capsule_uri gateway/random_port direct_port/direct_port] legacy="tcp.interop.test:55441" ; echo: HTTP 200 first=gateway all=[gateway/capsule_uri direct_port/direct_port] legacy="tcp.interop.test:55407" |
| X1 | capsule login session (JWT) -> connect, minting a cgc_ (real login endpoint) | **PASA** | 6/6 checks pass |
| X2 | expired / wrong-key / wrong-route cgc_ (0x0202 vs uniform 0x0201), Go, JS, CLI | **PASA** | 8/8 checks pass |
| X3 | random-port pool: lease, TCP/UDP/psql with allowed and denied IP list, release, exhaustion | **PASA** | 18/18 checks pass |
| X4 | UDP tunnel capsule/1 with Go lib, JS lib and capsule tunnel | **PASA** | 7/7 checks pass |
| X5 | access by name (and tunnel) with an EMPTY IP list denies | **PASA** | 7/7 checks pass |
| 11 | informe de deploy v1 (package G7) | **NO PROBADO** | outside this package: no deploy report component exists in the gateway interop run |
| 12 | secondary path: netaccess/handler tests unchanged; psql host:40123 keeps working | **NO PROBADO** | needs the firewall reconciler and a real published port; `go test ./internal/netaccess/...` was run separately (see README) |

## Matriz cliente x familia x credencial

PASA = el resultado fue el esperado (consulta real / error uniforme / codigo de salida). N/A = la credencial no interviene en esa via.

### Go lib (Dial+query)

| Credencial | IPv4 | ::1 |
|---|---|---|
| cap_ | PASA | PASA |
| cgc_ (one use) | PASA | PASA |
| cgc_ replay | PASA | PASA |
| cgs_ | PASA | PASA |
| invalid token | PASA | PASA |
| ip not allowed | PASA | PASA |
| no such service | PASA | PASA |
| other org (cap_) | PASA | PASA |
| scoped elsewhere | PASA | PASA |

### JS lib (connect+query)

| Credencial | IPv4 | ::1 |
|---|---|---|
| cap_ | PASA | PASA |
| cgc_ (one use) | PASA | PASA |
| cgs_ | PASA | PASA |
| invalid token | PASA | PASA |
| ip not allowed | PASA | PASA |
| no such service | PASA | PASA |
| other org (cap_) | PASA | PASA |
| scoped elsewhere | PASA | PASA |

### capsule connect --listen+psql

| Credencial | IPv4 | ::1 |
|---|---|---|
| cap_ | PASA | PASA |
| cgc_ (one use) | PASA | PASA |
| cgs_ | PASA | PASA |
| invalid token | PASA | PASA |
| ip not allowed | PASA | PASA |
| no such service | PASA | PASA |
| other org (cap_) | PASA | PASA |
| scoped elsewhere | PASA | PASA |

### capsule connect --exec psql

| Credencial | IPv4 | ::1 |
|---|---|---|
| cap_ | PASA | PASA |
| cgc_ (one use) | PASA | PASA |
| cgs_ | PASA | PASA |
| invalid token | PASA | PASA |
| ip not allowed | PASA | PASA |
| no such service | PASA | PASA |
| other org (cap_) | PASA | PASA |
| scoped elsewhere | PASA | PASA |

### capsule connect --stdio (exit)

| Credencial | IPv4 | ::1 |
|---|---|---|
| cap_ | PASA | PASA |
| cgc_ (one use) | PASA | PASA |
| cgs_ | PASA | PASA |
| invalid token | PASA | PASA |
| ip not allowed | PASA | PASA |
| no such service | PASA | PASA |
| other org (cap_) | PASA | PASA |
| scoped elsewhere | PASA | PASA |

### capsule ssh --print+ssh

| Credencial | IPv4 | ::1 |
|---|---|---|
| cap_ | PASA | PASA |
| cgc_ (one use) | PASA | PASA |
| cgs_ | PASA | PASA |
| invalid token | PASA | PASA |
| ip not allowed | PASA | PASA |
| no such service | PASA | PASA |
| other org (cap_) | PASA | PASA |
| scoped elsewhere | PASA | PASA |

### capsule ssh (exec)

| Credencial | IPv4 | ::1 |
|---|---|---|
| cap_ | PASA | PASA |
| cap_ + remote command after -- | PASA |  |
| cgc_ (one use) | PASA | PASA |
| cgs_ | PASA | PASA |
| invalid token | PASA | PASA |
| ip not allowed | PASA | PASA |
| no such service | PASA | PASA |
| other org (cap_) | PASA | PASA |
| scoped elsewhere | PASA | PASA |

### psql SNI classic

| Credencial | IPv4 | ::1 |
|---|---|---|
| allowed by IP list | PASA | PASA |
| cap_ | NA | NA |
| cgc_ (one use) | NA | NA |
| cgs_ | NA | NA |
| invalid token | NA | NA |
| ip not allowed | PASA | PASA |
| no such service | PASA | PASA |
| other org (cap_) | NA | NA |
| scoped elsewhere | NA | NA |

### psql SNI direct

| Credencial | IPv4 | ::1 |
|---|---|---|
| allowed by IP list | PASA | PASA |
| cap_ | NA | NA |
| cgc_ (one use) | NA | NA |
| cgs_ | NA | NA |
| invalid token | NA | NA |
| ip not allowed | PASA | PASA |
| no such service | PASA | PASA |
| other org (cap_) | NA | NA |
| scoped elsewhere | NA | NA |

### ssh ProxyCommand openssl SNI

| Credencial | IPv4 | ::1 |
|---|---|---|
| allowed by IP list | PASA | PASA |
| cap_ | NA | NA |
| cgc_ (one use) | NA | NA |
| cgs_ | NA | NA |
| invalid token | NA | NA |
| ip not allowed | PASA | PASA |
| no such service | PASA | PASA |
| other org (cap_) | NA | NA |
| scoped elsewhere | NA | NA |

### Go lib

| Credencial | IPv4 | ::1 |
|---|---|---|
| 3 causes | PASA |  |

## Resto de comprobaciones

| Fase | Cliente | Fam. | Esperado | Obtenido | Estado | Nota |
|---|---|---|---|---|---|---|
| codec | Go lib=gateway=JS | - | 7124 cases, identical outcome | 0 differ | PASA |  |
| codec | Go lib / gateway / JS | - | 71 vectors = documented result | go=0 gateway=0 js=0 mismatches | PASA |  |
| codec | Go lib=gateway=JS | - | 600 random valid/edge requests encode to the same bytes | 0 differ (39 rejected by all) | PASA |  |
| codec | Go lib | - | Padding > 255 rejected like the JS library and the gateway encoder (H5 fixed) | campo inválido: relleno fuera de 0..255 bytes | PASA |  |
| codec | Go lib=gateway=JS | - | 2374 cases, identical outcome | 0 differ | PASA |  |
| interop | Go lib | v4 | echo 1 KiB + half-close | ok=true got=1024 B 3 ms | PASA |  |
| interop | JS lib | v4 | echo 1 KiB + half-close | ok=true got=1024 B 55 ms | PASA |  |
| interop | capsule connect | v4 | echo 1 KiB + half-close | ok=true got=1024 B 66 ms | PASA |  |
| interop | Go lib | v4 | echo 5 MB + half-close | ok=true got=5242880 B 35 ms | PASA |  |
| interop | JS lib | v4 | echo 5 MB + half-close | ok=true got=5242880 B 114 ms | PASA |  |
| interop | capsule connect | v4 | echo 5 MB + half-close | ok=true got=5242880 B 100 ms | PASA |  |
| interop | Go lib | v6 | echo 1 KiB + half-close | ok=true got=1024 B 8 ms | PASA |  |
| interop | JS lib | v6 | echo 1 KiB + half-close | - | NA | the Windows<->WSL relay breaks half-close on ::1 (see the relay diagnostic); verified over IPv4 |
| interop | capsule connect | v6 | echo 1 KiB + half-close | ok=true got=1024 B 60 ms | PASA |  |
| interop | Go lib | v6 | echo 5 MB + half-close | ok=true got=5242880 B 44 ms | PASA |  |
| interop | JS lib | v6 | echo 5 MB + half-close | - | NA | the Windows<->WSL relay breaks half-close on ::1 (see the relay diagnostic); verified over IPv4 |
| interop | capsule connect | v6 | echo 5 MB + half-close | ok=true got=5242880 B 101 ms | PASA |  |
| interop | Go=JS=CLI | v6 | echo 1 KiB + half-close: identical bytes received | 2 implementations, identical=true | PASA |  |
| interop | Go=JS=CLI | v6 | echo 5 MB + half-close: identical bytes received | 2 implementations, identical=true | PASA |  |
| interop | Go=JS=CLI | v4 | echo 1 KiB + half-close: identical bytes received | 3 implementations, identical=true | PASA |  |
| interop | Go=JS=CLI | v4 | echo 5 MB + half-close: identical bytes received | 3 implementations, identical=true | PASA |  |
| interop | Go lib | v4 | 5 MB download then server half-close: clean EOF, exact length | n=5242880 err= | PASA |  |
| interop | Go lib | v4 | 5 MB upload acknowledged with the exact count | ack=5242880 err=<nil> | PASA |  |
| interop | Go lib | v6 | 5 MB download then server half-close: clean EOF, exact length | n=5242880 err= | PASA |  |
| interop | Go lib | v6 | 5 MB upload acknowledged with the exact count | ack=5242880 err=<nil> | PASA |  |
| interop | Go lib | v4 | cancel during handshake: returns at once, not NotAuthorized | 60 ms err=conexión cancelada: context deadline exceeded | PASA |  |
| interop | JS lib | v4 | cancel during handshake: returns at once, not NotAuthorized | 79 ms kind=Aborted | PASA | node start-up included in ms |
| interop | Go lib | v6 | cancel during handshake: returns at once, not NotAuthorized | 60 ms err=conexión cancelada: context deadline exceeded | PASA |  |
| interop | JS lib | v6 | cancel during handshake: returns at once, not NotAuthorized | 65 ms kind=Aborted | PASA | node start-up included in ms |
| interop | Go lib | v4 | ctx cancel after Dial (informational: documents semantics) | open while connected=3, released by cancel alone=false | PASA | Go convention: cancelling the Dial context after it returned does not close the connection (the caller closes it) |
| interop | JS lib | v4 | AbortSignal after connect destroys the socket | destroyed=true phase=after-connect | PASA |  |
| interop | Go lib | v6 | ctx cancel after Dial (informational: documents semantics) | open while connected=3, released by cancel alone=false | PASA | Go convention: cancelling the Dial context after it returned does not close the connection (the caller closes it) |
| interop | JS lib | v6 | AbortSignal after connect destroys the socket | destroyed=true phase=after-connect | PASA |  |
| interop | Go lib | v4 | retry until the destination returns | ok=true after 2008 ms err=<nil> | PASA | default RetryPolicy |
| interop | JS lib | v4 | retry until the destination returns | ok=true same=true after 2097 ms | PASA | retry {8 attempts, 300 ms} |
| interop | Go lib | v6 | retry until the destination returns | ok=true after 2007 ms err=<nil> | PASA | default RetryPolicy |
| interop | JS lib | v6 | retry until the destination returns | ok=true same=true after 2085 ms | PASA | retry {8 attempts, 300 ms} |
| interop | Go lib vs JS lib | v4 | same CAPR status/code (2 / 0x0201) | go=2/0x0201 js=2/0x0201 | PASA |  |
| interop | Go lib vs JS lib | v6 | same CAPR status/code (2 / 0x0201) | go=2/0x0201 js=2/0x0201 | PASA |  |
| resilience | hot route add | v4 | service enabled -> route effective in the gateway in < 5 s | PATCH=200, before: gateway: no autorizado (estado...; effective after 26 ms (ok=true); routes 24 -> 25, rev 104 -> 106 | PASA |  |
| resilience | route long-poll | - | GET /internal/gateway/routes?since=<rev> answers at the change, not at the timeout | woke 22 ms after the change, rev 106 (wait was 25 s) | PASA |  |
| resilience | route long-poll | - | unchanged revision: 304 after ~wait | HTTP 304 after 3000 ms () | PASA |  |
| resilience | hot route remove | v4 | service disabled -> connection refused within seconds | refused after 265 ms (ok=true) | PASA |  |
| resilience | control down | v4 | gateway stays ready with its table; open connection keeps working | /readyz=200 (ready), routes in table=22, open connection echo err=<nil> | PASA |  |
| resilience | control down | v4 | new connections while the control plane is down (fail closed, AuthStale=0) | refused: gateway: gateway ocupado (estado 6, código 0x0602): control plane unavailable | PASA | documented behaviour: authorisation needs the control plane |
| resilience | gateway restart, control down | - | a new gateway process serves the table of its cache file | start code=0 (started keys=yes) /readyz=ready routes=22 log: {"time":"2026-11-03T20:53:31.64020466-05:00","level":"INFO","msg":"listening","addr":"127.0.0.1:18490","kinds":["all"]} // {"time":"2026-11-03T20:53:31.640319375-05:00","level":"INFO","msg":"admin endpoint","addr":"127.0.0.1:19105"} // {"time":"2026-11-03T20:53:31.640793815-05:00","level":"WARN","msg":"routes poll failed; serving last kn... | PASA |  |
| resilience | control back | v4 | new connections work again after the control plane returns | ok=true after 19ms | PASA |  |
| resilience | SIGHUP certificate reload | v4 | new certificate served, open connection unaffected, new connections verify | served cert changed=true; open conn ok=true; Go new conn err=<nil>; JS ok=true; before=[serial=050E449A5A0F3A37FCB88250A8F8255C03B718AC X509v3 Subject Alterna...] after=[serial=050E449A5A0F3A37FCB88250A8F8255C03B718AD X509v3 Subject Alterna...] | PASA | serial=050E449A5A0F3A37FCB88250A8F8255C03B718AD X509v3 Subject Alternative Name:      DNS:... |
| resilience | SIGHUP broken certificate | v4 | reload fails, previous certificate kept, error logged, service continues | cert unchanged=true; new conn err=<nil>; 'reload failed' log lines=1 | PASA |  |
| long | ssh session (OpenSSH via capsule ssh ProxyCommand) | v4 | >= 10 min with server output every 15 s, exit 0 | lived 10m15s, exit=0, ticks=41, done=true | PASA |  |
| long | Go lib tunnel | v4 | >= 10 min alive, every 20 s probe echoed | alive=true probes=30 err= lived=10m15s | PASA |  |
| long | descriptors after idle | - | descriptors of finished connections are released (the 2000-tunnel burst left 40 keep-alive sockets to the control plane) | fds 29 (baseline with the long sessions open 38), gw_conns_open=0, RSS 29776 KiB, by kind map[anon_inode:2 file:5 socket:22] | PASA |  |
| long | route reloads during the sessions | - | >= 10 table revisions seen by the gateway while they lived | gw_route_rev 102 -> 191 (14 enable/disable toggles) | PASA |  |
| drain | SIGTERM to the old process | v4 | old process keeps serving the open connection and stays alive while it is open | echo through old=true, old pid alive=true, gw_draining=1 (admin HTTP 200) | PASA |  |
| drain | new connections during the update | v4 | none refused: the new process serves them (the old one has stopped listening after DrainGrace) | 41 ok, 0 refused in 5 s; refused at [] | PASA | SO_REUSEPORT keeps the old socket in the group during DrainGrace (2 s): connections hashed to it are refused |
| drain | old process exit | - | exits by itself once its last connection ends | exited=true | PASA |  |
| drain | new process after the old one left | v4 | serves | <nil> | PASA |  |
| bench | latency 1-byte ping-pong | v4 | p50/p99 over 4000 round trips | direct TCP 22/39 us; tunnel (Go lib) 235/408 us; tunnel over ::1 218/396 us; JS lib over ::1 (node.exe via WSL relay) 741/1522 us | PASA | loopback; informational |
| bench | throughput 1 GiB | v4 | download and upload through the tunnel vs direct (exact byte counts) | download: direct 1905 MB/s, tunnel 475 MB/s, capsule connect 436 MB/s; upload: direct 2178 MB/s, tunnel 455 MB/s | PASA | loopback, one stream, informational (PLAN prototype: direct 3174 MB/s, tunnel 632 MB/s) |
| bench | 2000 idle tunnels | v4 | 2000 open (40 sources x 50 over 10 services); gateway memory | opened 2000 (0 failed ) in 6s; gw_conns_open=2006; gateway RSS 15912 -> 120040 KiB (52 KiB per connection); fds 38 -> 4068 (2.0 per connection) | PASA | terminating TLS per tunnel: PLAN RESOURCES.md estimated ~75 KB per terminated connection (155 MB at 2000) |
| bench | 2000 idle tunnels released | v4 | all connections closed; descriptors return to the baseline | gw_conns_open=6, RSS 121704 KiB (Go keeps freed heap), fds 68 (baseline 38) by kind map[anon_inode:2 file:5 socket:61] | PASA | 40 sockets are the keep-alive connections of the gateway HTTP client to the control plane (40 concurrent authorisations); re-checked after the idle period in phase long |
| leak | secret scan | - | audit_logs (gateway.*): 0 occurrences (42985 bytes scanned) | 0 occurrences [] | PASA |  |
| leak | secret scan | - | gateway.log: 0 occurrences (1111086 bytes scanned) | 0 occurrences [] | PASA |  |
| leak | secret scan | - | gwcache.log: 0 occurrences (931 bytes scanned) | 0 occurrences [] | PASA |  |
| leak | secret scan | - | gwnew.log: 0 occurrences (17513 bytes scanned) | 0 occurrences [] | PASA |  |
| leak | secret scan | - | server.log: 0 occurrences (78980 bytes scanned) | 0 occurrences [] | PASA |  |
| leak | secret scan | - | tool output (stdout+stderr of psql, ssh, capsule, node): 0 occurrences (777335 bytes scanned) | 0 occurrences [] | PASA |  |
| leak | secret scan | - | 52 distinct secrets searched in 6 sources | 0 occurrences in total | PASA | gateway ran with CAPSULE_GW_LOG_LEVEL=debug |
| leak | audit trail in the database | - | allow rows for cap, cgs and cgc; deny rows for unauthorized and ip_denied | gateway.connect.allow\|cap\|\|99 ; gateway.connect.allow\|cgc\|\|22 ; gateway.connect.allow\|cgs\|\|17 ; gateway.connect.allow\|none\|\|12 ; gateway.connect.deny\|cap\|ip_denied\|17 ; gateway.connect.deny\|cap\|unauthorized\|51 ; gateway.connect.deny\|none\|unauthorized\|13 | PASA |  |
| leak | audit trail in the database | - | every connection row carries the source IP | rows without ip: 0 | PASA |  |
| matrix | capsule ssh (exec) | v4 | documented form `capsule ssh p/s -l u -- -i key <command>` runs the command | exit=0 interop-ssh-one | PASA | DEFECT cli/cmd/capsule/sshcmd.go sshArgs: extra args are placed before the alias, so a trailing command is taken as the host name |
| matrix | Go lib (Dial+query) | v4 | 1st allow, 2nd deny | allow then deny | PASA |  |
| matrix | Go lib (Dial+query) | v6 | 1st allow, 2nd deny | allow then deny | PASA |  |
| matrix | Go lib | v4 | one identical error | 1 distinct: [deny: gateway: no autorizado (estado 2, código 0x0201): not authorized] | PASA |  |
| matrix | Go lib | v4 | same latency (<=120 ms spread) | min 253 max 347 ms; invalid token avg 295 ms; other org (cap_) avg 296 ms; no such service avg 319 ms | PASA | T_UNIF |
| relay | plain TCP 5 MB half-close echo, node.exe | ::1 (relay) | completes (diagnostic of the test environment) | 1 of 1 truncated; [timeout] | PASA | the Windows<->WSL relay itself breaks half-close on ::1: JS-over-::1 runs with half-close are not attributable to the gateway or the library |
| relay | plain TCP 5 MB half-close echo, node.exe | WSL address | completes | 0 of 2 truncated; {"ok":true,"got":5242880,"want":5242880,"ms":29} | PASA |  |
| second | Go lib | v4 | TokenExpired (status 2 code 0x0202) | gateway: token de conexión expirado (estado 2, código 0x0202): token expired | PASA |  |
| second | JS lib | v4 | TokenExpired (status 2 code 0x0202) | TokenExpired 514 | PASA |  |
| second | capsule connect --stdio | v4 | exit code 3 (credentials expired) | exit 3 capsule: el token de conexión expiró: vuelve a intentarlo o renueva la sesión... | PASA |  |
| second | Go lib | v6 | TokenExpired (status 2 code 0x0202) | gateway: token de conexión expirado (estado 2, código 0x0202): token expired | PASA |  |
| second | JS lib | v6 | TokenExpired (status 2 code 0x0202) | TokenExpired 514 | PASA |  |
| second | capsule connect --stdio | v6 | exit code 3 (credentials expired) | exit 3 capsule: el token de conexión expiró: vuelve a intentarlo o renueva la sesión... | PASA |  |
| second | Go lib | v4 | NotAuthorized, uniform (0x0201), never TokenExpired | gateway: no autorizado (estado 2, código 0x0201): not authorized \|\| gateway: no autorizado (estado 2, código 0x0201): not authorized | PASA |  |
| second | Go lib | v4 | accepted (the signature is what proves issuance) | allow interop-row-one | PASA | informational: anyone holding the seed can mint tokens, as intended |
| second | psql SNI classic | v4 | service with an EMPTY IP list denies by name | deny exit=2 psql: error: connection to server at "127.0.0.1", port 18443 failed: S... | PASA |  |
| second | psql SNI direct | v4 | service with an EMPTY IP list denies by name | deny exit=2 | PASA |  |
| second | Go lib (capsule/1) | v4 | valid token, empty list -> IpDenied | ipdeny gateway: IP de origen no permitida por el proyecto (estado 3... | PASA |  |
| second | psql SNI classic | v6 | service with an EMPTY IP list denies by name | deny exit=2 psql: error: connection to server at "::1", port 18443 failed: SSL err... | PASA |  |
| second | psql SNI direct | v6 | service with an EMPTY IP list denies by name | deny exit=2 | PASA |  |
| second | Go lib (capsule/1) | v6 | valid token, empty list -> IpDenied | ipdeny gateway: IP de origen no permitida por el proyecto (estado 3... | PASA |  |
| second | POST /internal/gateway/authorize none+sni_name | v4 | allow:false for an empty list | HTTP 200 {"allow":false,"deny_reason":"unauthorized","cache_ttl_seconds":0} | PASA |  |
| second | capsule connect --exec (JWT session -> cgc_) | v4 | mints a one-use cgc_ from the real API and runs the query | exit=0 interop-row-one | PASA |  |
| second | capsule connect --stdio (JWT session) | v4 | exit 0 | exit=0 | PASA |  |
| second | capsule connect --exec (JWT session -> cgc_) | v6 | mints a one-use cgc_ from the real API and runs the query | exit=0 interop-row-one | PASA |  |
| second | capsule connect --stdio (JWT session) | v6 | exit 0 | exit=0 | PASA |  |
| second | capsule ssh (JWT session, remote command after --) | v4 | runs the command (H2 fix) with a minted cgc_ | exit=0 interop-ssh-one | PASA |  |
| second | capsule connect --stdio (session without org) | v4 | clear message, non-zero exit | exit=1 capsule: falta la organización: define CAPSULE_ORG_ID o org_id en ~/.capsule/config.yaml | PASA |  |
| second | lease beyond the default project quota (5) | - | 409 port_quota_exceeded | HTTP 409 {"error":{"code":"port_quota_exceeded","message":"Cuota de puertos aleatorios alcanzada.","hint":"Libere un acceso o pid... | PASA |  |
| second | lease idempotent | - | same port on the second request | 20005 then 20005 | PASA |  |
| second | TCP echo through the leased port (Go dial) | v4 | echo | "pool-tcp-ok" err=<nil> | PASA |  |
| second | nc -w3 to the leased port | v4 | pool-nc-ok | "pool-nc-ok" exit=0 | PASA |  |
| second | TCP through a leased port, IP not allowed | v4 | connection closed, no echo | closed | PASA |  |
| second | psql to the leased port of pg | v4 | interop-row-one | exit=0 interop-row-one | PASA |  |
| second | psql to the leased port of pgdeny | v4 | fails | exit=2 psql: error: connection to server at "127.0.0.1", port 20016 failed: server clos... | PASA |  |
| second | UDP echo through the leased port (Go and nc -u) | v4 | echo | go="pool-udp-ok" nc="pool-nc-ok"(exit 0) | PASA |  |
| second | UDP through a leased port, IP not allowed | v4 | no reply | reply="" | PASA |  |
| second | TCP echo through the leased port (Go dial) | v6 | echo | "pool-tcp-ok" err=<nil> | PASA |  |
| second | nc -w3 to the leased port | v6 | pool-nc-ok | "pool-nc-ok" exit=0 | PASA |  |
| second | TCP through a leased port, IP not allowed | v6 | connection closed, no echo | closed | PASA |  |
| second | psql to the leased port of pg | v6 | interop-row-one | exit=0 interop-row-one | PASA |  |
| second | psql to the leased port of pgdeny | v6 | fails | exit=2 psql: error: connection to server at "::1", port 20016 failed: server closed the... | PASA |  |
| second | UDP echo through the leased port (Go and nc -u) | v6 | echo | go="pool-udp-ok" nc="pool-nc-ok"(exit 0) | PASA |  |
| second | UDP through a leased port, IP not allowed | v6 | no reply | reply="" | PASA |  |
| second | release of the lease | v4 | port no longer serves | DELETE=204, closed=true | PASA | existing connections may drain (CAPSULE_GW_POOL_DRAIN) |
| second | pool exhaustion (20 ports) | - | 409 port_pool_exhausted when the range is used up | 14 more leases, then: HTTP 409 {"error":{"code":"port_pool_exhausted","message":"No hay puertos aleatorios libres en este momento.","hint":"Use capsule... | PASA | org/project quotas may answer first |
| second | Go lib DialUDP | v4 | 200/200 datagrams echoed intact | 200/200 | PASA |  |
| second | JS lib connectUdp | v4 | 200/200 datagrams echoed intact | 200/200 got=200 | PASA |  |
| second | capsule tunnel (UDP listener) | v4 | echo | "cli-udp-ok" | PASA |  |
| second | Go lib DialUDP | v6 | 200/200 datagrams echoed intact | 200/200 | PASA |  |
| second | JS lib connectUdp | v6 | 200/200 datagrams echoed intact | 200/200 got=200 | PASA |  |
| second | capsule tunnel (UDP listener) | v6 | echo | "cli-udp-ok" | PASA |  |
| second | Go lib DialUDP, IP not allowed | v4 | IpDenied | gateway: IP de origen no permitida por el proyecto (estado 3, código 0x0301): ip not allowed | PASA |  |
| contract | data plane -> control: POST /internal/gateway/authorize | - | credential_type=none, access=sni_name, source inside the database rule list => allow (the data plane sends exactly this for psql by name) | {"allow":true,"principal_id":"sni:pg","max_conns":200,"max_conns_per_ip":50,"idle_timeout_seconds":3600,"cache_ttl_seconds":30} | PASA | DEFECT backend/internal/gateway/api/authorize.go (authenticate returns nil for CredNone) vs backend/internal/gateway/data/handlers.go (admit(..., CredNone, "", AccessSNI)); API.openapi.yaml lists credential_type none |
