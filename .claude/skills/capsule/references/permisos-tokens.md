# Permisos por proyecto, tokens y OAuth

## Roles por proyecto

| Rol | Puede |
|---|---|
| `viewer` | leer (proyecto, código, PR, runs, alertas; de los secretos solo contadores) |
| `deployer` | lo anterior + desplegar, pedir promociones, comentar/revisar, relanzar/cancelar CI, fusionar PR (sujeto a la regla de la rama), pedir token de Git `write` |
| `admin` | gestiona el proyecto: miembros, protección de ramas, entornos, ajustes del repo, puertos, bases, backups, tokens de servicio, secretos de CI |

El rol efectivo sale de: rol en la org + modo de acceso + rol explícito. Owner/admin de la org cuentan como admin
del proyecto. Los roles se proyectan a equipos de Forgejo (`<proyecto>-admin|deployer|viewer`); **Capsule es la
fuente de verdad** (quien se añada a mano en esos equipos se quita en la siguiente sincronización).

```bash
capsule members list                                   # miembros efectivos y el ORIGEN de su acceso
capsule members set ana@ejemplo.com --role deployer    # admin | deployer | viewer; id o email
capsule members remove ana@ejemplo.com -y
capsule org access-mode open|restricted -y             # open: toda la org ve todo; restricted: solo explícitos
```

`restricted` oculta proyectos a quien no figure: **confirma con el usuario** y antes añade a quien deba seguir con
acceso (incluido tú). Cambiar roles o miembros: confirma con el usuario y verifica con `members list`.
Aprobar promociones no depende del rol sino de la lista del entorno (`entornos-aprobaciones.md`).

## Alcances de tokens `cap_`

```bash
capsule tokens create --name github-ci --scope deploy --project <project-id>
capsule tokens create --name ci-sarif --scope security:write --project <project-id>
capsule tokens create --name mi-token                      # sin --scope = acceso total (*): evítalo
capsule tokens list ; capsule tokens revoke <TOKEN_ID completo>
```

| Alcance | Requiere `--project` | Permite (verificado en `middleware/scope.go`) |
|---|---|---|
| `*` (por defecto) o vacío | no | todo lo que permita el rol del dueño. **Nunca en CI.** |
| `deploy` | sí (solo ese proyecto) | `POST .../deployments/upload-url`; `GET/POST .../deployments`; `GET .../deployments/{id}`, `/logs`; `POST .../cancel` y `/rollback`; `GET .../env`; previews (`GET/POST .../previews`, `DELETE .../previews/{pr}`); `GET .../environments`; `POST .../promotions` y `GET .../promotions/{id}` |
| `security:write` | sí | solo `POST .../security/sarif` y `GET .../security/sarif/{id}` de ese proyecto |

Todo lo demás con un token acotado da **403**: variables de cuenta, otros proyectos, firewall, git, miembros,
puertos, backups, bases, tokens, aprobar o cancelar promociones, credenciales Git (`/user/git-credentials`). No
intentes "ampliar" un token ni uses uno de otro alcance para rodear un 403: crea el adecuado (con permiso del
usuario) o informa.

`capsule tokens revoke` pide el **ID completo** (no el corto) y el valor del token **nunca** se vuelve a mostrar.
Revocar un token en uso puede romper un pipeline: confirma con el usuario.

## Tokens de Git (`cgt_`)

| Tipo | Vida | Alcance | Cómo |
|---|---|---|---|
| Efímero | ~1 h (máx. 12 h) | un repo, read o write según tu rol (se re-evalúa en cada uso) | lo emite el credential helper |
| Personal | 1-90 d (30 por defecto) | read/write, repos opcionales | `capsule git tokens create` |
| Servicio (CI) | 1-90 d (90 por defecto) | read/write, un repo, no ligado a una persona | `capsule git service-tokens create` |

Solo valen para **Git por HTTPS**, nunca para la API de Capsule. Se guarda solo el hash; revocar surte efecto en <= 30 s.
Ver `git-capsule.md`.

## Clientes OAuth (apps que inician sesión con Capsule)

```bash
capsule oauth clients create --name "Mi app" --redirect-uri https://app.ejemplo.com/callback [--public] [--first-party] [--org-id ORG]
capsule oauth clients list
capsule oauth clients update <id|client_id> --name X --redirect-uri https://...
capsule oauth clients delete <id|client_id> -y      # las apps que lo usan dejan de iniciar sesión
```

El `client_secret` se imprime **una sola vez** al crear: guárdalo como secreto en el acto (`capsule env set ...
--secret`), nunca en git, logs ni chat. Los redirect URI deben ser `https` (`http` solo en `localhost`). `--public`
= sin secreto, con PKCE. `--first-party` omite la pantalla de consentimiento: solo para apps propias (así está
registrado el login de Forgejo).

## Autoservicio de contraseñas y 2FA

No es flujo de agente: `capsule register` y el login con contraseña los ejecuta el usuario.
