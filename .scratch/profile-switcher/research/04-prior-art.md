# Prior art: perfiles y switch de modelos en opencode

Research del ticket 04. Fecha: 2026-07-31. Fuentes primarias: registry de npm (`registry.npmjs.org`), código de los repos en GitHub, issues/PRs de `anomalyco/opencode`, docs de opencode.ai.

## TL;DR

- **`opencode-profiles` (ocp) NO se superpone** con nuestro plugin: es un CLI *launcher* que arranca opencode con otro directorio de config (`OPENCODE_CONFIG_DIR`). Cada "switch" = proceso nuevo. No maneja asignaciones modelo→agente ni switch desde la UI.
- **opencode#12607 está cerrado como "completed" pero lo cerró el propio autor** tras encontrar el workaround `OPENCODE_CONFIG_DIR` + aliases de shell. No hay señal de que opencode implemente perfiles de config/modelos nativos; el trabajo upstream activo es sobre *auth profiles* (cuentas por provider), otra cosa.
- **El competidor real es `opencode-sdd-engram-manage`** (~8.9k descargas/mes): plugin de TUI que activa perfiles de modelo→agente en vivo, sin reinicio, vía `api.client.global.config.update()`. Pero está acoplado al ecosistema SDD/gentle-ai (solo agentes `sdd-*`, `review-*`, `jd-*`). Ese mecanismo de activación es exactamente lo que debemos reusar.
- El nombre npm **`opencode-profile-switcher` está libre** (404 en el registry al 2026-07-31), aunque existe un repo de GitHub con ese nombre (nunca publicado a npm).

---

## 1. `opencode-profiles` (ocp)

