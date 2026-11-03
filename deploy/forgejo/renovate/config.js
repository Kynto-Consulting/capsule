// Configuracion del bot Renovate autoalojado (sustituto de Dependabot version updates).
// El token llega por RENOVATE_TOKEN (variable secreta de Capsule); nunca se escribe aqui.
module.exports = {
  platform: 'forgejo',
  endpoint: 'https://git.tumi-ai.com/api/v1',
  gitAuthor: 'Renovate Bot <renovate@tumi-ai.com>',
  username: 'renovate-bot',

  // Descubre solo repos con el topic "renovate" (o limita por organizacion con autodiscoverFilter).
  // Capsule ("Ejecutar ahora" en Seguridad > Renovate) limita la corrida a un repo con RENOVATE_AUTODISCOVER=false
  // y RENOVATE_REPOSITORIES=org/repo; sin esas variables el bot descubre por topic como siempre.
  autodiscover: process.env.RENOVATE_AUTODISCOVER !== 'false',
  ...(process.env.RENOVATE_REPOSITORIES ? { repositories: process.env.RENOVATE_REPOSITORIES.split(',').map((r) => r.trim()).filter(Boolean) } : {}),
  autodiscoverTopics: ['renovate'],
  // autodiscoverFilter: ['evvg/*'],

  // PR de configuracion en cada repo nuevo; el repo debe tener renovate.json (extends el preset compartido).
  onboarding: true,
  onboardingConfig: { extends: ['local>platform/renovate-config'] },
  requireConfig: 'required',

  // Primera ejecucion en seco (solo registra). Pon RENOVATE_DRY_RUN=null (o quita la variable) para activar.
  dryRun: process.env.RENOVATE_DRY_RUN === 'null' ? null : (process.env.RENOVATE_DRY_RUN || 'full'),

  // Changelogs desde GitHub (token publico solo lectura, opcional): RENOVATE_GITHUB_COM_TOKEN.
  allowedPostUpgradeCommands: [],
  persistRepoData: false,
  repositoryCache: 'enabled',
  cacheDir: '/tmp/renovate',
};
