# Git Capsule: UX y arquitectura de información

Principio del dueño (SPEC §1 y §4.2): **los repos viven en el dashboard** (`app.tumi-ai.com/git/{org}/{repo}`), con la sesión, navegación y diseño de Capsule y marca Git Capsule; Forgejo es motor y respaldo, y `git.tumi-ai.com` es el host de clonado. Depende de `SPEC.md` §4.2 (entregas) y de `API.openapi.yaml`. Mockups abribles en navegador: `mockups/*.html` (CSS inline, sin dependencias).

## 1. Dónde vive en el dashboard actual

Estado actual (V): barra lateral con Projects, Deployments, **Git** (`/git`), Databases, Storage, Email, Domains, AI & Keys, Users, Settings (`components/layout/sidebar.tsx`). La página de proyecto (`app/(dashboard)/projects/[slug]/page.tsx`) usa pestañas por estado (`overview, deployments, storage, domains, logs, env, ci, git, members, ports, backups, network, settings`); la pestaña `git` configura el enlace de auto-deploy y previews (`components/git-tab.tsx`), `ci` el pipeline (`ci-tab.tsx`).

Decisión: **no se mete todo el repo en la página de proyecto.** El repo tiene su propia área con rutas reales (enlazables, con historial del navegador, como GitHub), y la pestaña `git` del proyecto pasa a ser "Enlace y auto-deploy" con un botón **Abrir repositorio**.

## 2. Rutas

| Ruta | Pantalla | Fuente de datos (operationId) |
|---|---|---|
| `/git` | Mis repositorios (lista por organización, buscador, estado de aprovisionamiento) | existente + `repoGet` |
| `/git/{org}/{proyecto}` | Código (pestaña por defecto) | `repoGet`, `repoTree`, `repoBlob` |
| `/git/{org}/{proyecto}/tree/{ref}/{ruta}` · `/blob/{ref}/{ruta}` | Navegar árbol / archivo | `repoTree`, `repoBlob` |
| `/git/{org}/{proyecto}/commits/{ref}` · `/commit/{sha}` | Historial / commit | `commitsList`, `commitGet`, `commitChecks` |
| `/git/{org}/{proyecto}/branches` | Ramas y etiquetas | `branchesList`, `tagsList` |
| `/git/{org}/{proyecto}/pulls` · `/pulls/{n}` · `/pulls/new` | Pull requests | `pullsList`, `pullGet`, `reviewsList`, `commentsList`, `pullChecks` |
| `/git/{org}/{proyecto}/actions` · `/actions/runs/{id}` | Actions | `runsList`, `runGet`, `jobLogs`, `workflowsList` |
| `/git/{org}/{proyecto}/security` · `/security/alerts/{id}` · `/security/policy` · `/security/suppressions` | Seguridad | `securityOverview`, `alertsList`, `securityPolicyGet`, `suppressionsList`, `renovateGet` |
| `/git/{org}/{proyecto}/environments` · `/environments/{env}` | Entornos y promociones | `envsList`, `envDeployments`, `promotionGet` |
| `/git/{org}/{proyecto}/insights` | Insights y actividad | `insights`, `activityList` |
| `/git/{org}/{proyecto}/settings` (+ `/branches`, `/webhooks`, `/secrets`, `/mirror`, `/members`) | Ajustes | `repoUpdate`, `protectionsList`, `webhooksList`, `ciSecretsList`, `mirrorGet`, `membersList` |
| `/git/{org}/{repo}/commit/{sha}` · `/pulls/{n}/files` | Diff de commit / archivos cambiados de un PR | `commitGet`, `pullFiles` |
| `/approvals` | Aprobaciones pendientes (de toda la org) | `approvalsPending` |
| `/settings/git/tokens` | Tokens de acceso (personales) | `gitTokensList`, `gitTokenCreate`, `gitTokenRevoke` |
| `/settings/git/ssh-keys` | Llaves SSH | `gitSshKeysList`, `gitSshKeyAdd`, `gitSshKeyDelete` |
| `/git/{org}/{repo}/settings/service-tokens` | Tokens de servicio para CI | `serviceTokensList`, `serviceTokenCreate`, `serviceTokenRevoke` |
| `/notifications` | Bandeja | `notificationsList` |
| `/settings/audit` (org admin) | Auditoría | `auditLog` |
| `/git/import` (org admin) | Importar desde GitHub | `importCreate`, `importGet` |