**Fuentes:** `https://registry.npmjs.org/opencode-profiles` · repo [0xKahi/ocp](https://github.com/0xKahi/ocp) (README y `src/` leídos en HEAD).

**Qué es.** Un **CLI standalone** (`bin: ocp`), no un plugin de opencode. Descripción del package.json: "OCP CLI - manage and switch between local global opencode profiles". Autor 0xKahi, MIT, corre sobre Bun. Publicado 2026-03-11; latest 1.5.2 (2026-05-26). Adopción baja: **75 descargas en el último mes** (`api.npmjs.org/downloads/point/last-month/opencode-profiles`).

**Cómo define perfiles.** Un perfil es un **puntero a un directorio** que contiene su propio `opencode.jsonc`/`opencode.json`. Se registran en `ocp.jsonc` dentro del config dir global de opencode. Schema (`src/schemas/config.schema.ts`):

```ts
const ProfileSchema = z.object({ path: z.string() });
export const OcpConfigSchema = z.object({
  $schema: z.string().optional(),
  startup: StartupOptionsSchema,   // { randomPort: boolean }
  profiles: ProfilePropSchema,     // Record<name, { path }>
});
```

**Cómo switchea.** `ocp run <profile>` hace `Bun.spawn` de `opencode` con el env var apuntando al directorio del perfil (`src/commands/run.ts`):

```ts
proc = Bun.spawn({
  cmd: command,
  env: { ...process.env, OPENCODE_CONFIG_DIR: profile.path },
  ...
});
```

Es decir: **switchear = lanzar un proceso opencode nuevo** (equivale a reiniciar). No hay switch dentro de una sesión corriendo, ni UI dentro del TUI de opencode.

**Limitaciones (para nuestro caso):**
- Granularidad de directorio de config completo; no modela "conjunto de asignaciones modelo→agente" — para 5 perfiles necesitás 5 copias del config con todo duplicado.
- Sin integración con el TUI: se elige el perfil antes de arrancar (prompt de @clack o argumento).
- Requiere Bun global.

**Superposición:** casi nula. Resuelve "configs completas aisladas por contexto", no "cambiar el mapa de modelos en caliente". **Para aprender/reusar:** validación de perfiles con feedback (`profile list` marca inválidos), escritura atómica de config (`src/utils/atomic.ts`), y confirma que `OPENCODE_CONFIG_DIR` es el mecanismo oficial de aislamiento por directorio.

## 2. Upstream: opencode#12607 y señales de perfiles nativos

**Fuente:** [anomalyco/opencode#12607](https://github.com/anomalyco/opencode/issues/12607) (issue + comments + timeline vía `gh`).

- **"[FEATURE]: configuration profiles (per-context setups)"**, abierto por @bsreeram08 el 2026-02-07, etiqueta `discussion`. Pide perfiles nombrados (Personal/Work/Client) con configs, plugins, **modelos default** y env por perfil, switch rápido **desde la UI** e indicador del perfil activo.
- **Estado: CLOSED, stateReason COMPLETED (2026-02-17)** — pero el timeline muestra que **lo cerró el propio autor** (`actor: bsreeram08`), no un maintainer, y sin PR asociado. Se cerró después de que @kagbodji (comment del 2026-02-16, 7 👍) compartiera el **workaround**: aliases de shell con `OPENCODE_CONFIG_DIR` por perfil, aprovechando que "opencode configs are additive" (el config global se mergea con el del directorio del perfil).
- **Issues relacionados:** #17165 "support config profiles and protected overlays" → **closed NOT_PLANNED** (auto-cerrado por inactividad; un usuario recomendó `ocx` como solución). #5391 "multiple auth profiles per provider" → **sigue OPEN** (actualizado 2026-07-17). #20423/#20424 (named provider profiles) cerrados como duplicados de la línea de auth.
- **PRs upstream con "profile" en el título** (search API): todo lo activo es **auth multi-cuenta por provider** — PR [#36781](https://github.com/anomalyco/opencode/pull/36781) "feat(auth): add support for multiple profiles per provider" (open, 2026-07-13) y PR #8963 (env vars de override de directorios, open desde enero). **Ningún PR/issue activo implementa perfiles de configuración/modelos con selector en la UI.**
- Docs oficiales ([opencode.ai/docs/config](https://opencode.ai/docs/config/)): no existe noción nativa de "profile"; sí existen `OPENCODE_CONFIG`, `OPENCODE_CONFIG_DIR` y el merge aditivo de configs (remote → global → custom → project → managed).
- Relacionado a nuestro diseño: [#18898](https://github.com/anomalyco/opencode/issues/18898) "Wildcard supports for agent configuration" (`agent["researcher/*"].model`) → **closed NOT_PLANNED**. O sea, agrupar agentes por patrón queda en manos de tooling externo.

**Conclusión de riesgo:** baja probabilidad de perfiles nativos a corto plazo; el interés del core está en auth profiles. El pedido de #12607 (selector en UI + indicador de perfil activo + modelos por perfil) sigue sin dueño → es exactamente el hueco de nuestro plugin.

## 3. Otros proyectos de la comunidad

Búsquedas: npm search `opencode profile` / `opencode model switch`; GitHub search `opencode profile switch` / `opencode model profile`.

| Proyecto | Tipo | Qué hace | Relevancia |
|---|---|---|---|
| [`opencode-sdd-engram-manage`](https://www.npmjs.com/package/opencode-sdd-engram-manage) ([j0k3r-dev-rgl/sdd-engram-plugin](https://github.com/j0k3r-dev-rgl/sdd-engram-plugin), 55★, **8.882 dl/mes**) | **Plugin TUI de opencode** | Perfiles = JSON en `~/.config/opencode/profiles/` con `{ models: {agente: "provider/model"}, fallback: {...} }`. Activación **en vivo, sin reinicio**, edición de modelos por agente desde la UI, bulk actions, versionado de perfiles, detección de perfil activo. | **La más alta.** Prueba el concepto y el mecanismo… pero hardcodea agentes SDD (`sdd-*`, `review-*`, `jd-*`) del ecosistema gentle-ai. No sirve para agentes arbitrarios. |
| [kdcokenny/ocx](https://github.com/kdcokenny/ocx) (888★, npm `ocx`) | CLI + ecosistema | "Extension manager with portable, isolated profiles": perfiles instalables desde registries, `ocx oc -p <name>` lanza opencode con el perfil. Control de qué "ve" opencode vía include/exclude. | Media. Otra vez modelo *launcher* (proceso nuevo), foco en portabilidad/distribución de setups, no en model-sets en caliente. Citado en #17165 como solución. |
| [flyinghail/opencode-profile-kit](https://github.com/flyinghail/opencode-profile-kit) (3★, activo jul-2026) | CLI bash | Stacks de agentes aislados y switchables sobre la base "global config + profile config" (capas aditivas). Launcher, no plugin. | Baja-media. |
| [huybui38/opencode-profile-switcher](https://github.com/huybui38/opencode-profile-switcher) (0★, abr-2026) | CLI | **Mismo nombre que el nuestro.** Presets de perfiles con wildcards de agentes (`researcher/*`) que parchea `opencode.json` local o imprime env vars; workaround explícito de #18898. Solo campos de modelo (`model`, `small_model`, `agent.<n>.model`). | **Ojo con el nombre:** el paquete **no está publicado en npm** (`registry.npmjs.org/opencode-profile-switcher` → 404 al 2026-07-31), así que el nombre está libre, pero el repo existe. Su scope (solo campos de modelo, wildcards) valida nuestro diseño. |
| [AnPod/Switch-Omo-Config](https://github.com/AnPod/Switch-Omo-Config) (24★) | CLI interactivo | Switch entre configs de oh-my-opencode (swap de archivos). | Baja. |
| [anfreire/omoctl](https://github.com/anfreire/omoctl), [yadav-prakhar/omo-profiles](https://github.com/yadav-prakhar/omo-profiles) | CLIs | Perfiles de mapeos modelo→agente para oh-my-openagent/OmO; "patch models across providers, switch with one command". | Media como validación de demanda; acoplados a OmO, sin UI. |
| Otros (EchoBird, AgentSwitchboard, charon, clovapi, butu/opencode-auth-switcher) | CLIs/GUIs | Switch de credenciales/API keys/endpoints entre herramientas (Claude Code/Codex/opencode). | Baja: resuelven auth, no model-sets. |

## 4. Qué aprender / reusar (implicancias para el diseño)

1. **Mecanismo de switch en vivo (robado de sdd-engram, `src/profiles.ts:1184-1261`):** leer el config global **desde disco** como fuente de verdad (el runtime `global.config.get()` devuelve contenido resuelto y puede inlinear `{file:...}`), aplicar el patch de modelos, y empujar con `api.client.global.config.update({ config })`. Sin reinicio; toasts de la UI (`api.ui.toast`) para feedback. Es la prueba de que el plugin API de opencode alcanza para todo lo que queremos.
2. **Formato de perfil:** JSON plano `{ models: { "<agente>": "provider/model" } }` bajo `~/.config/opencode/profiles/` (convención ya instalada por sdd-engram; ser compatibles o al menos no chocar). El versionado de perfiles de sdd-engram (snapshots restaurables) es una feature diferenciadora barata de copiar.
3. **Detección de perfil activo** comparando el config actual contra cada perfil (sdd-engram lo hace) → resuelve el "indicador de perfil activo" pedido en #12607.
4. **Wildcards de agentes** (`researcher/*`): upstream lo rechazó (#18898 not_planned) y huybui38 lo implementó como workaround → candidato natural para nuestro plugin.
5. **Nicho confirmado:** todo lo existente es (a) launchers de config-dir (ocp, ocx, profile-kit: requieren proceso nuevo), (b) plugin vivo pero acoplado a SDD (sdd-engram), o (c) CLIs acoplados a OmO. **No existe un plugin genérico de perfiles modelo→agente con switch desde la UI de opencode.**
6. **Nombre:** publicar `opencode-profile-switcher` en npm cuanto antes (está libre); considerar mencionar/diferenciarse del repo homónimo de huybui38.

## Fuentes

- npm registry: [opencode-profiles](https://registry.npmjs.org/opencode-profiles) (metadata, README, fechas), [búsqueda](https://registry.npmjs.org/-/v1/search?text=opencode%20profile), [downloads API](https://api.npmjs.org/downloads/point/last-month/opencode-profiles); `opencode-profile-switcher` → 404.
- Código: [0xKahi/ocp](https://github.com/0xKahi/ocp) (`src/commands/run.ts`, `src/schemas/config.schema.ts`, `src/utils/profile-loader.ts`); [j0k3r-dev-rgl/sdd-engram-plugin](https://github.com/j0k3r-dev-rgl/sdd-engram-plugin) (`src/profiles.ts`, `index.tsx`, README).
- GitHub anomalyco/opencode: issues [#12607](https://github.com/anomalyco/opencode/issues/12607) (+timeline), [#17165](https://github.com/anomalyco/opencode/issues/17165), [#5391](https://github.com/anomalyco/opencode/issues/5391), [#18898](https://github.com/anomalyco/opencode/issues/18898), [#20423](https://github.com/anomalyco/opencode/issues/20423); PRs [#36781](https://github.com/anomalyco/opencode/pull/36781), #8963.
- Docs: [opencode.ai/docs/config](https://opencode.ai/docs/config/).
- Comunidad: [kdcokenny/ocx](https://github.com/kdcokenny/ocx), [flyinghail/opencode-profile-kit](https://github.com/flyinghail/opencode-profile-kit), [huybui38/opencode-profile-switcher](https://github.com/huybui38/opencode-profile-switcher), [AnPod/Switch-Omo-Config](https://github.com/AnPod/Switch-Omo-Config), [anfreire/omoctl](https://github.com/anfreire/omoctl).
