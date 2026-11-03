# Backups, restauración y recuperación total

Fuentes: `docs/git-capsule/DR-BACKUP.md`, `docs/BACKUPS_MANIFEST.md`, `deploy/recovery/README.md`.

## Backups por proyecto (`capsule backups`)

```bash
capsule backups show                                        # política, últimas ejecuciones, próxima
capsule backups set --enabled=true --schedule daily --retention-days 14 --databases --volumes
capsule backups set --schedule 6h                           # solo cambia lo que pasas
capsule backups run                                         # respaldo inmediato
capsule backups list                                        # snapshots (ID corto)
capsule backups restore <snapshot-id> [--target t] [-y]     # SOBRESCRIBE datos; pide confirmación
```

- Frecuencias: `hourly`, `6h`, `12h`, `daily`, `weekly`. Retención en días (`--retention-days`).
- **Los volúmenes están desactivados por defecto** (`include_volumes=false`): un proyecto con archivos subidos por
  usuarios necesita `--volumes` o esos datos no se respaldan. Revísalo con `backups show` en proyectos productivos.
- `--target` restaura en otro destino en vez de en el sitio.

### Restaurar (destructivo: confirmación obligatoria)

1. Pregunta al usuario qué snapshot y si es en el sitio (sobrescribe) o `--target` distinto.
2. Si los datos actuales importan: `capsule backups run` antes (copia de seguridad previa) y espera a que termine
   (`capsule backups show`).
3. `capsule backups restore <id>` (usa `-y` solo si el usuario ya lo aprobó explícitamente).
4. Verifica: `capsule backups show`, `capsule logs runtime`, la URL responde 200, los datos esperados están.

## Qué guarda cada respaldo

Cada ejecución escribe datos (volcados de bases, volúmenes) y un **manifiesto** cifrado
(`projects/<projectID>/manifest/<fecha>-<runID>.json.enc`) con referencias, nunca valores secretos: proyecto,
último deployment (`git_sha`, imagen, digests, `source_key` del tarball de fuentes), contenedor (puertos, red,
límites), volúmenes, **nombres** de variables (los valores viven cifrados en la base de Capsule) y bases con su motor
y versión. El esquema es `schema: 1`; un lector rechaza esquemas desconocidos. El inventario de plataforma
(`platform/<fecha>-<runID>.inventory.json.enc`) cubre todos los contenedores del host. Todo va cifrado
(AES-256 con sobre); sin la frase/clave de cifrado **no hay recuperación posible**: esa frase debe existir fuera
del servidor.

## Recuperación total (`capsule recover`)

```bash
capsule recover plan   --project PROJ                       # SOLO LECTURA: qué se restauraría, checksums, riesgos
capsule recover plan   --all                                # plataforma completa (administradores de plataforma)
capsule recover verify --project PROJ [--at 2026-11-01T10:00:00Z]   # re-chequea sin cambiar nada
capsule recover apply  --project PROJ --snapshot <id> --force-overwrite --wait   # destructivo
capsule recover apply  --all --target ephemeral --scope databases,volumes,projects --wait
capsule recover status <run-id>
```

Flags: `--scope` (fases `network,core,git,databases,volumes,projects,dns`), `--at` (RFC 3339; usa los respaldos más
nuevos que no pasen de esa hora), `--snapshot` (fija el snapshot; solo proyecto; excluye `--at`), `--target`
`in_place` (por defecto) o `ephemeral` (**nunca** toca DNS, IP elástica ni producción), `--force-overwrite` (consiente
sobrescribir; antes se guarda una copia `pre-restore`), `--continue-on-error`, `--wait`, `-y`.

Reglas del agente:
1. Empieza **siempre** con `plan` y muestra los riesgos al usuario (por ejemplo "proyecto X sin respaldo de
   volúmenes", `NO_CHECKSUM_CATALOG`, `DUMP_NO_CHECKSUM`).
2. `apply` sobrescribe datos: confirmación explícita del usuario; para ensayar usa `--target ephemeral`.
3. `apply` es idempotente y reanudable (los pasos `ok` se saltan); un solo `apply` activo a la vez.
4. Recuperar un **proyecto** exige permiso de admin (`project.delete`); recuperar la **plataforma**, administrador
   de plataforma.
5. El servidor **nunca** cambia infraestructura (Terraform, RDS, DNS, Caddy): esos pasos salen `skipped` con la
   razón y los ejecuta un operador humano con `deploy/recovery/recover.sh`. No los intentes tú.
6. `recover` está apagado por defecto en el servidor (`CAPSULE_RECOVERY_ENABLED`). Si responde 501/404, está
   apagado o no cableado: díselo al usuario. No está verificado desde esta skill que lo esté en producción.

## Objetivos y límites (hipótesis, no medidos)

RPO objetivo: base de Capsule <= 5 min (PITR de RDS, 7 días); fuentes de despliegue 0; repos Git 24 h hoy (6 h
propuesto); bases y volúmenes de proyecto = la frecuencia configurada. RTO objetivo: un proyecto 30 min, Git 1 h,
plataforma 4 h (oficialmente "no medido", se informa como 8 h hasta el primer simulacro). El simulacro mensual
(`deploy/recovery/drill.sh`) **no se ha ejecutado**.

No cubierto: datos posteriores al último respaldo; volúmenes sin `--volumes`; pérdida de la frase de cifrado o de la
clave de plataforma (irrecuperable); estado de Terraform local; caída de toda la región; Redis (se aceptan
sesiones perdidas); registros DNS de Namecheap. Lista completa en `DR-BACKUP.md` sección 10.

## Export de un proyecto (no es un backup)

`capsule export` / `capsule import` mueven configuración y variables, no datos. Ver `despliegue.md`.
