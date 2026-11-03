# Seguridad: alertas, SARIF, Semgrep, Renovate, políticas

Forgejo no trae alertas ni escaneo. Capsule las construye: ingesta de **SARIF 2.1.0**, alertas deduplicadas,
supresiones con caducidad y políticas que bloquean merge o despliegue. **CodeQL y Dependabot no existen**: los
sustituyen Semgrep (SAST), gitleaks (secretos), osv-scanner (dependencias), trivy (imágenes/IaC) y Renovate.

## Fuentes y herramientas

| Tipo (`--kind`) | Herramienta | Dónde corre |
|---|---|---|
| `code` | Semgrep + reglas propias (`deploy/forgejo/sast/rules`) | workflow `sast.yml` en PR y push a rama protegida |
| `secret` | gitleaks | workflow `gitleaks.yml`; el valor **nunca** se guarda, solo huella, ruta, línea y regla |
| `dependency` | osv-scanner (+ Renovate para PR de actualización) | `security-audit.yml` semanal y en PR |
| imágenes/IaC | trivy | `trivy.yml` |
| otras | cualquier herramienta que emita SARIF | `--tool nombre` |

Plantillas: `capsule workflow new --template sast|gitleaks|trivy`. Mantener versiones y reglas: skill
`capsule-ci-maintenance`.

## Subir resultados desde CI (SARIF)

Token de CI de alcance **`security:write`**, limitado a **un proyecto** (solo puede subir SARIF de ese proyecto y
consultar el estado):

```bash
capsule tokens create --name ci-sarif --scope security:write --project <project-id>   # una sola vez; directo a secreto
```

En el workflow de Forgejo (secretos `CAPSULE_TOKEN`, `CAPSULE_ORG_ID`, `CAPSULE_PROJECT_ID`, `CAPSULE_API_URL`):

```yaml
- run: semgrep --config <ruta-de-reglas> --sarif -o semgrep.sarif .
- run: capsule security sarif upload semgrep.sarif --sha "$GITHUB_SHA" --ref "$GITHUB_REF_NAME" --tool semgrep --wait
```

Flags de `sarif upload`: `--sha`, `--ref` (por defecto `GITHUB_SHA`/`GITHUB_REF_NAME`), `--tool`, `--pr N`, `--wait[=10m]`,
`--idempotency-key`. Hace gzip + base64 solo (máximo 10 MiB comprimido, 5000 alertas por subida). Estado:
`capsule security sarif status ID`. Una alerta pasa a `fixed` cuando una subida posterior de la misma herramienta y
rama por defecto ya no la contiene. El SARIF se trata como dato no confiable (nunca se renderiza HTML).

## Consultar y triar

```bash
capsule security overview                                    # conteos por severidad/tipo, último escaneo, si la política bloquea
capsule security alerts list --state open --severity high --kind code --branch main --tool semgrep
capsule security alerts show ID
capsule security scan --tools semgrep,gitleaks --ref main --wait    # lanzar un escaneo (osv-scanner, semgrep, gitleaks, trivy)
```

Severidades: `critical|high|medium|low|info` (Semgrep ERROR=high, WARNING=medium; CVSS>=9 critical, >=7 high, >=4
medium; gitleaks siempre high).

### Descartar (con justificación y caducidad obligatorias)

```bash
capsule security alerts dismiss ID --reason false_positive --why "es una fixture de pruebas sin uso real" --expires 90d
capsule security alerts reopen ID
capsule security suppressions add --rule-id <rule-id> --path-glob "tests/**" --reason used_in_tests --why "datos de prueba" --expires 60d
capsule security suppressions list ; capsule security suppressions remove ID -y
```

- `--reason`: `false_positive`, `wont_fix`, `used_in_tests`, `risk_accepted`. `--why` >= 10 caracteres.
  `--expires` obligatorio (máx. 365 d; 180 d para critical/high). Sin `--why` o `--expires`: exit 2.
- La ruta glob no puede ser `**`. Al caducar la alerta vuelve a `open`.
- **Descartar critical/high exige admin y confirmación del usuario.** Nunca descartes una alerta para "hacer pasar"
  un PR sin que el usuario lo haya decidido; la corrección es arreglar el código.
- Los valores de `secret` nunca se guardan; si gitleaks encuentra un secreto real: **rótalo** (el repo ya lo expuso),
  no basta con descartar la alerta.

## Políticas que bloquean

```bash
capsule security policy show
capsule security policy set --block-merge-on dependency=high,code=high,secret=any \
      --block-deploy-on high --require-tools semgrep,gitleaks --branches main,release/** --max-suppression-days 180
```

- `--block-merge-on`: por tipo, niveles `off|critical|high|medium|low` (para `secret`: `off|any`).
- `--block-deploy-on`: `off|critical|high`.
- Se aplica con el check `capsule/security` (exígelo en la rama: `capsule git protect set main --block-on-security
  --checks "capsule/security"`). Solo bloquean alertas **nuevas** del PR frente a la base; la política de
  despliegue sí mira las abiertas en el SHA. Si una herramienta requerida no subió resultados en 30 min, el check
  queda en `failure` ("falla cerrado").
- Exit 5 `POLICY_BLOCKED` en `pr merge`: `capsule pr view N` y `capsule security alerts show ID`.
- **Aflojar la política requiere confirmación del usuario**.

## Renovate (actualizaciones de dependencias)

Bot autoalojado con cuenta no admin (`deploy/forgejo/renovate`). Los PR de Renovate pasan por las mismas
protecciones; automerge solo de parches de devDependencies con checks verdes.

```bash
capsule security renovate show
capsule security renovate enable [--preset NOMBRE] [--schedule EXPRESION]   # valores según el servidor; ver `--help`
capsule security renovate run                     # ejecutar ahora
capsule security renovate disable
```

El dashboard de dependencias de Renovate está apagado (Issues oculto); el estado se ve en la pestaña Seguridad.
