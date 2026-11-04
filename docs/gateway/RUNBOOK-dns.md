# Runbook: DNS del gateway (Namecheap)

Para el dueño: los registros EXACTOS que hay que crear en Namecheap, en el orden recomendado. Zona `tumi-ai.com` (la zona es parámetro del plan, `CAPSULE_GW_ZONE`). Se editan en **Namecheap → Domain List → Manage → Advanced DNS → Host Records**. Nada se aplica desde el repositorio.

Valores (**leídos** de AWS el 3-nov-2026; reconfirmar con `terraform output gateway_dns_ipv4 gateway_dns_ipv6` o `aws ec2 describe-instances` antes de copiar):

| Nombre | Valor |
|---|---|
| IPv4 del host (Elastic IP) | `3.224.61.221` |
| IPv6 del host | `2600:1f18:3417:6802:4ff1:e0e0:9363:cff0` |

TTL: en Namecheap elegir **5 min** (= 300 s) en todos los registros nuevos. Los comodines no cambian; el TTL bajo es para poder revertir.

## 1. Registros de la Fase 1 (ahora)

### 1a. A (IPv4): publicar primero

| Host (campo "Host" de Namecheap) | Tipo | Valor | TTL | Qué se rompe si falta |
|---|---|---|---|---|
| `*.db` | A Record | `3.224.61.221` | 5 min | `<proyecto>.db.tumi-ai.com` no resuelve (NXDOMAIN): `psql "host=mi-proyecto.db.tumi-ai.com"` y toda conexión a bases por nombre fallan. Es el registro de más valor de la Fase 1 |
| `tcp.apps` | A Record | `3.224.61.221` | 5 min | El punto de entrada del túnel `capsule://…` y de SSH sobre TLS (`tcp.apps.tumi-ai.com:443`) no existe: `capsule connect/tunnel/ssh` y las librerías Go/JS no conectan |
| `udp.apps` | A Record | `3.224.61.221` | 5 min | Solo UDP (Fase 3): el túnel UDP/QUIC no resuelve; el respaldo UDP-sobre-TCP usa `tcp.apps`. Se puede dejar para la Fase 3 |

### 1b. AAAA (IPv6): publicar **solo después** de verificar IPv6 real (RUNBOOK-ipv6.md, paso 7)

| Host | Tipo | Valor | TTL | Qué se rompe si falta / si se pone antes de tiempo |
|---|---|---|---|---|
| `*.db` | AAAA Record | `2600:1f18:3417:6802:4ff1:e0e0:9363:cff0` | 5 min | Falta: clientes solo-IPv6 no conectan a las bases. **Antes de tiempo** (sin regla de SG o sin escucha): clientes con IPv6 intentan primero IPv6 y tardan o fallan |
| `tcp.apps` | AAAA Record | `2600:1f18:3417:6802:4ff1:e0e0:9363:cff0` | 5 min | Falta: el túnel no funciona desde redes solo-IPv6 |
| `udp.apps` | AAAA Record | `2600:1f18:3417:6802:4ff1:e0e0:9363:cff0` | 5 min | Falta: UDP no funciona por IPv6 (Fase 3) |

### 1c. Registros que ya existen y NO se cambian

| Host | Tipo | Estado | Nota |
|---|---|---|---|
| `*.apps` | CNAME al ALB | **No tocar** en F1/F2 | El ALB sigue sirviendo HTTP de los proyectos (PLAN 4.3). `tcp.apps` y `udp.apps` son nombres exactos: ganan al comodín `*.apps` (RFC 4592), no hace falta borrarlo. **Incoherencia del plan:** la sección 3.1 lista `*.apps` A→EIP y la 4.3 lo deja en el ALB; aquí se sigue la 4.3. Moverlo es una decisión aparte |
| `app`, `api` | CNAME al ALB | Sin cambio | |
| `git` | A a la EIP | Sin cambio | Su AAAA (`docs/ipv6.md` sección 4) va con las reglas 80/443 IPv6 (RUNBOOK-ipv6.md, hallazgo 1) |
| `db` | A (si existe) | Sin cambio | `*.db` **no** cubre el nombre `db` en sí; si existe `db` y se quiere IPv6 se añade su AAAA con el mismo valor |

Namecheap: un nombre con CNAME no admite otros registros; `*.db`, `tcp.apps` y `udp.apps` llevan solo A/AAAA, por eso no hay conflicto.

## 2. Orden recomendado

