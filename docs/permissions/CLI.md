# CLI del motor de permisos

Convenciones del CLI actual que se respetan: bandera global `--output table|json|yaml` (`wantJSON` ya existe en `cli/cmd/capsule/`), `--api-url`,
`-y` para confirmar acciones destructivas, ids completos para revocar, valores secretos impresos una sola vez y nunca en argv, resolución
de `USER_ID|EMAIL`, `--org` y `--project` con los valores por defecto de `capsule init`/`login`. Los comandos de hoy NO cambian:
`capsule members list|set|remove`, `capsule org access-mode`, `capsule tokens create|list|revoke --scope`, `capsule orgs list|create`.

Código fuente: un fichero por grupo en `cli/cmd/capsule/` (`roles.go`, `groups.go`, `perms.go`, `invite.go`, `access_members.go`, `owner.go`, `repovis.go`), tests con el cliente HTTP falso existente.

## 1. Códigos de salida

Se reutiliza la tabla de `exitcodes.go` (`capsule help exit-codes`). No se añaden códigos.

| Código | Nombre | Uso en estos comandos |
|---|---|---|
| 0 | ok | éxito; `perms can` = permitido |
| 1 | genérico | error inesperado o de red |
| 2 | uso | argumentos inválidos, permiso inexistente en el catálogo, slug inválido |
| 3 | auth | sin sesión o token inválido |
| 4 | denegado | el servidor devolvió 403 (también `perms can` cuando NO está permitido) |
| 5 | bloqueado | invariante o política que lo impide: `PUBLIC_REPOS_FORBIDDEN`, `PREFLIGHT_BLOCKED`, `WOULD_HIDE` sin `--confirm`, `ESCALATION` |
| 6 | timeout | `--wait` agotado (aceptación de invitación o transferencia) |
| 9 | conflicto | `LAST_OWNER`, `MIXED_ASSIGNMENTS`, `SYSTEM_TEMPLATE`, nombre duplicado, versión obsoleta |

Todo error con `--output json` imprime en stdout `{"error":{"code","message","details"}}` (mismo cuerpo que la API) y sale con el código de arriba. `404` de recursos no visibles sale con 1 y el mensaje "not found" (no distingue inexistente de no visible).

## 2. `capsule perms`

```
capsule perms catalog [--group G] [--scope org|project|repo|env] [--sensitive] [--output json]
capsule perms me [--org ORG] [--project P] [--expand projects]       # GET /me/permissions
capsule perms can PERMISO [--user EMAIL|ID] [--project P] [--repo] [--env E] [--token ID] [--output json]
capsule perms explain PERMISO [--user EMAIL|ID] [--project P] [--what-if "assign:deployer@project:P"] [--output json]
```

- `perms can` imprime `allowed` o `denied: missing database:query (reason: no_grant)` y sale 0 o 4. Sin `--user` consulta al propio usuario (`/me/permissions`); con `--user` usa el simulador (exige `assignment:read`).
- `perms explain` imprime el rastro numerado del simulador; `--what-if` admite varias veces `assign:<plantilla>@<alcance>:<id|slug>` o `revoke:<assignment_id>` (sin lenguaje de reglas).
- Ejemplo JSON de `perms can --output json`: `{"allowed":false,"permission":"database:query","reason":"ceiling","scope":{"type":"project","id":"..."}}`.
- `perms catalog --output json` imprime el mismo documento que `GET /permissions/catalog` (la CLI no tiene copia del catálogo).

## 3. `capsule roles` (plantillas)

```
capsule roles list [--kind org|project|repo] [--include-archived]
capsule roles show KIND/SLUG [--version N]                  # p. ej. project/deployer, org/readonly
capsule roles create SLUG --kind project --name "Soporte" --perm deployment:read --perm deployment:create ... [--from-file f.json]
capsule roles clone KIND/SLUG NUEVO_SLUG [--name ...]       # clona la última versión (también las del sistema)
capsule roles edit KIND/SLUG [--add-perm P]... [--remove-perm P]... [--note TEXTO] [--dry-run]   # publica versión n+1
capsule roles diff KIND/SLUG DE A
capsule roles history KIND/SLUG
capsule roles archive KIND/SLUG -y                          # en uso: archiva; sin uso: borra
capsule roles export KIND/SLUG > rol.json ; capsule roles import rol.json
```

`edit` sin `--dry-run` muestra primero el impacto (personas, grupos, proyectos, permisos que se ganan y pierden) y pide `-y`; con `--dry-run` solo lo imprime y sale 0. Las plantillas del sistema solo admiten `show`, `list`, `clone` (editar sale 9 `SYSTEM_TEMPLATE`). Faltan dependencias: sale 2 y lista `missing_dependencies` (con `--add-deps` las añade).

## 4. `capsule groups`

```
capsule groups list [--q TEXTO]
capsule groups create SLUG --name "Equipo Pagos" [--description ...]
capsule groups show SLUG
capsule groups delete SLUG -y                                # archiva
capsule groups members SLUG                                  # lista
capsule groups members add SLUG USER... [--for 30d]           # caducidad opcional
capsule groups members rm SLUG USER...
capsule groups grant SLUG --template project/deployer --project P [--for 7d] [--reason TEXTO]
capsule groups grant SLUG --template repo/repo-write --repo P
capsule groups grant SLUG --template project/viewer --org-wide     # todos los proyectos
capsule groups revoke SLUG --assignment ID
```

