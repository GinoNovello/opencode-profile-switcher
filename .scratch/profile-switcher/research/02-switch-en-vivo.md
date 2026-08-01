# 02 — Switch de modelo en vivo (sin reiniciar opencode)

Fecha: 2026-07-31
Versión investigada: **opencode v1.18.10** (repo `anomalyco/opencode`, tag `v1.18.10`, commit `7902e04`; tarballs npm `@opencode-ai/plugin@1.18.10` y `@opencode-ai/sdk@1.18.10`).

Rutas citadas como `packages/...` refieren al repo `anomalyco/opencode` en el tag `v1.18.10`.

## TL;DR / Veredicto

**Sí hay camino sin reiniciar el proceso.** El mecanismo a probar primero en el prototipo es:

1. **Persistir el perfil** (el plugin aplica el perfil en su hook `config(cfg)` como hoy, leyendo un archivo de estado propio; o escribe el perfil en la config global).
2. **Disparar la re-creación de la instancia**: `POST /instance/dispose` (`client.instance.dispose()` del SDK v1 que el plugin ya recibe). El server desecha la instancia después de responder, emite `server.instance.disposed`, la TUI se re-bootstrapea sola, y la instancia nueva se construye releyendo config + recargando plugins (el hook `config` vuelve a correr). Las sesiones viven en la DB y sobreviven. **No hace falta reiniciar el binario.**

Alternativa "todo en uno" para config global: `PATCH /global/config` (SDK v2: `client.global.config.update({config})`) — escribe el archivo global real y desecha todas las instancias en un solo paso.

Mecanismo secundario (sin reload, por mensaje): el hook **`chat.message` permite mutar `output.message.model`** y eso cambia el modelo efectivo del turno, incluso en subagentes. `chat.params` **no** permite cambiar el modelo.

---

## 1. ¿`chat.params` / `chat.message` permiten sobrescribir el modelo por mensaje?

### `chat.params`: NO

El tipo del hook (`@opencode-ai/plugin@1.18.10`, `dist/index.d.ts`) recibe `model: Model` solo como **input** informativo; el `output` mutable es únicamente `{ temperature, topP, topK, maxOutputTokens, options }` — no hay campo de modelo.

En el core, el hook se dispara en `packages/opencode/src/session/llm/request.ts:114-133`, cuando el modelo ya fue resuelto y pasado como `input.model`; el resultado solo alimenta los parámetros de sampling. **No hay forma de cambiar el modelo desde `chat.params`.**

### `chat.message`: SÍ (mutando `output.message.model`)

- El mensaje de usuario se construye en `createUserMessage` (`packages/opencode/src/session/prompt.ts:635`) con `model = input.model ?? ag.model ?? currentModel(sessionID)` (`prompt.ts:647`) y queda en `info.model = { providerID, modelID, variant }` (`prompt.ts:660-671`).
- El hook se dispara con **el mismo objeto `info` como `output.message`** (`prompt.ts:997-1008`: `plugin.trigger("chat.message", {...}, { message: info, parts: resolvedParts })`), **antes** de persistirlo (`yield* sessions.updateMessage(info)`, `prompt.ts:1045`).
- El loop de procesamiento resuelve el modelo del turno desde el mensaje guardado: `const model = yield* getModel(lastUser.model.providerID, lastUser.model.modelID, sessionID)` (`prompt.ts:1141`).

⇒ Si el plugin muta `output.message.model = { providerID, modelID }` dentro de `chat.message`, ese es el modelo que se usa para el stream LLM de ese mensaje.

**¿Aplica a subagentes/tasks?** Sí. El task tool crea la sesión hija y llama `ops.prompt({ ..., model, agent: next.name, parts })` (`packages/opencode/src/tool/task.ts:202-212`), que pasa por el mismo `createUserMessage` → mismo hook `chat.message`, con `input.agent` = nombre del subagente. El modelo por defecto del task es `next.model ?? modelo del assistant padre` (`task.ts:181-184`), pero el hook corre después y puede pisarlo por sesión/agente.