`{org}` y `{proyecto}` son slugs; el frontend los resuelve a UUID con la lista existente de organizaciones y proyectos. Entrega por pantalla (SPEC §4.2): entrega 1 trae todo salvo la **revisión línea a línea** y el **editor de archivos**, que llevan un enlace "Abrir en Forgejo" (`Pull.html_url`, SSO silencioso); la entrega 2 trae comentarios en línea y sugerencias al dashboard, la 3 el editor. `{repo}` es el slug del proyecto.

Estructura Next.js propuesta (paquete B3): `app/(dashboard)/git/[org]/[project]/layout.tsx` (cabecera del repo y pestañas) más `page.tsx` por pestaña; componentes en `components/git/*` (sin tocar `ui/` salvo añadir primitivas). La cabecera del repo y las pestañas son un solo componente `RepoShell`.

## 3. Navegación

- **Barra lateral**: `Git` se mantiene; se añade contador de **Aprobaciones** (insignia) cuando el usuario es aprobador pendiente, y `Notificaciones` en la cabecera (campana).
- **Cabecera de repo**: `org / proyecto` (migas), insignia de visibilidad ("Privado"), estado de aprovisionamiento si no es `ready`, selector de rama, botón de clonado (HTTPS/SSH, copia `capsule git remote`), y a la derecha "Abrir en Capsule" (vuelve a `/projects/{slug}`).
- **Pestañas** (idénticas en orden a GitHub, con los nombres de Git Capsule): **Código · Ramas · Pull requests · Actions · Seguridad · Entornos · Insights · Ajustes**. Issues, Projects, Wiki no aparecen. La insignia de Pull requests muestra abiertos; Seguridad muestra alertas abiertas críticas/altas con color; Entornos muestra aprobaciones pendientes.
- Visibilidad por rol: **Ajustes** solo admin; **Entornos** visible a todos (solo lectura para viewer); botones de acción ocultos (no solo deshabilitados) si el rol no puede, salvo cuando conviene explicar ("Solo admins pueden cambiar la protección": texto + tooltip).

## 4. Pantallas

Convenciones de estados para todas: **carga** = esqueleto con la forma final (no spinner a pantalla completa), **vacío** = icono + frase + acción primaria cuando el rol puede, **error** = banda con código (`error.code`), mensaje, `request_id` copiable y "Reintentar"; errores `UPSTREAM_GIT_ERROR`/`GIT_NOT_READY` muestran banner "El Git está tardando en responder; tus datos están a salvo" (sin culpar al usuario).

### 4.1 Código
- Contenido: README renderizado (Markdown saneado), **explorador de archivos** (árbol en panel izquierdo plegable en pantallas anchas, tabla de carpeta con nombre, último commit y antigüedad), **visor de archivo con resaltado de sintaxis** (resaltador en el cliente, p. ej. Shiki cargado bajo demanda por lenguaje; numeración de líneas con enlaces a `#L12-L20`, copiar contenido, ver crudo, historial de la ruta; sin ejecutar HTML ni SVG del repo: se muestran como texto o en `img` aislado), último commit con insignia de checks, barra lateral "Acerca de" con lenguajes y última etiqueta.
- **Botón Código (Clonar)**: diálogo de tres pestañas, ver 4.1.1.
#### 4.1.1 Diálogo "Código" (clonar)

Tres pestañas (orden por defecto: Capsule, Git, SSH; con detección opcional de SO se reordena la instalación, no la recomendación; ver SPEC 6.5.3). Maqueta: `mockups/clone-dialog.html`.

- **Clonar con Capsule** (recomendada): comando copiable `capsule git clone evvg/web`; línea secundaria "¿No tienes el CLI?" con comando de instalación (`npm i -g @kyntocg/capsule-cli`) y enlace a la guía; nota "Usa tu sesión (`capsule login`) y renueva el acceso solo mientras la sesión viva". Estado si el usuario es viewer: "Acceso de solo lectura".
- **Clonar con Git**: `git clone https://git.tumi-ai.com/evvg/web.git`; bloque plegable "Iniciar sesión desde el navegador (Git Credential Manager)" con las líneas de `git config` (SPEC 6.5.2) y botón de copiar; debajo, "¿No tienes Git Credential Manager? Crea un token de acceso" (enlace a `/settings/git/tokens`, que abre el formulario con el repo preseleccionado y alcance de lectura/escritura según el rol).
- **SSH**: `git clone git@git.tumi-ai.com:evvg/web.git`; si el usuario no tiene llaves, aviso y enlace a `/settings/git/ssh-keys`.
- Pie común: "Descargar ZIP" no existe en v1 (se pospone; no hay endpoint de archivo expuesto para viewers sin auditoría).
- Accesibilidad: pestañas con `role="tablist"`, comandos en `<code>` con botón "Copiar" que anuncia "Copiado" por `aria-live`.
- Vacío (repo sin commits): guía "Empuja tu primer commit" con los tres comandos (`capsule git remote`, `git remote add`, `git push`) y botón "Importar".
- Estados: aprovisionando (`pending`) con progreso y último error; `failed` con botón "Reintentar" (admin).
- Archivos > 1 MiB o binarios: metadatos y enlace "Ver en Forgejo".
- Editar archivo / subir: enlace "Abrir en Forgejo" en entrega 1; editor propio con commit a rama (y PR) en entrega 3.
- Atajos: `t` buscar archivo (cliente, sobre `repoTree`), `y` enlace permanente al SHA, `b` selector de rama, `?` ayuda de atajos.

