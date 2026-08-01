# Research 01 — API de plugins de opencode: comandos slash, UI y persistencia

- Fecha: 2026-07-31
- Versión investigada: opencode **v1.18.10** (tag `v1.18.10` del repo `anomalyco/opencode`, commit `7902e04`) y paquete npm **`@opencode-ai/plugin@1.18.10`** (última versión publicada al momento de escribir).
- Fuentes: docs oficiales (`https://opencode.ai/docs/...` y su fuente en `packages/web/src/content/docs/`), código del repo, y los `.d.ts` del tarball de npm (descargado de `https://registry.npmjs.org/@opencode-ai/plugin/-/plugin-1.18.10.tgz`).
- Convención de citas: `repo:<path>` = path dentro del checkout de `anomalyco/opencode@v1.18.10`; `pkg:<path>` = archivo dentro del tarball `@opencode-ai/plugin@1.18.10`.

## Resumen ejecutivo

En 1.18.10 un plugin npm puede tener **dos entry points**: uno de **servidor** (`server`, los hooks clásicos: `config`, `event`, `tool`, etc.) y uno de **TUI** (`tui`, nuevo y todavía no documentado en el sitio web) que corre dentro de la TUI (opentui/solid) y expone primitivas de UI reales: registro de comandos slash en el autocomplete de `/`, paleta de comandos, diálogos (select/prompt/confirm/alert) apilables para armar wizards, toasts, y un KV persistente (`api.kv`). Un mismo módulo **no puede** exportar ambos; el paquete npm los separa vía `exports["./server"]` y `exports["./tui"]` en su `package.json` (`repo:packages/opencode/src/plugin/shared.ts:293-294` y `resolvePackageEntrypoint`, líneas 104-115).

Para `/profile <nombre>`:
- La vía **TUI plugin** (`api.keymap.registerLayer` con `slashName`) registra `/profile` en el autocomplete, pero **no recibe argumentos**: al seleccionarlo se despacha el comando sin args. El patrón idiomático es que `/profile` abra un `DialogSelect` con los perfiles (que tiene filtrado fuzzy incorporado) — mejor UX que autocompletar un argumento.
- La vía **custom command** (inyectar `cfg.command` desde el hook `config` del server plugin) sí acepta argumentos (`$ARGUMENTS`, `$1..$n`) y aparece en el autocomplete, pero su ejecución **siempre termina en un prompt al LLM** (es un template de prompt), con un hook `command.execute.before` para interceptar/mutar las parts.

---

## 1. Cómo se carga un plugin npm (y cómo recibe opciones)

- Se declara en el array `plugin` de `opencode.json`; docs: https://opencode.ai/docs/plugins/ ("From npm"; fuente `repo:packages/web/src/content/docs/plugins.mdx`, sección "Use a plugin"). Los paquetes se instalan automáticamente con Bun y se cachean en `~/.cache/opencode/node_modules/` (misma página, "How plugins are installed").
- **Opciones por config**: el tipo `Config` del paquete de plugin redefine `plugin` como `Array<string | [string, PluginOptions]>` (`pkg:dist/index.d.ts:47-50`). Es decir, en `opencode.json` se puede escribir `"plugin": [["opencode-profile-switcher", { ... }]]` y ese objeto llega como **segundo argumento** de la función del plugin: `server(input, load.options)` (`repo:packages/opencode/src/plugin/index.ts:112-122`, `applyPlugin`; las opciones se extraen en `repo:packages/opencode/src/config/plugin.ts:36-38`, `pluginOptions`). El TUI plugin también las recibe: `TuiPlugin = (api, options, meta) => Promise<void>` (`pkg:dist/tui.d.ts:505`).
- **Forma del módulo (server)**: `export default { id?, server }` (`PluginModule`, `pkg:dist/index.d.ts:52-56`) o el estilo legacy de exportar funciones `Plugin` sueltas (cada export función se trata como plugin: `getLegacyPlugins`, `repo:packages/opencode/src/plugin/index.ts:96-109`). El plugin de referencia local (`~/.config/opencode/plugins/profile-switcher.ts`, `export default (async ({client}) => ...) satisfies Plugin`) usa el estilo legacy.
- **Forma del módulo (TUI)**: `export default { id?, tui }` (`TuiPluginModule`, `pkg:dist/tui.d.ts:506-510`). Validación: "Plugin ... must default export either server() or tui(), not both" (`repo:packages/opencode/src/plugin/shared.ts:283-301`, `readV1Plugin`).
- **Resolución de entry points en un paquete npm**: `resolvePackageEntrypoint` busca `pkg.json.exports["./server"]` y `exports["./tui"]`; para `server` cae en `main` como fallback; para `tui` en npm **solo** funciona el export `./tui` (`repo:packages/opencode/src/plugin/shared.ts:104-115` y `resolvePluginEntrypoint`, líneas 135-166). O sea, el `package.json` del plugin público debería tener:

  ```json
  {
    "exports": {
      ".": "./dist/server.js",
      "./server": "./dist/server.js",
      "./tui": "./dist/tui.js"
    }
  }
  ```
