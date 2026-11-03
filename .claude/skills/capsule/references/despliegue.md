# Desplegar y verificar

## Enlazar y desplegar

```bash
capsule link                      # enlaza la carpeta con un proyecto (.capsule.json)
capsule projects list --org ORG
capsule projects create --org ORG --name "Web" --slug web --runtime node    # runtimes: go, node, python, rust
capsule deploy                    # compila en el servidor (Dockerfile si existe, si no autodetecta)
```

`capsule deploy` (flags verificados):

| Flag | Uso |
|---|---|
| `--env K=V` (repetible), `--env-file f` | variables **solo de este deployment** (ganan a proyecto y cuenta) |
| `--ref`, `--sha`, `--pr` | metadatos de Git del deployment (en GitHub Actions se rellenan solos) |
| `--timeout 20m` | espera máxima (por defecto 10m) |
| `--strict-connections` | exit 5 si hay hallazgos critical/warning de conexiones internas no suprimidos |
| `--ignore-connections` | no imprime el informe de conexiones |
| `-y` | omite confirmaciones (p. ej. cambios sin commitear) |
| `--org`, `--project` | contexto explícito |

Estados: `queued -> building -> deploying -> success | failed`. En CI el comando termina con código distinto de
cero si falla, se cancela o se agota el tiempo; en GitHub Actions escribe `url=` y `deployment-id=` en
`$GITHUB_OUTPUT` y un resumen en `$GITHUB_STEP_SUMMARY`.

**Producción**: desplegar a producción lo pide o aprueba el usuario. Si el proyecto tiene entornos con política,
no despliegues directo: usa `capsule promote` (ver `entornos-aprobaciones.md`).

## Verificar (siempre)

```bash
capsule deployments list                         # historial
capsule deployments get --id <deployment-id>
capsule logs build                               # build del último deployment (o: logs build <id> -f)
capsule logs runtime --tail 200 -f               # contenedor en ejecución (proyectos docker)
curl -sS -o /dev/null -w "%{http_code}\n" https://<slug>.apps.tumi-ai.com/   # debe dar 200
```

Si falla: `capsule logs build -f` y, para un resumen asistido, `capsule ai explain-failure --deployment <id>`.

## Cancelar y volver atrás

```bash
capsule deployments cancel --id <id>
capsule deployments rollback     # vuelve a desplegar el último exitoso anterior (o el último exitoso si el más reciente falló)
```

`rollback` en producción: pide confirmación al usuario primero. Con entornos protegidos puede saltarse espera y
ventana pero no la aprobación si la política lo exige.

## Previews por pull request

```bash
capsule previews list
capsule previews create --pr 42 --ref feature/x --sha "$(git rev-parse HEAD)"
capsule previews delete 42
```

Requiere vínculo Git con previews activas (`capsule git link ... --previews`). Un token `deploy` puede
crearlas y borrarlas desde CI. Ver `git-capsule.md`.

## Otros recursos del proyecto

```bash
capsule workers create --name w --command 'node worker.js' [--restart unless-stopped]
capsule workers list|get ID|start ID|stop ID|delete ID ; capsule logs workers ID --tail 100
capsule crons create --name limpieza --schedule "0 2 * * *" --command 'node scripts/clean.js' [--timezone America/Lima]
capsule crons list|get ID|trigger ID|delete ID ; capsule logs cron --tail 100
capsule domains add app.ejemplo.com [--type redirect --redirect-to https://...]   # luego mostrar DNS requerido
capsule domains list ; capsule domains verify <id> ; capsule domains remove <id>
capsule scale web --replicas 2 --min 1 --max 5 --cpu-threshold 75
capsule storage create --name assets [--public] ; capsule storage list ; capsule storage presign s3://bucket/clave --expires 3600
capsule email setup --domain ejemplo.com ; capsule email dns ; capsule email test --to a@b.com
```

- Los crons ejecutan el comando **dentro del contenedor del proyecto** (pueden leer sus variables). Comandos entre
  comillas simples.
- Crear o borrar workers/crons es administración: requiere sesión normal, no un token `deploy`.
- `--public` en `storage create` expone el bucket a lectura pública: pide confirmación.
- `domains add` no cambia el DNS: el usuario pone los registros que muestra el comando.

## Exportar e importar

`capsule export -o proyecto.zip` (flags `--no-envs`, `--no-logs`, `--no-deployments`, `--max-logs N`) y
`capsule import -i proyecto.zip --dry-run` primero; `--only-envs` restaura solo variables. El zip puede contener
nombres y valores de variables: trátalo como secreto y no lo subas a Git.

## Escribir configuración para agentes

`capsule init` genera `.claude/CLAUDE.md`, `.cursor/rules/capsule.mdc` y un workflow de deploy en
`.github/workflows/capsule-deploy.yml`, y añade `.capsule.json` a `.gitignore`. `--force` sobrescribe.
