# UX del motor de permisos

Mockups estáticos en `mockups/` (abrir `mockups/index.html`). Logo real: `frontend/public/logo.png`. Tema oscuro del dashboard
(`frontend/app/globals.css`). Reglas visuales para quien lo implemente:

- Tokens, sintaxis Tailwind con paréntesis: `bg-(--bg-surface)`, `border-(--border)`, `text-(--text-primary)`, `text-(--text-secondary)`, `bg-(--accent-dim)`, `text-(--text-accent)`, `border-(--border-focus)`.
- **Texto informativo SIEMPRE en `text-(--text-secondary)`** (#a8a8a8 sobre #111: contraste ~8:1). `--text-muted` (#858585) solo para decoración y marcadores de posición, nunca para información que haya que leer (descripciones de permisos, estados, ayudas, motivos de caducidad).
- Estados con color Y texto/forma (nunca solo color): `ok` verde con la palabra "activa", `warn` ámbar, `bad` rojo, `info` azul.
- Foco visible 2 px `--accent-light` en todo lo interactivo; objetivos táctiles >= 34 px en escritorio y >= 40 px en móvil; respetar `prefers-reduced-motion`.

## 1. Principios

1. La UI no decide: pide `GET /me/permissions` (una sola fuente, SPEC 11.1) y oculta lo que no se puede ver; el servidor sigue aplicando todo.
2. Ocultar secciones sin permiso de lectura (decisión D14); dentro de páginas visibles, deshabilitar acciones con la razón en un tooltip accesible (`aria-describedby`), por ejemplo "Necesitas `database:create` en este proyecto".
3. Explicar siempre el origen: "tiene deployer por el grupo equipo-pagos", "viewer directo sustituye a la base", "techo de readonly".
4. Cambios peligrosos con vista previa de impacto y confirmación proporcionada (plantilla publicada, pasar a restringido, hacer público un repo).
5. Mismo vocabulario que el catálogo: la UI muestra `deployment:create` en monoespaciada junto a la etiqueta en español; la CLI y la API usan los mismos identificadores.

## 2. Sidebar por permisos efectivos (`mockups/sidebar.html`)

### 2.1 Fuente y estado

`useAccess()` (hook nuevo, `frontend/lib/access.ts`) llama a `GET /me/permissions?org=<activa>` con `If-None-Match`, guarda en `stores/access.ts` (no en `stores/auth.ts`), y se revalida: al cambiar de organización, al recibir `403` de cualquier llamada, al recuperar el foco de la pestaña, y cuando la cabecera `X-Access-Epoch` de cualquier respuesta difiere de la guardada. `useCan(perm, {project?})` y `useCanAny([...])` son la única API que usan componentes y páginas. `useProjectRole` y `adminOnly`/`orgAdminOnly` del sidebar actual se retiran (el primero deriva el rol de una lista que un no-admin no puede leer; ver SPEC G9).

### 2.2 Estructura: dos contextos

- **Contexto de organización** (rutas `/projects`, `/deployments`, ...): selector de organización arriba (nombre, insignia de la plantilla: owner/admin/member/readonly/personalizada, estado suspendida) y secciones Trabajo, Recursos, Administración, Cuenta.
- **Contexto de proyecto** (`/projects/{id}/...`): botón "Volver a {org}" y las secciones del proyecto, calculadas con los permisos EN ese proyecto (`?project=`).
- **Contexto de plataforma**: sección aparte "Plataforma" solo con `platform-user:read`; no depende de la org activa.

Entradas (anyOf; si ninguno, no se dibuja). Las de organización usan `aggregate` (unión de permisos de proyecto en cualquier proyecto visible) u `org.permissions`:

| Entrada | Ruta | Permisos (cualquiera) | Contador |
|---|---|---|---|
| Projects | `/projects` | `project:view`, `project:create` | nº de proyectos visibles |
| Deployments | `/deployments` | `deployment:read` | |
| Git | `/git` | `git:read` | |
| Aprobaciones | `/approvals` | `promotion:approve` | pendientes de aprobar (hoy `usePendingApprovals`) |
| Notificaciones | `/notifications` | siempre (miembro activo) | sin leer |
| Databases | `/databases` | `database:read` | |
| Storage | `/storage` | `storage:read` | |
| Email | `/email` | `email:read` | |
| Domains | `/domains` | `domain:read` | |
| AI & Keys | `/ai` | siempre (es de la cuenta) | |
| Usuarios y acceso | `/access/*` | `assignment:read`, `group:read`, `template:read`, `member:invite` (subitems por permiso: Personas, Grupos, Roles, Invitaciones, Tokens `token:read-all`); `member:read` solo NO basta: lo tiene todo miembro y ve la lista en Settings | invitaciones pendientes |
| Auditoría | `/settings/audit` | `audit:read` | |
| Facturación | `/billing` | `billing:read` | |
| Settings | `/settings` | `org:read` | |
| Usuarios de plataforma | `/admin/users` | `platform-user:read` | |

Entradas de proyecto (permiso EN el proyecto): Resumen (`project:read`), Deployments (`deployment:read`), Repositorio y CI (`git:read`, `ci:read`), Variables (`envvar:read`), Entornos (`environment:read`), Bases de datos (`database:read`), Storage (`storage:read`), Dominios (`domain:read`), Email (`email:read`), Red y puertos (`network:read`), Gateway (`gateway:connect`, `gateway:manage`), Backups (`backup:read`), Seguridad (`security:read`), Logs (`log:read`), Acceso del proyecto (`assignment:read`), Ajustes (`project:update`, `webhook:manage`). Un contratista con solo `project:view` ve el proyecto y su repo y nada más.

La tabla vive en `frontend/lib/nav.ts` como datos (`{id, label, href, anyOf, source: 'aggregate'|'org'|'project', badge?}`), con una prueba que exige que todo `anyOf` exista en `catalog.json` (un permiso renombrado rompe el build).

### 2.3 Estados

| Estado | Comportamiento |
|---|---|
| Cargando | Esqueletos (`aria-busy="true"`, `role="status"` "Cargando menú"). Solo Projects y Settings visibles; nunca un menú permisivo transitorio. |
| Error | Aviso `role="alert"` con "Reintentar"; solo Projects y Settings. Se reintenta con backoff 2, 4, 8 s (máx. 3) y manualmente. |
| Vacío | Contador 0 en Projects y mensaje "No tienes acceso a ningún proyecto todavía" con el nombre de la org. |
| Suspendido en la org | Aviso en lugar del menú y selector de organización activo para cambiar. |
| Revocado en caliente | Si un 403 o un cambio de `epoch` quita una sección en la que estás, se redirige a la primera sección visible con un aviso `role="status"`. |

Contadores: `aria-label` descriptivo ("3 pendientes de aprobar"), tope visual "99+", los de bajo valor informativo en estilo `quiet`.

### 2.4 Móvil (< 760 px)

Barra superior con botón de menú (40 px, `aria-expanded`, `aria-controls`), logo, insignia de la org. El menú es un cajón que se superpone al contenido con fondo atenuado; foco atrapado dentro, `Escape` y toque fuera lo cierran y devuelven el foco al botón. Selector de organización dentro del cajón. Las tablas pasan a tarjetas apiladas.

### 2.5 Accesibilidad del sidebar

`<aside aria-label="Navegación principal">`; cada grupo es `<nav aria-label="Organización|Proyecto {nombre}|Plataforma">`; la entrada activa lleva `aria-current="page"`; los encabezados de sección son texto (no botones) salvo que se plieguen (entonces `button` con `aria-expanded`). Selector de organización: botón con `aria-haspopup="listbox"` y lista `role="listbox"`/`option` con `aria-selected`; flechas arriba/abajo, `Home`/`End`, escritura para saltar, `Enter` confirma, `Escape` cierra. Enlace "Saltar al contenido" como primer elemento. Orden de tabulación = orden visual. Los iconos son decorativos (`aria-hidden`).

## 3. Usuarios y grupos (`mockups/users-groups.html`)

Pestañas (`role="tablist"`, flechas izquierda/derecha): Personas, Grupos, Roles, Invitaciones, Tokens.
- **Personas:** tabla con persona, rol de organización (insignia), grupos, nº de proyectos con acceso, estado (activa, suspendida), caducidades próximas. Filtros por rol, grupo y estado; búsqueda; paginación por cursor ("Cargar más"). Menú de fila con Suspender, Cambiar rol, Quitar, Ver permisos efectivos, Simular.
- **Panel de persona:** rol de organización (selector con plantillas del sistema y personalizadas), grupos (añadir/quitar), asignaciones propias, y avisos de interacción ("la directa viewer sustituye a la base; sí suma deployer por el grupo X").
- **Grupos:** lista con miembros y resumen de asignaciones; editor con miembros, asignaciones por alcance y caducidad. Aviso permanente: añadir a un grupo es una concesión (regla de no-escalada); si el actor no contiene los permisos del grupo, "Añadir" aparece deshabilitado con la razón.
- **Invitaciones:** estados pendiente, aceptada, caducada, revocada; reenviar y revocar. El formulario permite plantilla de organización, grupos y hasta 20 asignaciones iniciales.
- Baja y suspensión piden confirmación con el efecto concreto ("revoca 3 tokens, la saca de 2 grupos, 5 asignaciones"). Último owner: acción deshabilitada con "Una organización necesita al menos un owner".
- Transferir propiedad: asistente de 3 pasos (elegir destinatario, reautenticar, esperar aceptación).

## 4. Editor de plantillas (`mockups/template-editor.html`)

- Catálogo agrupado por `group` (Proyecto, Despliegues y entornos, Bases de datos, Repos y CI, Red y gateway, Seguridad, Backups, Dominios y correo, Variables y secretos, Miembros y acceso, Organización, Facturación, Auditoría, Tokens), cada grupo en un `fieldset`/`legend` con contador "3 de 14", plegable.
- Cada permiso: casilla, identificador monoespaciado, descripción, insignia "sensible" (texto, no solo color). Las dependencias se marcan solas y quedan bloqueadas con la razón; quitar la dependiente las libera.
- Búsqueda y filtro "solo marcados". Acciones por grupo "marcar solo lectura" (todos los `:read`).
- Panel lateral fijo: impacto (personas, grupos, proyectos; permisos que se ganan y se pierden), historial de versiones con "comparar", nota de versión obligatoria al publicar.
- Plantillas del sistema: vista de solo lectura con botón "Clonar". Plantillas en uso: "Archivar" en lugar de borrar.
- Solo se pueden marcar permisos que el actor posee; los demás aparecen deshabilitados con "No puedes conceder lo que no tienes".

## 5. Asignaciones por proyecto, repo y entorno (`mockups/assignments.html`)

Página "Acceso del proyecto" (`assignment:read`), pestañas Proyecto, Repositorio, Entornos. Tabla: sujeto, plantilla efectiva, "por qué" (floor de organización, base, directa, grupo), caducidad (`Renovar`, `Revocar`). Formulario "Dar acceso": persona o grupo, alcance, plantilla, caducidad, motivo (obligatorio con caducidad), con el diff de permisos que se ganarían y la confirmación de que el actor puede concederlos. Política del proyecto (hereda / abierta / restringida) con el diálogo de confirmación "WOULD_HIDE" que lista a quién se oculta, incluido el actor. La pestaña Repositorio muestra el nivel Forgejo (`read`/`write`) y deja claro que Capsule gobierna protecciones, ajustes y secretos. La pestaña Entornos lista aprobadores (`promotion:approve`) como asignaciones.

## 6. Simulador (`mockups/simulator.html`)

Formulario persona + permiso (con autocompletado del catálogo) + alcance + token opcional. Resultado con veredicto en texto y un rastro numerado (membresía, plantilla de org, política, base, asignaciones propias, grupos, techo, token, decisión) en una lista ordenada `<ol>`; el paso decisivo resaltado; cada paso enlaza a la asignación o plantilla que lo causó. Bloque "¿Qué pasaría si...?" con hasta 20 asignaciones hipotéticas y el diff. Pestaña "Explicarme" para cualquier usuario sobre sí mismo (`/me/permissions/explain`). Región `aria-live="polite"` en el veredicto.

## 7. Estados comunes y textos

| Situación | Texto |
|---|---|
| Sin permiso en una acción visible | "No tienes permiso para esto. Necesitas `X` en {alcance}. Pide a un administrador." (si el servidor devuelve `details.missing`) |
| Recurso no visible | página 404 estándar (no distingue "no existe" de "no tienes acceso") |
| Token | "Este token no incluye `X`" |
| Caducada | "El acceso expiró el {fecha}" |
| Errores 409 | `LAST_OWNER`: "Una organización necesita al menos un owner"; `MIXED_ASSIGNMENTS`: "Esta persona tiene asignaciones personalizadas; elige reemplazar todas" ; `SYSTEM_TEMPLATE`: "Las plantillas del sistema no se editan: clónala" |

Ningún texto visible usa las palabras demo, simulado ni ficticio para datos reales (regla del proyecto).

## 8. Contexto público (fase P, `mockups/public-view.html`)

- **Vista pública** `/public/git/{org}/{repo}`: layout propio fuera de `(dashboard)`: barra con logo, insignia **"Público"** (`info`, con texto), sin menú del dashboard, sin selector de organización, sin enlaces a rutas internas. El botón principal es "Contribuir con GitHub". Árbol, ramas, commits (nombre de autor), README, releases, URL de clon anónimo con botón copiar. Aviso fijo "Solo lectura".
- **Distinguir contexto:** fondo ligeramente distinto (`bg-(--bg-subtle)`), insignia "Público" siempre visible, título del documento con prefijo "Público ·". El visitante autenticado con GitHub ve su login y "Cerrar sesión", nunca el dashboard. Un usuario de Capsule que abre la vista pública ve la vista pública (con un enlace discreto "Abrir en el dashboard" si tiene `git:read` en ese repo).
- **PR externo:** paso 1 identificarse con GitHub (aviso explícito de que no se crea cuenta ni permisos), paso 2 elegir origen (rama de su GitHub o parche), paso 3 seguimiento en "Mi contribución" (estado, CI "no ejecutado", conversación visible para quien contribuye). Mensaje de CI: "El CI no se ejecuta hasta que un mantenedor lo apruebe y corre aislado y sin secretos".
- **Dashboard:** insignia "Público" junto al nombre del repo; pestaña "Contribuciones externas" para mantenedores (`git:read`) con botón "Ejecutar CI sin confianza" (`ci:run`); en Ajustes del repo, tarjeta de visibilidad con la política de la organización, diálogo de publicación (análisis previo, escribir `org/repo`, casilla de irreversibilidad, reautenticación) y botón "Volver a privado" inmediato y sin fricción. El sidebar muestra, a quien tiene `org:public-repos-policy`, un aviso permanente si hay repos públicos.
- Diálogos con `role="alertdialog"`, foco inicial en el título, el botón destructivo deshabilitado (`aria-disabled`) hasta cumplir los requisitos, motivo del bloqueo en texto.

## 9. Accesibilidad global

Teclado completo (pestañas con flechas, menús con flechas, `Escape` cierra), roles ARIA como arriba, tablas con `<caption>` (puede ser `sr-only`) y `<th scope>`, estados anunciados con `role="status"`/`alert`, formularios con `label` asociada, errores de campo con `aria-describedby`, contraste según los tokens, nada que dependa solo del color, zoom 200 % sin pérdida de contenido, `prefers-reduced-motion`. Los mockups incluyen un enlace "Saltar al contenido" y foco visible; las pruebas de aceptación de P9 exigen revisión con `axe` sin errores graves y un recorrido solo con teclado.
