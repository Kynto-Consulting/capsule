# UDP e IPv6 en el gateway y los puertos

Fuentes: `docs/udp-ports.md`, `docs/ipv6.md`, `docs/gateway/PROTOCOL.md` sección 10. Estado: UDP directo y UDP por
túnel **en el código, NO desplegados** (migración `000064_project_ports_udp` sin aplicar en producción). IPv6 de red:
**aplicado en AWS** (VPC, ALB `dualstack`, IPv6 de la instancia).

## UDP directo (puerto publicado, sin túnel)

El mismo rango 41000-41999; la unicidad es por (puerto, protocolo): el **mismo número puede existir en tcp y en udp**.

```bash
capsule ports add --container 7777 --udp --name game --my-ip     # = --protocol udp
capsule ports list                                               # columna PROTO
capsule ports list --udp                                         # solo UDP
capsule ports access add 7777 --udp --cidr 203.0.113.0/24
capsule ports access remove 7777 --udp <id-regla|cidr>
capsule ports remove --container 7777 --udp -y
```

- **Sin `--udp` el comando actúa sobre el puerto TCP**: con el mismo número en ambos, olvidar el flag toca el otro.
- Reglas del firewall por IP (IPv4 e IPv6), máximo 25 por (puerto, protocolo); `SG_RULE_LIMIT` si se agota la cuota.
- Errores API: `INVALID_PROTOCOL`, `DUPLICATE_PORT`, `NOT_FOUND` ("puerto N/udp no publicado"), `PORT_RANGE_EXHAUSTED`.
- El healthcheck del deploy solo sondea el puerto HTTP principal: un servicio solo-UDP no da falsos fallos.
- Cada cambio de puertos reinicia el contenedor (avisa antes en producción).

## UDP por el gateway (túnel)

```bash
capsule connect 'capsule://mi-proyecto/juego?transport=udp' --listen 127.0.0.1:7777
# el cliente UDP apunta a 127.0.0.1:7777
```

UDP sobre el flujo TLS (`transport=2`): un socket UDP por sesión con puerto de origen estable; añade latencia y
cabeza de línea de TCP (no sirve para juegos de baja latencia: para eso usa el puerto directo). Sesión local inactiva
2 min; máximo 50 sesiones UDP por proyecto (`0x0504` -> exit 5). `--stdio` y `capsule ssh` no admiten UDP. QUIC: planificado.

## Puerto aleatorio UDP

Los servicios UDP también pueden arrendar un puerto del pool 20000-29999 (`gateway.md`); mismas reglas: sin token,
decide la lista de IP del servicio, vacía = deniega.

## IPv6

- CIDR v6 en `ports`, `db access`, `network`: se canonicalizan (`2001:db8::1` -> `2001:db8::1/128`), prefijo mínimo
  `/32`, zonas (`%eth0`) rechazadas, `::ffff:a.b.c.d` cuenta como IPv4.
- `--my-ip` añade `/32` o `/128` según la familia con que llegas y avisa de la otra: si el usuario usa ambas,
  añade las dos con `--cidr`.
- Según el protocolo, el gateway tendrá `A` y `AAAA` en `tcp.<zona>`/`udp.<zona>` y los clientes usan Happy Eyeballs; `family=4|6` en
  el URI fuerza una familia: `capsule://p/s?family=6`.
- Verifica DNS/red con el usuario (`dig AAAA`, `curl -6`); no confirmes AAAA de `git`/`db` sin comprobarlo: solo
  consta el registro A.
- Límite: el rate limiting por IP cuenta por /128 (un atacante rota dentro de su /64).