### 4.2 Ramas
- Tabla con nombre, insignia **Protegida** (enlaza a la regla), ahead/behind frente a la por defecto, último autor/fecha, acciones: crear PR, eliminar (si `git.write` y no protegida). Pestañas "Activas / Todas / Etiquetas".
- Vacío: no ocurre (siempre hay rama por defecto); filtro sin resultados muestra "Sin coincidencias".
- Error al borrar protegida: mensaje con la regla y enlace a ajustes (`PROTECTED_BRANCH`).

### 4.3 Pull requests
- Lista: filtros Abiertos/Cerrados/Fusionados/Borradores, autor, base; cada fila con título, `#n`, autor, estado de checks (punto de color), revisiones (aprobaciones x/N), insignia de preview con URL.
- Detalle: cabecera (título editable, `#n`, rama head→base, estado), pestañas Conversación · Commits · Archivos cambiados (diff unificado de solo lectura en entrega 1 con botón **Revisar línea a línea en Forgejo**; comentarios en línea y sugerencias nativos en entrega 2) · Checks. Columna lateral: revisores, etiquetas, preview, entornos, política.
- **Caja de merge** (el centro de la pantalla): lista de condiciones con ✓/✗ tomadas de `Pull.mergeable.blockers` (checks, revisiones, CODEOWNERS, política de seguridad, ramas al día), selector de estrategia limitado a las permitidas, "Fusionar" (deshabilitado con motivo visible), "Programar auto-merge", "Actualizar rama". Si hay bloqueo de seguridad, enlace a la alerta.
- Conversación: comentarios y revisiones en línea de tiempo; editor Markdown con vista previa; botones Aprobar / Pedir cambios / Comentar (modal con comentario) solo si `git.review`.
- Vacío: "Aún no hay pull requests" + "Nuevo PR" si hay rama distinta a la por defecto.
- Errores: conflicto 409 por cabezal cambiado ("La rama cambió mientras fusionabas; revisa y reintenta").
- Atajos: `g p` ir a PR, `j/k` mover en lista, `c` comentar, `m` ir a caja de merge, `a` aprobar (con confirmación).

### 4.4 Actions
- Lista de ejecuciones (workflow, evento, rama, actor, duración, estado), filtros, botón "Ejecutar workflow" (dispatch con formulario de inputs).
- Detalle de ejecución: grafo simple de jobs (lista con dependencias), logs por job con búsqueda, autoscroll, descarga, "Reejecutar fallidos". Logs enmascarados.
- Vacío: "No hay workflows" + "Crear desde plantilla" (CI Node, SAST, gitleaks, deploy a Capsule). Sin runners: banda "Sin runners en línea; los trabajos esperan" con enlace a estado.
- Estados especiales: `waiting_approval` (ejecución de PR que requiere aprobación (?)).

### 4.5 Seguridad
- Resumen: tarjetas por severidad (crítica, alta, media, baja), tendencia 30 días (línea), estado de herramientas (osv-scanner, Semgrep, gitleaks, trivy, Renovate: última subida y verde/ámbar/rojo), política vigente y si **bloquea merge**.
- Alertas: tabs Dependencias · Código · Secretos; filtros severidad/estado/rama/herramienta; tabla con título, regla, ruta:línea o paquete@versión, severidad, antigüedad. Detalle con descripción, fragmento (sin valor de secretos), traza, versión corregida, "Suprimir..." (formulario: motivo, justificación ≥ 10 caracteres, caducidad obligatoria con selector 30/90/180/365 días) y "Reabrir".
- Renovate: bloque con estado de onboarding, PR abiertos, última ejecución, "Ejecutar ahora".
- Política (admin): umbral por tipo, herramientas requeridas, ramas; vista previa "con esta política X PR habrían sido bloqueados en 30 días".
- Vacío: "Sin alertas" (verde) solo si todas las herramientas requeridas subieron resultados recientes; si no, "Sin resultados todavía: configura el escaneo" con plantillas.
- Seguridad a la UI: contenido de SARIF siempre escapado; valores de secretos jamás.

