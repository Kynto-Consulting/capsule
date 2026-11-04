# Actualización prevista de la skill `capsule` (`.claude/skills/capsule/`)

Se aplica en el paquete P11, cuando los comandos existan en el CLI. Hasta entonces la skill NO debe prometer nada de esto (regla del proyecto: la skill describe lo verificado). Cada cambio se comprueba con un script que ejecuta `--help` de cada comando citado.

## `SKILL.md`

- Tabla de referencias: añadir `permisos-atomicos.md` (nuevo) y `repos-publicos.md` (nuevo, solo cuando la fase P esté desplegada).
- Regla general nueva: "Antes de cambiar acceso, pregunta qué puede hacer hoy la persona con `capsule perms explain`/`members access`; nunca des un permiso mayor que el que pide el usuario; confirma con el usuario antes de conceder, revocar, suspender, transferir propiedad o hacer público un repo."
- Línea de prohibiciones: el agente no hace público un repo, no activa la política de repos públicos, no transfiere propiedad ni crea tokens `--allow-all` sin confirmación explícita del usuario en la conversación.

## `references/permisos-tokens.md` (reescritura parcial)

1. Sección "Roles por proyecto": mantener los tres roles como plantillas del sistema (`viewer`, `deployer`, `admin`) y añadir los cuatro de organización (`owner`, `admin`, `member`, `readonly`, hoy no documentado el `readonly`).
2. Nueva sección "Permisos atómicos": formato `recurso:acción`, `capsule perms catalog|me|can|explain`, regla "efectivo = unión de asignaciones, recortado por el techo", sin denegaciones, alcance org/proyecto/repo/entorno.
3. Nueva sección "Plantillas y grupos": `capsule roles ...`, `capsule groups ...`, clonar en lugar de editar las del sistema, vista previa de impacto, acceso temporal (`--for`).
4. Sección "Alcances de tokens `cap_`": conservar la tabla de `*`, `deploy`, `security:write` (alias), y añadir `--perm` con la regla "un token nunca excede al usuario", los permisos no tokenables y `--allow-all` para `*`.
5. Cambiar la frase "Aprobar promociones no depende del rol sino de la lista del entorno" por "se concede por entorno (`promotion:approve`); la lista de aprobadores es su vista".
6. Modo de acceso: `open`/`restricted` pasa a "política de la organización, con sobrescritura por proyecto"; el aviso de confirmar antes de `restricted` se conserva y se apoya en `WOULD_HIDE`.
7. Añadir sección "Invitaciones, suspensión, baja y propiedad": `capsule invite`, `members suspend|reactivate|remove`, `owner transfer`, el último owner no se puede quitar.
8. Mantener los avisos de seguridad actuales: no ampliar un token para rodear un 403; el valor de un token no se vuelve a mostrar; revocar pide el ID completo.

## `references/git-capsule.md`

- Los roles se proyectan a equipos de Forgejo `<proyecto>-read` / `<proyecto>-write` (más los `-viewer/-deployer/-admin` durante la transición); acceso por repo (`capsule members grant --repo`).
- Claim `groups`: sin cambios más `grp:<org>/<grupo>`.
- (Fase P) PR externos con GitHub, CI sin confianza, y que no hay forks para usuarios normales.

## `references/repos-publicos.md` (nuevo, fase P)

Qué es y qué nunca es público; política de organización (`capsule org public-repos allow|forbid`); `capsule repo visibility ...` con el análisis previo y la confirmación; `make private` inmediato; URL pública `https://app.tumi-ai.com/public/git/{org}/{repo}` y clon anónimo; contribuciones externas (`capsule contributions ...`), "Ejecutar CI sin confianza" y que nunca hay secretos en ese CI; el agente no publica nada sin permiso expreso.

## Otros

- `references/errores-frecuentes.md`: códigos nuevos (`PERMISSION_DENIED`, `TOKEN_SCOPE`, `LAST_OWNER`, `MIXED_ASSIGNMENTS`, `SYSTEM_TEMPLATE`, `WOULD_HIDE`, `ESCALATION`, `PUBLIC_REPOS_FORBIDDEN`, `PREFLIGHT_BLOCKED`) con la causa y qué hacer; recordar que 404 no distingue "no existe" de "no puedes verlo".
- `references/webhooks-auditoria.md`: eventos `access.*` y `capsule` para consultarlos (`GET /orgs/{org}/access-audit`).
- `references/estado-real.md`: marcar qué está desplegado y qué solo está en el código (el motor v2 y la fase P no se dan por activos hasta que el dueño los despliegue).
- `references/ci-workflows.md`: nota de que en PR externos el CI corre aislado y sin secretos.
- `references/seguridad.md`: enlazar a los nuevos permisos `security:*` y a `security:upload`.
