# Paquete SAST (sustituto de CodeQL)

CodeQL no se usa: en repositorios privados fuera de GitHub exige licencia GitHub Advanced Security. Este paquete cubre una parte del terreno con herramientas de codigo abierto.

Estructura: `sast.yml` (workflow; copia identica en `../workflows/sast.yml`), `rules/*.yml` (reglas propias de Semgrep), `tests/` (casos `ruleid`/`ok`), `scripts/run-tests.sh`
(`semgrep --validate` + `semgrep --test`), `scripts/summarize.py` (resumen + umbral), `eslint/eslint.config.mjs`.

Publicacion: sube esta carpeta a un repo de la plataforma (p. ej. `platform/sast`) y fija `SAST_REPO` y `SAST_REF` (commit SHA, no rama) como variables de la organizacion;
`SAST_READ_TOKEN` (solo lectura) como secreto. Asi todos los repos usan las mismas reglas y una actualizacion se revisa antes de adoptarse.

## Que corre

| Herramienta | Alcance | Version fijada |
|---|---|---|
| Semgrep OSS | TS/JS/Next.js/React/Node, Go, Python, Dockerfile, Terraform | `semgrep/semgrep:1.183.0` |
| Reglas del registro | `--config p/typescript p/javascript p/react p/nextjs p/nodejs p/golang p/python p/dockerfile p/terraform` | las sirve semgrep.dev en el momento |
| Reglas propias | `rules/*.yml` | version del repo SAST (SHA fijo) |
| gosec | Go | `securego/gosec:2.22.0` |
| Bandit | Python | `bandit==1.8.0` |
| eslint-plugin-security + no-unsanitized | JS/TS | eslint 9.17.0, plugin-security 3.0.1, no-unsanitized 4.1.2 |

Los tags y versiones son los que conozco; confirma que existen antes de usarlos (no se ha podido ejecutar nada desde aqui). Para endurecer, fija las imagenes por digest.

Licencias: el motor Semgrep (LGPL-2.1) es libre. Las reglas del REGISTRO (`p/...`) estan bajo la Semgrep Rules License v1.0, que permite uso interno pero prohibe
redistribuirlas o ofrecerlas como servicio; por eso el workflow las consume en caliente y NO las copia al repositorio. Revisa los terminos vigentes en semgrep.dev antes de
adoptarlas. Si la organizacion no quiere depender de ellas, quita los `--config p/...` y quedan solo las reglas propias (licencia del repositorio) o
reglas vendorizadas con licencia permisiva (anota el origen y la licencia de cada una en el mismo archivo).

Resumen y fallo: cada job escribe una tabla en el job summary y falla segun `SAST_FAIL_ON` (`high` por defecto; `medium`, `low`, `off`). Severidades: Semgrep ERROR=high, WARNING=medium;
gosec/Bandit HIGH/MEDIUM/LOW; ESLint error=high.

## Reglas propias

| Archivo | Reglas |
|---|---|
| `injection.yml` | `$queryRawUnsafe` y plantillas SQL sin parametrizar (Prisma), `eval`/`new Function`, `child_process.exec` con entrada no confiable (taint), SSRF (taint a fetch/axios/got) |
| `react.yml` | `dangerouslySetInnerHTML` |
| `web.yml` | JWT sin `algorithms`, `alg: none`, `jwt.decode` para autenticar, cookies sin flags, CORS comodin con credenciales |
| `crypto.yml` | `Math.random` para tokens/ids, md5/sha1/DES/RC4/ECB, IV fijo, comparacion no constante de secretos/HMAC, secretos escritos en codigo, llaves en logs, llaves a disco |
| `deser-xxe.yml` | `unserialize`, `noent:true` (XXE), `pickle`, `yaml.load`, lxml con entidades |

Todos los mensajes estan en espanol y dicen que hacer. Para proyectos que cifran por campo: no loguear material de llave, no escribir llaves a disco, nonce nuevo por cada AES-GCM (la regla detecta IV literal; un IV
constante definido en otro lugar solo se detecta con taint, ver ruta de mejora) y verificar el authTag.

Pruebas: `bash scripts/run-tests.sh` (requiere `pip install semgrep==1.183.0`). Ni `semgrep --validate` ni `semgrep --test` se han podido ejecutar al escribir estas reglas
(semgrep no estaba instalado y no se instalo software). Lo unico verificado: el YAML de cada regla parsea y el resumen funciona con una salida de ejemplo. Es probable que alguna regla
necesite ajuste de sintaxis o de patron al correr las pruebas por primera vez; hazlo antes de publicar `SAST_REF`.

## Que cubre y que NO cubre frente a CodeQL

Cubre: patrones inseguros conocidos, mala configuracion (cookies, CORS, JWT, cripto), secretos en codigo, taint local simple en el mismo archivo/funcion (exec, SSRF) y una segunda opinion por lenguaje.

NO cubre: el analisis interprocedural profundo de CodeQL (flujo de datos entre funciones, modulos y paquetes, modelado de librerias, consultas de variantes sobre una base de datos del codigo completo). Un dato
peligroso que cruza varias capas (handler -> servicio -> repositorio) puede pasar sin ser detectado. Semgrep OSS hace taint intraprocedural por archivo; el taint entre archivos es de la version de pago. No es equivalente: no lo presentes como tal.

Ruta de mejora: ampliar el modo taint (fuentes/sumideros/sanitizadores propios: `assertSafeUrl`, `shellEscape`, esquemas zod), anadir reglas por cada hallazgo real de revision de codigo o pentest (cada fallo nuevo se convierte en regla con su caso de prueba),
usar `pattern-propagators` para envoltorios internos, ejecutar la revision humana de seguridad sobre los cambios de autenticacion/cripto, y valorar un analizador interprocedural alternativo con licencia compatible si el riesgo lo exige.
