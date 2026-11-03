---
name: capsule-ci-maintenance
description: Mantiene al día el CI/CD autoalojado de Capsule (Forgejo, ejecutores, Renovate, Semgrep y reglas propias, gitleaks, trivy, osv-scanner, versiones de la Action y del CLI). Úsala cuando pidan actualizar versiones fijadas, revisar o ampliar las reglas SAST, refrescar plantillas de workflow, o auditar que las dependencias del CI no estén obsoletas o vulnerables.
---

# Mantenimiento del CI/CD de Capsule

Todo el CI autoalojado vive en `deploy/forgejo/` (Dockerfile de Forgejo, `renovate/`, `sast/`, `workflows/`,
`CHECKLIST.md`) y en `deploy/terraform/runner.tf` (ejecutores). Las versiones están **fijadas a propósito**:
actualizarlas es un cambio deliberado, nunca automático. Esta skill describe cómo hacerlo sin romper nada.

## Reglas que no se negocian

- No despliegues, no apliques Terraform ni reinicies Forgejo desde esta skill: prepara el cambio, valídalo y
  presenta el resumen. El usuario decide cuándo aplicar.
- Un componente por vez y un commit por componente, para poder revertir uno sin perder los demás.
- Los saltos de versión mayor (Forgejo, Postgres, Node, Renovate) nunca se hacen en silencio: lee las notas de
  la versión, lista los cambios incompatibles y pide confirmación.
- Antes de proponer actualizar **Forgejo**, confirma que existe un respaldo reciente (`forgejo dump` a S3, ver el
  runbook) y menciónalo en el resumen.
- Lo descargado (binarios, tarballs, imágenes) es **no confiable**: baja cada cosa a un directorio nuevo y vacío,
  verifica el checksum publicado por el proyecto y nunca ejecutes nada desde ese directorio. No pegues tokens en
  comandos ni en commits; `.env` y `.npmrc` jamás se commitean.
- Si no puedes verificar algo (por ejemplo `semgrep --test` sin Semgrep instalado), dilo; no lo des por probado.

## 1. Inventario de lo que está fijado

```bash
cd D:/Github/Kynto/capsule
grep -rnE "(_VERSION|VERSION)=|ARG [A-Z_]*VERSION|@v[0-9]|@[0-9a-f]{40}|image: |FROM |sha256" deploy/forgejo deploy/terraform/runner.tf actions
```

Arma una tabla: componente, versión actual, dónde está, cómo se verifica (checksum/digest).

## 2. Buscar versiones nuevas (solo lectura)

- Releases en GitHub/Codeberg: `gh api repos/<owner>/<repo>/releases/latest --jq '.tag_name, .published_at'`
  (Renovate `renovatebot/renovate`, Semgrep `semgrep/semgrep`, gitleaks `gitleaks/gitleaks`, trivy
  `aquasecurity/trivy`, osv-scanner `google/osv-scanner`, runner y Forgejo en `codeberg.org/forgejo`).
- Ignora prereleases y versiones con menos de 3 días de publicadas salvo que arreglen una vulnerabilidad
  conocida que nos afecte (en ese caso dilo explícitamente).
- Para cada candidato: lee las notas y anota cambios incompatibles, flags renombrados y nuevos requisitos.

## 3. Actualizar un componente

1. Cambia la versión (y el checksum o digest) en **todos** los lugares del inventario, no solo en uno.
2. Valida lo que corresponda:
   - Terraform: `cd deploy/terraform && terraform fmt && terraform validate`
   - Shell: `bash -n <script>`
   - YAML: que cada workflow y config parsee (`python -c "import yaml,sys;yaml.safe_load(open(sys.argv[1]))" f.yml`,
     o un test de Go con `yaml.v3`)
   - Reglas SAST: `semgrep --test deploy/forgejo/sast/rules` si Semgrep está instalado
   - Plantillas de workflow: que sigan referenciando acciones y versiones que existen
3. Si el componente tiene una forma de prueba real (por ejemplo `renovate --dry-run=full` contra un repo de
   prueba, o correr gitleaks sobre un directorio con un secreto falso conocido), úsala y muestra el resultado.
4. Commit: `chore(ci): bump <componente> a <versión>` con el motivo en una línea.

## 4. Reglas SAST propias (`deploy/forgejo/sast/rules/`)

- Una regla nueva nace de un incidente, un hallazgo de revisión o una vulnerabilidad real. Escríbela con su
  mensaje accionable en español y **dos casos de prueba** (`# ruleid:` y `# ok:`).
- Mide el ruido: córrela contra los repos reales (`semgrep --config deploy/forgejo/sast/rules <repo>`) y ajusta
  hasta que los falsos positivos sean pocos; una regla ruidosa se ignora y deja de proteger.
- No quites una regla porque molesta: baja su severidad o acota los patrones y deja constancia en el commit.
- Recuerda lo que este paquete **no** cubre frente a CodeQL (análisis interprocedural profundo) y, si un hallazgo
  lo exige, propón una regla con `mode: taint` en vez de prometer cobertura que no existe.

## 5. Renovate y alertas de seguridad

- Cambios al preset (`deploy/forgejo/renovate/default.json`) afectan a todos los repos: revisa con
  `renovate-config-validator` si está disponible y prueba en un solo repo con `dryRun` antes de generalizar.
- Revisa el último issue de `security-audit` (osv-scanner) de cada repo: lo crítico y alto se corrige o se
  documenta como excepción con fecha de revisión.

## 6. Cierre

Termina siempre con un resumen: qué se actualizó (de → a), qué se verificó de verdad, qué quedó sin verificar,
y qué debe hacer el usuario a mano para aplicarlo (por ejemplo `terraform apply`, reiniciar el proyecto de
Forgejo, o volver a registrar el ejecutor). Anota la fecha de la revisión en `deploy/forgejo/CHANGELOG.md`.