**Caveats del approach por mensaje:**
- `sessions.setAgentModel` ya corrió con el modelo pre-hook (`prompt.ts:673-687`), así que `SessionTable.model` y la UI quedan mostrando el modelo original → desincronización visual.
- La TUI manda su `selectedModel` explícito en **cada** prompt (`packages/tui/src/component/prompt/index.tsx:1094-1101`), o sea el hook tendría que pisar la elección de la TUI en cada mensaje; funciona, pero el usuario ve otra cosa en el selector.

## 2. ¿El SDK/HTTP expone mutaciones en caliente?

Del `@opencode-ai/sdk@1.18.10` (`dist/gen/types.gen.d.ts` y `dist/v2/gen/*`):

| Operación | Ruta | ¿Sirve? |
|---|---|---|
| `session.update` | `PATCH /session/{id}` | **No** — el body solo acepta `{ title?: string }` (`SessionUpdateData`). |
| `session.prompt` | `POST /session/{id}/message` | Acepta `model: {providerID, modelID}` **por mensaje** (`SessionPromptData`) — así cambia de modelo la TUI hoy. |
| `session.switchModel` (v2) | `POST /api/session/{sessionID}/model` | Existe ("Switch the model used by subsequent provider turns", `dist/v2/gen/sdk.gen.d.ts:1681`). Server: publica `SessionEvent.ModelSwitched` (`packages/core/src/session.ts:402-416`) y el projector actualiza `SessionTable.model` (`packages/core/src/session/projector.ts:339-349`) — la misma tabla que lee `currentModel()` en `prompt.ts:614-617`. **Pero**: la TUI manda `model` explícito en cada prompt (`input.model` gana sobre `currentModel`, `prompt.ts:647`), así que para sesiones TUI el efecto queda pisado. Útil solo para clientes que no mandan `model`. |
| `config.update` | `PATCH /config` | Escribe `<directorio-instancia>/config.json` (`packages/opencode/src/config/config.ts:624-631`) **y marca la instancia para disposal** (`packages/opencode/src/server/routes/instance/httpapi/handlers/config.ts:18-22`). ⚠️ Ojo: `<dir>/config.json` **no está en la cadena de carga** del boot (el proyecto solo carga `opencode.json(c)`, `config/paths.ts:10-21`, `config.ts:406-410`; `config.json` solo se lee del dir global, `config.ts:258-260`) → la persistencia local de este endpoint es dudosa; su valor real es el efecto secundario de reload. |
| `global.config.update` (v2) | `PATCH /global/config` | **El más completo**: `config.updateGlobal` mergea el patch en el archivo global real (`~/.config/opencode/opencode.jsonc|opencode.json|config.json`, `config.ts:139-142,637-660`), invalida el cache global, y si hubo cambios **desecha todas las instancias** (`server/routes/instance/httpapi/handlers/global.ts:86-90`). Expuesto en SDK v2: `client.global.config.update({ config })` (`dist/v2/gen/sdk.gen.d.ts`, clase `Config` bajo `Global`). No está en el cliente v1 que recibe el plugin (solo `global.event`), pero el plugin puede importar `createOpencodeClient` de `@opencode-ai/sdk/v2` o hacer `fetch` a `serverUrl` (el `PluginInput` incluye `serverUrl`). |
| `instance.dispose` | `POST /instance/dispose` | En el SDK v1 del plugin: `client.instance.dispose()`. Marca la instancia para disposal después de responder (`handlers/instance.ts:24-27` + `lifecycle.ts:23-33,43-54`). |

## 3. ¿Existe un mecanismo de reload de config disparable por el plugin?

**Sí: la disposición de instancia ES el reload.** opencode no tiene hot-reload de archivos, pero su estado (config, providers, agentes, plugins) vive en una "instancia" cacheada por directorio (`InstanceStore`), y desecharla fuerza reconstrucción completa:

1. `POST /instance/dispose` (o `PATCH /config` / `PATCH /global/config` con cambios) → `markInstanceForDisposal` → tras enviar la respuesta corre `store.dispose(ctx)` (`lifecycle.ts`).
2. El dispose emite el evento `server.instance.disposed` (`packages/opencode/src/project/instance-store.ts:79-92`).
3. **La TUI escucha ese evento y hace `bootstrap()` de nuevo** (`packages/tui/src/context/sync.tsx:171-174`): re-fetch de config, agentes, providers, sesiones. La TUI no muere; las sesiones persisten en la DB.
4. El próximo request re-bootea la instancia: config se relee de disco, los plugins se recargan y **el hook `config(cfg)` vuelve a ejecutarse** con la config fresca (`packages/opencode/src/plugin/index.ts:150,242-249`) — o sea el patrón del plugin local de referencia (mutar `cfg` en el hook `config`) se vuelve "en vivo" si después del cambio de perfil se dispara el dispose.

**Efecto sobre el modelo mostrado/usado por la TUI tras el re-bootstrap** (`packages/tui/src/context/local.tsx:196-244`): prioridad `pick manual del usuario en esta corrida (memoria)` > `agent.model` > `config.model` > recientes. Como `agent.model` y `config.model` se re-fetchean en el bootstrap, el nuevo perfil aplica automáticamente — salvo que el usuario haya elegido un modelo a mano en esa corrida de la TUI (estado en memoria que sobrevive al re-bootstrap; se limpia recién al cerrar la TUI).

**`small_model`**: `getSmallModel` lee `cfg.small_model` de la config de la instancia (`packages/opencode/src/provider/provider.ts:1873-1881`) → también se actualiza con el reload. Además existe el hook `experimental.provider.small_model` para inyectar el small model dinámicamente, pero **solo se consulta si `cfg.small_model` no está seteado** (`provider.ts:1876-1898`).

**Subagentes**: sus modelos salen de `Agent.Service` (estado de instancia, congelado desde config) o del modelo del padre (`tool/task.ts:181-184`) → el reload de instancia también los actualiza.

## 4. Estado upstream (issue #12607)

[anomalyco/opencode#12607](https://github.com/anomalyco/opencode/issues/12607) ("configuration profiles (per-context setups)") — **cerrado el 2026-02-17 como "completed" sin implementación upstream**: el autor lo cerró tras un comentario de `kagbodji` con el workaround de `OPENCODE_CONFIG_DIR` + aliases de shell (un directorio de config por perfil, merge aditivo con la config global). Confirma que **no existe** un sistema de perfiles nativo ni hot-swap oficial; el hueco que ataca este plugin sigue abierto. (Fuente: `gh api repos/anomalyco/opencode/issues/12607` y `/comments`.)

Nota docs: la página oficial de plugins (https://opencode.ai/docs/plugins) no documenta `chat.params`/`chat.message` en detalle ni ningún reload de config; la fuente de verdad son los tipos del paquete y el código. Los docs de modelos (https://opencode.ai/docs/models) solo describen `model` en config y el selector `/models` de la TUI.

## Recomendación para el prototipo (ticket 06)

**Probar primero — "persistir + dispose" (reload de instancia):**

```ts
// dentro del plugin, al elegir perfil desde la UI:
await persistirPerfil(perfil)            // ej. archivo de estado que el hook config() lee al boot
await client.instance.dispose()          // POST /instance/dispose → reload transparente
// la TUI se re-bootstrapea sola con server.instance.disposed
```

- Cubre `model`, `small_model` y modelos por agente/subagente de una sola vez, sin reiniciar el proceso.
- Verificar en el prototipo: (a) que el dispose con una sesión abierta no rompa nada (el dispose corre post-respuesta; con un stream activo habría que probar), (b) el caveat del pick manual de modelo en la TUI, (c) latencia del re-boot de instancia.

**Plan B (sin reload):** hook `chat.message` mutando `output.message.model` según el perfil activo — cambia el modelo real por mensaje (sesión y subagentes) pero deja la UI desincronizada; útil como fallback o para overrides quirúrgicos por agente.

**Descartado:** `chat.params` (no expone el modelo), `session.update` (solo título), y depender de `PATCH /config` local para persistir (escribe un `config.json` de proyecto que el boot no relee).