`grant` usa el mismo alcance que `capsule members grant` (sec. 5). Añadir miembros a un grupo es una concesión: sin permisos suficientes sale 4 con `ESCALATION` en `details.code`.

## 5. `capsule members` (extensión; los subcomandos actuales se mantienen)

```
capsule members list [--org-level] [--role R] [--group G] [--status active|suspended]  # sin banderas: miembros efectivos del proyecto (comportamiento actual)
capsule members set USER --role admin|deployer|viewer          # actual: legado, sigue válido
capsule members set USER --template project/soporte            # nuevo
capsule members grant USER --template KIND/SLUG (--project P | --repo P | --env E | --org-wide) [--for 8h|7d|FECHA] [--reason TEXTO]
capsule members revoke USER (--assignment ID | --template KIND/SLUG --project P)
capsule members access USER [--project P]                      # permisos efectivos y origen de cada uno
capsule members role USER --template org/member|org/admin|org/readonly|org/NOMBRE      # rol de organización
capsule members suspend USER [--reason ...] -y ; capsule members reactivate USER
capsule members remove USER -y                                 # actual (proyecto); con --org baja de la organización
```

`members set --role` con asignaciones personalizadas previas sale 9 `MIXED_ASSIGNMENTS` salvo `--replace-all`. Cambiar el rol a un owner o quitar al último owner sale 9 `LAST_OWNER`. Sin `--project`, el proyecto sale de la configuración local como hoy.

## 6. `capsule invite`

```
capsule invite create EMAIL --template org/member [--group G]... [--assign "project/deployer@project:P"]... [--expires 7d] [--message TEXTO]
capsule invite list [--status pending|accepted|expired|revoked]
capsule invite revoke ID -y
capsule invite resend ID
capsule invite accept TOKEN                                    # desde la cuenta de quien acepta; el token llega por correo y se pasa por stdin con --token-stdin (nunca en argv)
```

`create` no imprime el token (solo se envía por correo). `--assign` admite hasta 20.

## 7. Propiedad

```
capsule owner list
capsule owner transfer USUARIO [--keep-owner] --wait       # pide contraseña/2FA por prompt (nunca por argumento)
capsule owner transfer --cancel
capsule owner accept                                        # el destinatario
```

## 8. Tokens con permisos

```
capsule tokens create --name ci --perm deployment:create --perm deployment:read --project P --expires 30d
capsule tokens create --name legado --scope deploy --project P      # sigue válido (alias de la lista de SPEC 9.2)
capsule tokens create --name ancho --allow-all                       # '*': exige --allow-all, caducidad <= 90 d (D5)
capsule tokens list [--all]          # --all exige token:read-all: tokens de todos, con creador
capsule tokens revoke ID [--user USER] -y
```

Si el token pedido excede lo que el usuario tiene, sale 4 y lista los excedentes. `--perm` repetible; `--perm-file`; los permisos no tokenables (`member:*`, `assignment:*`...) dan exit 2 con la explicación.

## 9. Repos públicos y contribuciones (fase P)

```
capsule org public-repos allow|forbid -y --confirm-slug SLUG      # owner; pide contraseña/2FA
capsule repo visibility [--project P]                              # estado y URL pública
capsule repo visibility preflight [--project P] [--output json]    # correos, secretos, tamaño
capsule repo visibility public [--project P] --confirm org/repo --i-understand-history-is-public [--acknowledge-findings]
capsule repo visibility private [--project P]                      # inmediato, sin confirmación extra
capsule contributions list [--project P] ; capsule contributions show N
capsule contributions run-ci N -y      # CI sin confianza (pool aislado, sin secretos)
capsule contributions close N [--reason TEXTO]
```

`public` sin análisis reciente (<= 15 min) lo ejecuta antes y se detiene si hay hallazgos críticos (sale 5 `PREFLIGHT_BLOCKED`). Con la política en `forbidden` sale 5 `PUBLIC_REPOS_FORBIDDEN` y dice cómo permitirla. `make private` es `capsule repo visibility private`.

## 10. Salida JSON (ejemplos)

```
$ capsule roles show project/deployer --output json
{"id":"…","kind":"project","slug":"deployer","system":true,"current_version":1,"permissions":["project:view","project:read","deployment:read", "..."]}

$ capsule members access ana@ejemplo.com --project api-pagos --output json
{"user":{"id":"…","email":"ana@ejemplo.com"},"org_template":"member","legacy_role":"deployer","source":"explicit",
 "via":[{"kind":"direct","template":"viewer"},{"kind":"group","label":"equipo-pagos","template":"deployer"}],"permissions":["…"]}

$ capsule perms can database:query --user luis@contratista.pe --project api-pagos --output json ; echo $?
{"allowed":false,"permission":"database:query","reason":"ceiling"}
4
```

## 11. Compatibilidad y pruebas

Prueba de humo de cada comando contra el servidor falso (`cli_integration_test.go` existente) más una tabla de códigos de salida; `capsule --help` documenta los alias (`members set --role` y `tokens create --scope deploy`) como aceptados. Ningún comando nuevo imprime secretos ni los recibe por argv (invitaciones, contraseñas y TOTP por prompt o stdin).