- **Orden de arranque**: "Plugin can mutate config so it has to be initialized before anything else" (comentario literal en `repo:packages/opencode/src/project/bootstrap.ts:37-38`). El hook `config(cfg)` se invoca al final del init de plugins con el objeto de config vivo (`repo:packages/opencode/src/plugin/index.ts:242-251`): las mutaciones in-place son efectivas para todo lo que se resuelva después (modelos, agentes, **y comandos**, ver §2.1).

## 2. Comandos slash

Hay dos mecanismos distintos, con trade-offs opuestos.

### 2.1 Custom commands (config) — con argumentos, pero dirigidos al LLM

- Docs: https://opencode.ai/docs/commands/ (fuente `repo:packages/web/src/content/docs/commands.mdx`). Se definen como markdown en `~/.config/opencode/commands/` / `.opencode/commands/` o en la sección `command` de la config (`{ template, description, agent, model, subtask }`).
- El servicio `Command` construye su lista desde `cfg.command` (`repo:packages/opencode/src/command/index.ts:90-102`) — y como el hook `config` de un server plugin puede mutar `cfg` antes de que `Command` se materialice (§1), **un plugin puede inyectar comandos**: `cfg.command = { ...cfg.command, profile: { template: "...", description: "cambiar perfil de modelos" } }`. El comando aparece en el autocomplete de `/` de la TUI con su descripción (la TUI lista comandos vía `sdk.client.command.list` → `repo:packages/tui/src/context/sync.tsx:517`; render en `repo:packages/tui/src/component/prompt/autocomplete.tsx:447-464`).
- **Argumentos**: sí. Al tipear `/profile glm` y dar Enter, la TUI detecta que el primer token matchea un comando del server y llama `sdk.client.session.command({ command: "profile", arguments: "glm", ... })` (`repo:packages/tui/src/component/prompt/index.tsx:1070-1090`). El server sustituye `$1..$n` y `$ARGUMENTS` en el template (`repo:packages/opencode/src/session/prompt.ts:1383-1395`; hints de argumentos en `repo:packages/opencode/src/command/index.ts:36-44`).
- **Interceptación por plugin**: hook `"command.execute.before"` con input `{ command, sessionID, arguments }` y output `{ parts }` (`pkg:dist/index.d.ts:228-234`; disparo en `repo:packages/opencode/src/session/prompt.ts:1461-1465`). Ojo: después del hook **siempre** se llama `prompt(...)` con la variable local `parts` — se pueden mutar las parts *in place* (push/splice), pero reasignar `output.parts = [...]` no tiene efecto, y no hay mecanismo de cancelación limpio (`repo:packages/opencode/src/session/prompt.ts:1461-1475`).
- **Autocompletado de argumentos**: no existe. Al seleccionar el comando en el autocomplete solo se inserta `/profile ` en el prompt y el usuario tipea el resto libre (`repo:packages/tui/src/component/prompt/autocomplete.tsx:453-462`).
- Conclusión: útil si se quiere que "/profile" sea un prompt para el LLM; **no** sirve para ejecutar lógica de plugin pura sin gastar una vuelta de LLM.

### 2.2 Comandos de TUI plugin — lógica propia, sin argumentos, con paleta y keybinds