### 4.6 Entornos
- Tarjetas por entorno (staging, production…) con SHA actual, estado de salud (000033), quién desplegó y cuándo, URL, política resumida (aprobaciones, ventana, espera).
- Botón **Promover a {entorno}** desde el SHA actual del entorno origen: abre diálogo con checks del SHA, alertas abiertas, aprobadores requeridos; crea la promoción.
- Detalle de promoción: línea de tiempo (solicitada → aprobaciones → espera → ventana → despliegue), aprobar/rechazar con comentario (si `env.approve`), cancelar. Historial paginado.
- Configuración de entorno (admin): ramas permitidas, aprobadores (usuarios/roles), N aprobaciones, espera, ventanas con zona horaria, entorno origen requerido.
- Vacío: "Sin entornos" + "Crear staging y production" (plantilla de dos entornos con proyecto hermano).
- Errores: `APPROVAL_REQUIRED`, `SELF_APPROVAL_FORBIDDEN` con explicación.

### 4.7 Ajustes
Subsecciones laterales: General (rama por defecto, merge, eliminar rama), **Protección de ramas** (lista de reglas, editor con vista previa "estas ramas coinciden"), Webhooks (entregas, reenviar), Secretos y variables (repo), Espejo, Miembros (reutiliza `members-tab`), Zona de peligro (archivar). Todo requiere `git.admin`; cada guardado muestra "se aplicará también en Forgejo" y estado de sincronización (`forgejo_synced`).

### 4.8 Aprobaciones (`/approvals`)
Lista de promociones pendientes por proyecto/entorno con SHA corto, autor, tiempo esperando, checks; acciones inline Aprobar/Rechazar (comentario). Vacío: "No tienes aprobaciones pendientes".

### 4.8.1 Tokens de acceso (`/settings/git/tokens`) y llaves SSH
- Tabla: nombre, tipo (efímero de sesión de CLI / personal), alcance (leer/escribir), repos, creado, caduca, último uso (fecha e IP), estado; acciones **Revocar**. Los efímeros se listan agrupados bajo "Sesiones del CLI" (revocar la sesión revoca sus tokens).
- **Crear token**: nombre, alcance (leer o escribir), repos (todos los accesibles o selección), caducidad (7, 30, 60, 90 días; sin "sin caducidad"). Al crear, el valor se muestra una sola vez con botón Copiar y aviso; instrucciones de uso como contraseña HTTPS.
- Vacío: "Aún no tienes tokens. Con `capsule git clone` no los necesitas." Error: caducidad fuera de rango, rol insuficiente para escritura (explica el rol).
- Aviso 7 días antes de caducar (notificación). Los tokens de servicio de CI se gestionan en Ajustes del repo y llevan insignia "Servicio".
- Llaves SSH: lista con huella y último uso, "Añadir llave" (título, pegar clave pública), eliminar.

### 4.9 Notificaciones, Auditoría, Importar
Bandeja con filtro "No leídas" y marcar todas; Auditoría con filtros (acción, actor, proyecto, fechas) y exportación CSV (`auditLog`); Importar con asistente de 3 pasos (token efímero → repos → resultado por repo con errores).

## 5. Accesibilidad y responsive

- WCAG 2.2 AA: contraste ≥ 4.5:1 (los tokens actuales cumplen en texto primario; `--text-muted #444` **no** cumple sobre `#000`: no usarlo para texto informativo, solo decorativo). Foco visible con `--border-focus`, orden de tabulación lógico, `aria-current="page"` en la pestaña activa, `role="tablist"`/`tab` en pestañas internas, tablas con `<th scope>`, estados no solo por color (icono + texto), `aria-live="polite"` en cambios de estado de checks/despliegue y regiones de logs con `role="log"`, modales con trampa de foco y `Esc`.
- Atajos: `?` abre la guía; no usar teclas de una letra sin poder desactivarlas (ajuste "Atajos de teclado").
- Responsive: ≥1024 px dos columnas (contenido + lateral); 640-1023 px lateral colapsa bajo el contenido; <640 px pestañas con scroll horizontal, tablas pasan a tarjetas, caja de merge fija al fondo en detalle de PR. Sin scroll horizontal de página; el árbol de archivos usa lista simple en móvil. El diff no se muestra en el dashboard (v1), por lo que no hay problema de ancho.
- Idioma: español; fechas relativas con `title` absoluto en zona del usuario.