1. Comprobar los TTL actuales de `git`, `db`, `app`, `api`, `*.apps` (no se cambian).
2. Aplicar el security group y desplegar el gateway (RUNBOOK-ipv6.md, pasos 1-5). **Sin gateway escuchando, los A nuevos no rompen nada** (nadie usa aún esos nombres), pero tampoco sirven.
3. Crear los **A** de la 1a (`*.db`, `tcp.apps`, y `udp.apps` si se quiere).
4. Esperar el TTL (5 min) y comprobar: `dig +short A tcp.apps.tumi-ai.com`, `dig +short A algo.db.tumi-ai.com` → `3.224.61.221`; luego `deploy/gateway/verify.sh --ipv4 3.224.61.221 --test-port 8443`.
5. Probar IPv6 con un cliente real. Si pasa, crear los **AAAA** de la 1b y volver a verificar (`verify.sh --ipv4 … --ipv6 …`, que también compara el DNS).
6. Fase 2: la delegación de `_acme-challenge` (sección 3).

Reversa de cualquier paso: borrar el registro nuevo (nada existente se modificó).

## 3. Delegación de `_acme-challenge` (Fase 2, paquete G9; **requiere la decisión 4 del plan**)

El plan (sección 6) emite los certificados comodín (`*.apps`, `*.db`) con DNS-01 de Let's Encrypt por Route53 **sin entregarle toda la zona**: se delega solo el nombre del desafío por CNAME. `tcp.apps` y `udp.apps` quedan cubiertos por el comodín `*.apps` (una sola etiqueta). `git` sigue con HTTP-01 de Caddy (sin cambio).

Los nombres de desafío que hay que delegar son exactamente:

| Host (Namecheap) | Tipo | Valor | TTL | Qué se rompe si falta |
|---|---|---|---|---|
| `_acme-challenge.db` | CNAME Record | `db.acme.tumi-ai.com.` (zona de Route53 `acme.tumi-ai.com`) | 5 min | No se puede emitir ni renovar el comodín `*.db`: el modo de terminación TLS del gateway deja de tener certificado válido a los 90 días |
| `_acme-challenge.apps` | CNAME Record | `apps.acme.tumi-ai.com.` | 5 min | Igual para `*.apps` (`tcp.apps`, `udp.apps` y servicios por SNI) |
| `acme` | NS Record (×4) | los 4 servidores de la zona `acme.tumi-ai.com` de Route53 (`ns-….awsdns-….org.`, etc.) | 30 min | Sin la delegación, los CNAME anteriores apuntan a un nombre que nadie sirve |

**Valores reales del plan** (G9, `deploy/terraform/acme_zone.tf` con `acme_enabled = true`): los dos CNAME de la tabla son exactos. Los 4 NS los entrega `terraform output acme_ns_records` una vez creada la zona (paso A de `RUNBOOK-acme.md`; hasta entonces no se ha creado nada en AWS). Costo de la zona: unos 0,50 USD/mes (no verificado). Que Namecheap acepte registros NS de subdominio en su panel estándar (**?**) hay que confirmarlo; **alternativa sin NS:** crear la zona de Route53 para un dominio o subdominio que el dueño ya controle por completo y apuntar los dos CNAME a ella. Pasos, verificación, reversa y alarma: `RUNBOOK-acme.md`.

Los CNAME de `_acme-challenge.*` no chocan con el comodín `*.apps`/`*.db` (nombres exactos). No poner TTL alto: el emisor crea y borra los TXT durante cada emisión.

## 4. Tabla resumen copiable (Fase 1)

```
Host        Tipo   Valor                                       TTL
*.db        A      3.224.61.221                                5 min
tcp.apps    A      3.224.61.221                                5 min
udp.apps    A      3.224.61.221                                5 min   (puede esperar a la Fase 3)
*.db        AAAA   2600:1f18:3417:6802:4ff1:e0e0:9363:cff0     5 min   (solo tras verificar IPv6 real)
tcp.apps    AAAA   2600:1f18:3417:6802:4ff1:e0e0:9363:cff0     5 min   (idem)
udp.apps    AAAA   2600:1f18:3417:6802:4ff1:e0e0:9363:cff0     5 min   (idem, Fase 3)
```

## 5. No verificado

Que Namecheap acepte `*.db` y NS de subdominio tal como se describe (la interfaz no se consultó); los registros DNS actuales de la zona (no constan en el repositorio; el proveedor es Namecheap según el dueño); que `tcp.apps.` / `*.db.` resuelvan desde redes reales; la estabilidad de la dirección IPv6 si se reemplazara la instancia (con la instancia actual es la de la ENI primaria).