- Un TUI plugin registra comandos con `api.keymap.registerLayer({ commands, bindings })`; cada comando: `{ name, title, desc?, category?, namespace: "palette", hidden?, slashName?, slashAliases?, run() }`. Ejemplo real (builtin plugin-manager): `repo:packages/tui/src/feature-plugins/system/plugins.tsx:238-261`.
- `slashName` hace que el comando aparezca en el autocomplete de `/`: `useCommandSlashes()` toma los comandos del namespace `palette` con `slashName` y los expone como entradas `/nombre` con descripción y aliases (`repo:packages/tui/src/keymap.tsx:260-290`); el autocomplete las mezcla con los comandos del server (`repo:packages/tui/src/component/prompt/autocomplete.tsx:448`).
- **Argumentos: no.** `onSelect: () => keymap.dispatchCommand(entry.command.name)` — se ejecuta el comando sin pasar texto adicional (`repo:packages/tui/src/keymap.tsx:286`). Y al submitear texto tipeado, la TUI solo rutea a `session.command` los comandos del **server** (§2.1); un `/profile glm` tipeado a mano que no matchee un comando del server se envía como prompt normal al LLM (`repo:packages/tui/src/component/prompt/index.tsx:1070-1072`).
- Patrón recomendado (el que usan los builtins): `/profile` ⇒ `run()` abre un `DialogSelect` con los perfiles como opciones — el dialog tiene filtrado fuzzy propio, así que "autocompletar nombres de perfil" se obtiene gratis dentro del diálogo (ver §3).
- Existe además una API legacy `api.command.register(() => TuiCommand[])` con shape `{ title, value, slash: { name, aliases }, onSelect(dialog) }`, hoy deprecada y implementada como shim sobre `registerLayer` ("Legacy `api.command` bridge for v1 plugins; remove in v2", `repo:packages/tui/src/plugin/command-shim.ts:1-109`; tipos con `@deprecated` en `pkg:dist/tui.d.ts:40-73`). Usar `registerLayer`.
- **Keybinds**: el layer acepta `bindings` (p.ej. `{ key, cmd, desc }`) y se integra con la config de keybinds del usuario (`repo:packages/tui/src/plugin/command-shim.ts:67-83`).

### 2.3 Disparar comandos de TUI desde el lado server

- El SDK server-side expone `client.tui.executeCommand({ body: { command: "<name>" } })` (POST `/tui/execute-command`, `repo:packages/sdk/js/src/gen/sdk.gen.ts:1101-1112`; body en `repo:packages/sdk/js/src/gen/types.gen.ts:3737-3746`). La TUI lo recibe como evento `tui.command.execute` y hace `keymap.dispatchCommand(evt.properties.command)` (`repo:packages/tui/src/app.tsx:985-988`) — sirve para que el lado server dispare un comando registrado por el lado TUI del mismo plugin. Documentado como evento en https://opencode.ai/docs/plugins/ (lista "TUI Events": `tui.prompt.append`, `tui.command.execute`, `tui.toast.show`; fuente `repo:packages/web/src/content/docs/plugins.mdx:204-208`).

## 3. Interacción con el usuario (wizard, toasts)

### 3.1 Desde el TUI plugin (la vía completa)

`TuiPluginApi` (`pkg:dist/tui.d.ts:459-504`) expone en `api.ui`:

- `toast(input: TuiToast)` — `{ variant?: "info"|"success"|"warning"|"error", title?, message, duration? }` (`pkg:dist/tui.d.ts:164-169, 485`).
- `dialog: TuiDialogStack` — `replace(render, onClose?)`, `clear()`, `setSize("medium"|"large"|"xlarge")` (`pkg:dist/tui.d.ts:79-86`): stack de diálogos para flujos multi-paso.
- Componentes listos: `DialogAlert`, `DialogConfirm` (`{title, message, onConfirm, onCancel}`), `DialogPrompt` (input de texto con `placeholder`, `busy`, `onConfirm(value)`) y `DialogSelect<Value>` (lista con `options: {title, value, description?, category?, footer?}`, filtrado incorporado, `onSelect`) (`pkg:dist/tui.d.ts:87-127, 477-487`).
- **Wizard paso a paso: sí.** El builtin de plugins es exactamente eso: un comando abre `api.ui.dialog.replace(() => <View/>)` con un `DialogSelect`, una acción encadena `dialog.replace(() => <Install/>)` con un `DialogPrompt` (con estado `busy`/"Installing plugin..."), y al confirmar emite `api.ui.toast(...)` de éxito/error y vuelve al diálogo anterior (`repo:packages/tui/src/feature-plugins/system/plugins.tsx:38-133, 146-236`). Los componentes se escriben en JSX de solid (`@opentui/solid`); el paquete de plugin re-exporta los tipos necesarios (`pkg:dist/tui.d.ts:1-11`).
- Extras: `api.attention.notify(...)` (notificación de SO + sonido, `pkg:dist/tui.d.ts:201-217`), `api.route.register` (pantallas propias), `api.slots.register` (inyectar UI en slots del layout: `home_footer`, `sidebar_content`, etc., `pkg:dist/tui.d.ts:355-406`), `api.theme`, `api.state` (config, providers, sesiones — solo lectura, `pkg:dist/tui.d.ts:287-314`), `api.event.on(...)` (bus de eventos tipado), `api.client` (SDK v2 completo), `api.lifecycle.onDispose`.

### 3.2 Desde el server plugin (limitado a toasts y prompt)