## 6. Diseño visual

Tokens heredados de `frontend/app/globals.css` (V): fondo `--bg-base #000000`, `--bg-subtle #0c0c0c`, `--bg-surface #111111`, `--bg-raised #1e1e1e`, `--bg-overlay #262626`; bordes `rgba(255,255,255,.09/.16)`; texto `#ededed` / `#888888`; acento `--accent #7c3aed`, `--accent-light #a78bfa`, `--accent-dim rgba(124,58,237,.12)`; estados `--success #22c55e`, `--warning #f59e0b`, `--error #ef4444`, `--info #3b82f6`; radios 4/6/8/12; tipografía Geist Sans y Geist Mono (`--font-geist-*`). Solo tema oscuro hoy.

Reglas para Git Capsule:
- Tipos: cuerpo 14 px/20, tablas 13 px, código y SHA en Geist Mono 12-13 px; títulos de pantalla 20 px/600.
- Semántica de color fija: verde = éxito/aprobado, ámbar = pendiente/espera, rojo = fallo/rechazado/crítica, azul = informativo/preview, violeta = acción primaria y selección. Severidades: crítica `#ef4444` sólido, alta `#f97316`, media `--warning`, baja `--info`, info `--text-secondary`.
- Insignias: pastilla con `--*-dim` de fondo y color del estado, radio 999 px, 12 px.
- Densidad: filas de tabla 40 px; tarjetas con `--bg-surface` y borde `--border`.
- El tema de Forgejo (SPEC §4.1) usa los mismos valores para que el paso entre ambos no se note.

## 7. Guía de marca

- **Nombre**: "Git Capsule" (siempre dos palabras; en código `git-capsule`, comando `capsule git`). Nunca "Capsule Git", "GitCapsule", ni "el GitHub de Capsule" en la interfaz.
- **Logo textual**: marca denominativa `Git Capsule` en Geist 600, precedida por el isotipo de cápsula horizontal (rectángulo de esquinas totalmente redondeadas dividido en dos mitades, la izquierda violeta `#7c3aed` y la derecha contorno). Variantes: horizontal (cabecera), solo isotipo (favicon, avatar de repo por defecto), monocromo (correos). Espacio de respeto = alto de la "C". Mínimo 16 px de alto del isotipo. Los archivos finales (SVG) los entrega el paquete A3; hasta entonces el mockup usa un SVG inline provisional.
- **Iconografía**: set de línea (stroke 1.5-2 px, extremos redondeados, 16/20 px), el mismo estilo de los iconos inline actuales de `sidebar.tsx`. Conceptos fijos: rama (dos nodos y una línea), PR (nodo-flecha), commit (círculo con línea), seguridad (escudo), entorno (capas), aprobación (check en círculo), Actions (reproducir en círculo).
- **Tono**: técnico, directo, en segunda persona de tú; frases cortas; errores dicen qué pasó, por qué y qué hacer (no culpar); sin signos de exclamación ni jerga de marketing; sin emojis en la interfaz; terminología: "pull request" se conserva (no "solicitud de extracción"), "rama", "fusionar", "confirmación" no se usa (se dice "commit"), "Entorno", "Aprobación", "Alerta", "Supresión". Ninguna cadena visible contiene las palabras demo, simulado o ficticio (regla del proyecto).
- **Correo y webhooks**: asunto `[Git Capsule] {org}/{proyecto}: {evento}`; remitente "Git Capsule"; pie con enlace a preferencias.

## 8. Mockups

| Archivo | Muestra |
|---|---|
| `mockups/repo-code.html` | Cabecera de repo, pestañas, tabla de archivos, README, lateral |
| `mockups/pull-request.html` | Detalle de PR con caja de merge y bloqueos |
| `mockups/security.html` | Resumen de seguridad y lista de alertas |
| `mockups/environments.html` | Entornos y aprobación de promoción a producción |
| `mockups/clone-dialog.html` | Diálogo Código con pestañas Capsule / Git / SSH |

Son referencia visual, no código de producción: usan los tokens de la sección 6 con CSS inline.
