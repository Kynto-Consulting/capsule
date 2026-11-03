# Git Capsule: documentación de producto y plan de construcción

Estado: especificación 0.1 (2026-11-02). Solo documentación: no hay código de producto nuevo. Fuentes oficiales de Forgejo consultadas están citadas con (V); lo no verificado lleva (?) con la ruta exacta a mirar.

## Orden de lectura

1. `SPEC.md`: visión, principios, qué existe ya, mapa de paridad con GitHub, comportamiento por área, modelo de amenazas, acceso de clientes Git (tokens, credential helper, Git Credential Manager), decisiones del dueño.
2. `API.openapi.yaml`: contrato único (OpenAPI 3.1, 137 operaciones, `x-status`, `x-permission`, webhooks salientes).
3. `UX.md` + `mockups/*.html`: arquitectura de información, pantallas, diálogo de clonado, tokens, accesibilidad, marca.
4. `CLI.md`: árbol de comandos (`capsule git|pr|branch|workflow|runs|security|environments|promote|approvals|webhooks|recover`), códigos de salida, `git clone` y credential helper.
5. `WORKBREAKDOWN.md`: 18 paquetes en 3 oleadas con propiedad de archivos, migraciones 000034-000057 y criterios de aceptación.
6. `DR-BACKUP.md`: recuperación total, `recover`, simulacro, RPO/RTO, lo no cubierto.

## Resumen de una página

- **Producto**: Git Capsule es el Git, la revisión de código, el CI/CD y la seguridad de Capsule, con apariencia y vocabulario cercanos a GitHub y marca propia. **Los repos viven en el dashboard** (`app.tumi-ai.com/git/{org}/{repo}`): Código, Ramas, Commits, Pull requests, Actions, Seguridad, Entornos, Ajustes.
- **Motor**: Forgejo (en `git.tumi-ai.com`) aporta almacenamiento Git, protocolos HTTPS/SSH, merges, protecciones de rama, equipos y Actions. Su web queda como respaldo con tema Git Capsule; el dashboard habla con Forgejo solo a través del backend (token de servicio + `Sudo`).
- **Autoridad**: Capsule decide identidad (OIDC), permisos (viewer/deployer/admin -> equipos sincronizados), despliegues y aprobaciones.
- **Lo que Forgejo no tiene y construye Capsule**: entornos con aprobaciones y ventanas, alertas de seguridad con SARIF, supresiones con caducidad, políticas que bloquean merge, webhooks salientes de producto, auditoría unificada, tokens de acceso Git de corta duración, recuperación total.
- **Seguridad seleccionada**: Renovate sustituye a Dependabot; Semgrep + reglas propias, osv-scanner, gitleaks y trivy sustituyen a CodeQL; CI en runners aislados; PR de forks fuera de la v1.
- **Clonado**: `capsule git clone` (sesión del CLI, token efímero por repo con renovación), `git clone` por HTTPS (navegador con Git Credential Manager, o token personal) y SSH.
- **Entrega**: E1 con todas las pantallas salvo revisión línea a línea y editor de archivos (enlace a Forgejo); E2 trae la revisión línea a línea; E3 el editor.
- **Plan**: Oleada A (núcleo, 7 paquetes), B (API, CLI, web x3, workflows, seguridad, CODEOWNERS/auto-merge, 8 paquetes), C (importación/espejo, auditoría, recuperación, 3 paquetes).
- **Recuperación**: `capsule recover plan|apply|verify` por proyecto o total, simulacro mensual en instancia efímera, RPO/RTO objetivo (Git 6 h / plataforma 4 h, no medido hasta el primer simulacro).

## Honestidad sobre la verificación

- Verificado leyendo documentación de Forgejo: personalización, ramas/etiquetas protegidas (patrón), Actions (referencia, seguridad, diferencias con GitHub), webhooks, PR/CODEOWNERS, proveedor OAuth2, cheat-sheet parcial; y documentación de Git Credential Manager (OAuth genérico). Lo que esas páginas no dicen (opciones concretas de protección de rama, estrategias de merge, auto-merge, borrador, artefactos/caché, secretos de organización, API de usuarios admin, proxy inverso en git-over-HTTP, IDs de cliente preregistrados) está marcado (?).
- `API.openapi.yaml` se validó con PyYAML y `openapi-spec-validator` en un entorno aislado. Las rutas `in-progress` se confirman al aterrizar el trabajo de otros agentes.
- Nada se ejecutó contra Forgejo, GitHub, AWS ni Terraform.