- `client.tui.showToast({ body: { message, variant, title?, duration? } })` — POST `/tui/show-toast` (`repo:packages/sdk/js/src/gen/sdk.gen.ts:1114-1125`; body en `types.gen.ts:3766-3780`) → evento `tui.toast.show` → toast en la TUI (`repo:packages/tui/src/app.tsx:990-998`). Suficiente para "perfil aplicado, reiniciá para aplicar".
- `client.tui.appendPrompt`, `submitPrompt`, `clearPrompt`, `executeCommand`, `openModels`/`openThemes`/etc. (`repo:packages/sdk/js/src/gen/sdk.gen.ts:1025-1112`).
- **No hay primitiva de diálogo/pregunta arbitraria desde el server**: la API `/question` del SDK v2 (list/reply/reject, `repo:packages/sdk/js/src/v2/gen/sdk.gen.ts:2984-3055`) es para preguntas iniciadas por el asistente, no por plugins; los prompts interactivos del `AuthHook` (`prompts: [{type: "text"|"select", ...}]`, `pkg:dist/index.d.ts:62-125`) solo aplican al flujo `opencode auth login`. Un wizard de setup requiere el entry `tui` (o, plan B, un custom tool cuyo `execute` use `context.ask` — pero eso pasa por el LLM).

## 4. Persistencia de estado del plugin

- **TUI plugin: `api.kv`** — `{ get(key, fallback?), set(key, value), ready }` (`pkg:dist/tui.d.ts:282-286`). Implementación: store en memoria respaldado por **`<XDG_STATE>/opencode/kv.json`** con file-lock y escritura atómica (`repo:packages/tui/src/context/kv.tsx:10-60`; `state` viene de `Global.Path.state`, inyectado en `repo:packages/tui/src/app.tsx:256-263`). Es un archivo compartido por toda la TUI ⇒ conviene namespacear las keys (p.ej. `profile-switcher.active`). Rutas base XDG: `data`/`cache`/`config`/`state` = `~/.local/share|~/.cache|~/.config|~/.local/state` + `/opencode` (`repo:packages/core/src/global.ts:10-29`).
- **Server plugin: no hay API de storage dedicada.** Opciones establecidas:
  1. **Opciones de config (read-only)**: `plugin: [["pkg", {...}]]` (§1) — para configuración declarativa del usuario.
  2. **Archivo propio**: el plugin recibe `directory` y `worktree` en `PluginInput` (`pkg:dist/index.d.ts:36-46`) y tiene Bun/`$` a disposición; la convención del propio proyecto para estado global es el directorio XDG state/data (`repo:packages/core/src/global.ts`) — p.ej. `~/.local/state/opencode/<plugin>.json` o un archivo bajo `~/.config/opencode/`. No hay helper expuesto: hay que construir la ruta a mano (mismo cálculo XDG).
  3. **Mutar `cfg` en el hook `config`** es solo **en memoria** por proceso (`repo:packages/opencode/src/plugin/index.ts:242-251`); no persiste nada en `opencode.json`. No existe API del SDK para escribir `opencode.json`.
- La sección de docs sobre plugins no documenta ninguna convención de persistencia (`repo:packages/web/src/content/docs/plugins.mdx` — no menciona storage), así que `kv.json` (TUI) + archivo propio (server) es el estado del arte observable en el código.

## 5. Implicaciones para opencode-profile-switcher

1. Publicar el paquete con dos entries: `./server` (hook `config(cfg)` que aplica el perfil activo, como el plugin local de referencia) y `./tui` (UI).
2. `/profile`: registrar en el entry TUI vía `api.keymap.registerLayer` con `slashName: "profile"`; `run()` abre un `DialogSelect` con los perfiles (filtrado fuzzy = autocomplete de nombres). No apostar a `/profile <nombre>` con argumento: los comandos slash de TUI no reciben args (§2.2).
3. Wizard de setup: cadena de `DialogSelect`/`DialogPrompt`/`DialogConfirm` sobre `api.ui.dialog.replace`, siguiendo el patrón del builtin plugin-manager (§3.1).
4. Confirmaciones: `api.ui.toast` desde la TUI; `client.tui.showToast` desde el server (p.ej. al aplicar el perfil en el hook `config`).
5. Estado (perfil activo + definiciones): `api.kv` con keys namespaceadas para lo que escribe la UI; el entry server lo lee del mismo `kv.json` (o de un archivo propio en XDG state) al momento del hook `config`. Nota: el hook `config` corre al bootstrap del proceso ⇒ cambiar de perfil requiere reiniciar/recargar para que aplique — de ahí el toast "reiniciá para aplicar".
6. Advertencia de estabilidad: la API TUI de plugins está en transición ("Legacy `api.command` ... Remove in v2", `pkg:dist/tui.d.ts:40-44`; el paquete ya incluye `dist/v2/` con una superficie nueva basada en Effect). Fijar `@opencode-ai/plugin@1.18.10` como peer/dev dependency y usar solo `registerLayer` + `api.ui.*` + `api.kv`.
