# Variables y secretos (vault por capas)

Capsule no tiene un vault aparte: las **variables marcadas `--secret`** cumplen ese papel, en tres capas.
Precedencia al desplegar (gana la de arriba): **deploy > proyecto > cuenta**.

| Capa | Alcance | Comandos |
|---|---|---|
| Cuenta (organización) | todos los proyectos de la org | `capsule vars list [--reveal]` · `vars set K=V [K2=V2] [--secret] [--scope build\|runtime\|both]` · `vars delete K` |
| Proyecto | un proyecto | `capsule env list\|get K\|set K=V [--secret] [--scope]\|delete K\|pull\|push` |
| Deploy | solo ese deployment | `capsule deploy --env K=V --env-file f` (en la acción: `env:` y `secret-env:`) |

```bash
capsule vars set SMTP_HOST=smtp.ejemplo.com                      # compartido, no secreto
capsule env set API_URL=https://api.ejemplo.com --scope runtime  # propio del proyecto
capsule env set STRIPE_KEY="$STRIPE_KEY" --secret                # el valor viene de una variable de shell ya cargada
capsule env list                                                 # los secretos salen como ***
capsule deploy --env FEATURE_X=1                                 # solo este deployment
```

## Reglas

- **Dónde poner cada cosa**: lo compartido (claves de IA, SMTP, URLs comunes) en **cuenta**; lo propio en
  **proyecto**; **deploy** solo para valores puntuales. Cambiar una variable de cuenta afecta a todos los
  proyectos: confirma con el usuario.
- Marca `--secret` en todo lo sensible. `list`/`get`/`pull` enmascaran (`***`). Solo `capsule vars list --reveal`
  muestra el valor, únicamente a owner/admin de la org: no lo uses salvo que el usuario lo pida, y no
  imprimas el resultado en el chat.
- Las claves se guardan en mayúsculas. Un valor de la capa superior reemplaza la entrada entera, scope incluido.
- **Scope**: solo `runtime` y `both` se inyectan hoy en el contenedor. `build` aún **no** se aplica a la
  construcción: no dependas de él para `NEXT_PUBLIC_*` u otras variables de build.
- Las variables de deploy se guardan cifradas, los reintentos las conservan y el deployment solo expone sus nombres.
- Un valor pasado como `K=V` queda en la lista de procesos del equipo mientras corre el comando. Usa una variable de
  shell (`"$X"`) en vez de escribir el literal, y no lo copies al historial ni a archivos del repo.

## Trampas de `pull` y `push` (verificadas en el código)

- `capsule env pull --output .env` escribe **`***` en lugar de los valores secretos**. Si luego haces
  `capsule env push --overwrite`, sobrescribirías los secretos reales con `***`. No hagas pull -> push de un
  proyecto con secretos.
- `capsule env push --input f` sube todo como **no secreto** (`is_secret=false`). Vuelve a marcar lo sensible con
  `capsule env set K="$K" --secret`. Sin `--overwrite` salta las claves existentes.
- `.env` y `.npmrc` nunca se commitean.

## Secretos de CI (distintos de las variables de despliegue)

Los secretos y variables que lee un **workflow** (`${{ secrets.X }}`) viven en el almacén de Actions, no en
`capsule env`:

```bash
printf %s "$VALOR" | capsule ci secrets set NOMBRE          # stdin o --from-env VAR; nunca argv
capsule ci secrets set NOMBRE --from-env MI_VAR --org-wide   # almacén de la organización
capsule ci secrets list [-q]   ;   capsule ci secrets delete NOMBRE -y
capsule ci variables set NOMBRE --value valor                # las variables de Actions no son secretas
```

Ver `ci-workflows.md`. En GitHub, la acción `actions/vars` sincroniza variables de cuenta o proyecto desde un
bloque `KEY=VALUE` enmascarando los secretos en el log (`secret: true`).

## Secretos que se muestran una sola vez

`client_secret` de OAuth, secreto de firma de webhook y valor de un token nuevo: guárdalos en el acto como secreto
(`capsule env set … --secret` o el almacén de CI) y no los repitas.
