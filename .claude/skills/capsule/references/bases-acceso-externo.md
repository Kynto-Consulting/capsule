# Bases de datos: acceso externo

Las bases de proyecto con contenedor propio se publican en `db.tumi-ai.com` en un puerto del rango
**40000-40199**, siempre con TLS (`sslmode=require`) y **cerradas por defecto**. Las de nivel `prod` (RDS) y S3 no
se gestionan con este comando (responden `UNSUPPORTED`). Un token `deploy` no puede usarlo (403).

```bash
capsule db list                                      # bases del proyecto (ID corto, nombre, motor)
capsule db access list <db>                          # reglas + cadena de conexión SIN contraseña
capsule db access add <db> --my-ip --desc "portátil" # tu IP pública actual (/32 o /128)
capsule db access add <db> --cidr 203.0.113.0/24 --desc "oficina"
capsule db access remove <db> --cidr 203.0.113.7/32  # o el id corto de la regla
capsule db access set <db> --cidr a --cidr b         # reemplaza TODAS las reglas (idempotente)
```

`<db>` es el ID corto de `db list` o el nombre de la base.

## Conectar

```bash
psql "host=db.tumi-ai.com port=40012 dbname=<db> user=<user> sslmode=require"   # puerto de `db access list`
```

- El certificado es autofirmado: cifra, pero no sirve para `verify-full`.
- `access list` muestra la cadena de conexión **sin contraseña**. Pídela al usuario o léela del lugar que él
  indique (no la inventes). No la imprimas ni la pegues en el chat; pásala por `PGPASSWORD` desde el entorno.

## Reglas y límites

- Máximo **25 reglas por base** (IPv4 e IPv6 cuentan juntas); prefijo mínimo IPv4 `/8`, IPv6 `/32`.
- `0.0.0.0/0` o `::/0` solo con `--allow-public`, solo owner/admin y con confirmación. **No lo hagas** sin petición
  explícita del usuario.
- Cada regla consume cuota del security group de AWS (60 por familia, ajustable): borra las que ya no uses.
- Prefiere `--my-ip` y una descripción (`--desc`) para poder auditar quién es quién.
- Si usas `set`, recuerda que **borra** las reglas que no listes: lee antes con `access list` y repite las que
  deban quedar.

## Verificar

`capsule db access list <db>` y una conexión de prueba real (`psql … -c "select 1"`). Si la conexión se cuelga,
la IP no está en la lista o la regla aún no se sincronizó con el firewall (espera unos segundos y reintenta).

## Camino primario (gateway) y qué NO hay hoy

El método **primario** es el gateway: `capsule connect proyecto/servicio --listen 127.0.0.1:5433` (`gateway.md`), y
este acceso directo por `db.tumi-ai.com:<puerto>` es el **secundario**. El gateway está **en el código pero NO
desplegado**: hoy en producción solo funciona el puerto directo de arriba. No existe (planificado) el nombre
`<nombre>.db.tumi-ai.com` por SNI en el 5432 ni MySQL/Redis/Mongo por SNI. Ver `estado-real.md`.
