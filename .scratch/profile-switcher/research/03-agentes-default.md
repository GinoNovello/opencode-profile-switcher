# 03 — Agentes default (built-in) de opencode 1.18.10

Fecha: 2026-07-31
Fuentes primarias: código de `anomalyco/opencode` en el tag `v1.18.10` (commit `7902e04c3a67f7c69726bc955efb46e29214c797`), docs oficiales en https://opencode.ai/docs. Los paths citados son relativos a la raíz del repo de opencode.

---

## 1. Lista exacta de agentes built-in en 1.18.10

Los built-in se definen en código, en un mapa literal `agents` dentro del servicio Agent:
`packages/opencode/src/agent/agent.ts` (líneas ~140–265, tag v1.18.10). Todos llevan `native: true`.

| Agente | `mode` | `hidden` | Notas |
|---|---|---|---|
| `build` | `primary` | no | Agente default. "The default agent. Executes tools based on configured permissions." |
| `plan` | `primary` | no | Deniega tools de edición (permiso `edit: deny` salvo archivos de plan). |
| `general` | `subagent` | no | Subagente de propósito general; `todowrite: deny`. |
| `explore` | `subagent` | no | Subagente read-only (solo grep/glob/list/bash/webfetch/websearch/read). |
| `compaction` | `primary` | **sí** | Agente de sistema: compacta el contexto. No seleccionable en la UI. |
| `title` | `primary` | **sí** | Agente de sistema: genera títulos de sesión. `temperature: 0.5`. |
| `summary` | `primary` | **sí** | Agente de sistema definido en el mapa, pero en 1.18.10 **no se referencia por nombre en ningún otro lugar del core** (`grep 'agents.get' packages/opencode/src` no muestra `get("summary")`); parece vestigial/reservado. |

**Total: 7 built-in.** Ninguno de los built-in define `model` — el campo `model` es opcional en el schema (`Info`, agent.ts líneas 35–55) y en el mapa literal ningún built-in lo setea.

### Verificación de la lista asumida por el plugin local

- **Built-in reales**: `build`, `plan`, `general`, `explore`, `compaction`, `title`, `summary`. ✔
- **NO son built-in** (custom del usuario local): `orchestrator`, `coder`, `planner`, `researcher`, `vision`. No aparecen en `agent.ts` de v1.18.10 ni de ninguna versión revisada (v1.14.50, v1.15.0, v1.16.0, v1.17.0, v1.18.0, rama `dev`).

### ¿Cambió la lista en versiones recientes? Sí: el caso `scout`

- `scout` (subagente read-only para investigar repos de dependencias) fue **agregado** como built-in en el commit `40d5ea1c` "feat(core): add scout agent for repo research (#24149)" (2026-05-08) y **removido** en `a639fe7a` "chore(opencode): remove scout agent (#30435)" (2026-06-02).
- Verificado por tag: `v1.14.50` y `v1.15.0` tienen 8 built-in (incluyen `scout` en `packages/opencode/src/agent/agent.ts`); desde `v1.16.0` en adelante son los 7 listados arriba (verificado en v1.16.0, v1.17.0, v1.18.0, v1.18.10 y rama `dev`).
- Ojo: la doc oficial está **desactualizada**: https://opencode.ai/docs/agents (y `packages/web/src/content/docs/agents.mdx` en el propio v1.18.10) todavía dice "OpenCode comes with three built-in subagents, **General**, **Explore**, and **Scout**", pero `scout` ya no existe en el código de 1.18.10. Conclusión práctica: **la lista de built-in no es estable entre versiones; no conviene hardcodearla a ciegas** (ver §3).

---

## 2. Capacidades especiales / candidatos a excluir o pinear

- **Ningún built-in requiere multimodal/visión.** No existe agente `vision` built-in; nada en `agent.ts` exige capacidades de modelo específicas.
- **`compaction`, `title`, `summary` son `hidden: true`**: no son seleccionables en la UI ("It runs automatically and is not selectable in the UI", https://opencode.ai/docs/agents). Son los candidatos naturales a tratamiento especial en un profile switcher:
  - `title` usa por default el **small model** del provider de la sesión (ver §4) — asignarle un modelo caro en un perfil es desperdicio; asignarle uno barato es el caso de uso típico.
  - `compaction` usa por default **el mismo modelo del mensaje de la sesión** (`packages/opencode/src/session/compaction.ts` líneas 328–331). Pinearlo a otro modelo es válido (comprime contexto a texto), pero el default ya es razonable.
  - `summary` no se invoca en 1.18.10 (ver §1); configurarle modelo hoy no tiene efecto observable, pero es inocuo incluirlo.
- **`explore`** está pensado como agente "rápido" (su descripción en agent.ts lo llama "Fast agent specialized for exploring codebases") y es read-only por permisos — típico candidato a modelo barato/rápido en un perfil, pero no hay requisito técnico.
- `general`, `explore` (subagentes) **heredan el modelo del agente primario que los invoca** si no tienen `model` propio (ver §4), así que dejarlos sin pin es un default coherente.

---

## 3. Enumeración programática de agentes desde un plugin

### 3.a `cfg.agent` en el hook `config`: NO contiene los built-in

- El hook `config` del plugin (`config?: (input: Config) => Promise<void>`, `packages/plugin/src/index.ts` línea 225) recibe el **objeto de configuración resuelto** (merge de opencode.json global/proyecto + agentes markdown de `.opencode/agent/*.md`, ver `packages/opencode/src/config/config.ts` líneas 400–465: `result.agent = mergeDeep(result.agent ?? {}, ConfigAgent.load(dir))`).
- Los built-in **no viven en la config**: se construyen después, dentro del servicio Agent, como mapa literal en código (`packages/opencode/src/agent/agent.ts` líneas 140–265). Recién ahí se superpone `cfg.agent` sobre ese mapa (líneas 267–294): cada entrada de `cfg.agent` **modifica** el built-in homónimo si existe (`if (value.model) item.model = Provider.parseModel(value.model)`, etc.), lo crea como custom (`native: false`) si no existe, o lo **elimina** si tiene `disable: true` (`delete agents[key]`).
- Conclusión: en `cfg.agent` un built-in solo aparece si el usuario lo declaró/overrideó por su nombre. **No sirve para enumerar built-in.**
- Sí sirve para **escribir**: mutar `cfg.agent["build"] = { model: "..." }` (o `cfg.model` / `cfg.small_model`) dentro del hook `config` es efectivo, porque el hook se ejecuta al cargar los plugins con el mismo objeto cacheado que devuelve `config.get()` (`packages/opencode/src/plugin/index.ts` línea 150 `const cfg = yield* config.get()` y líneas 242–251 "Notify plugins of current config" → `hook.config?.(cfg)`; `config.get()` devuelve el estado cacheado de instancia, `packages/opencode/src/config/config.ts` líneas 600–608), y el estado del servicio Agent se construye de forma lazy después de la carga de plugins (Agent depende de `Plugin.node`, agent.ts líneas 447–451).

### 3.b Enumeración correcta: endpoint HTTP `GET /agent` / SDK `client.app.agents()`

- El servidor expone `GET /agent` (operationId `app.agents`, "List agents", `packages/opencode/src/server/routes/instance/httpapi/groups/instance.ts` líneas 149–156), cuyo handler devuelve `agent.list()` (`.../httpapi/handlers/instance.ts` líneas 80–81) — es decir, el mapa final ya mergeado: **built-in incluidos (aunque el usuario no los haya declarado), hidden incluidos, y customs del usuario**.
- Cada item es un `Agent.Info` con los campos discriminantes que necesita el plugin (schema en agent.ts líneas 35–55 y `packages/sdk/openapi.json`, schema `Agent`): **`native: boolean`** (true = built-in), **`hidden: boolean`**, `mode`, `model?`, etc.
- El plugin recibe en `PluginInput` un `client` del SDK (`client: ReturnType<typeof createOpencodeClient>`, `packages/plugin/src/index.ts` líneas 56–66); el método generado es `client.app.agents()` → `GET /agent` (`packages/sdk/js/src/gen/sdk.gen.ts` líneas ~855–864).
- **Recomendación para el ticket**: no hardcodear la lista; enumerar con `client.app.agents()` y filtrar `native === true` (y decidir qué hacer con `hidden`). Esto absorbe automáticamente altas/bajas de built-in entre versiones (caso `scout`, §1). Nota de compatibilidad: el tipo TS generado en el SDK v1 de 1.18.10 (`packages/sdk/js/src/gen/types.gen.ts`) todavía tipa el campo como `builtIn: boolean` (desfasado), pero el wire format real que emite el server (openapi.json del mismo tag y el schema `Info` del server) usa `native`/`hidden` — conviene leer con fallback `agent.native ?? agent.builtIn`.
- Timing: el hook `config` corre una sola vez por carga; si el switch necesita la lista en ese momento, puede llamar al endpoint desde cualquier hook (el server ya está levantado cuando cargan los plugins de servidor).

---

## 4. Herencia de `model` / `small_model` global vs. `model` por agente

### Resolución del modelo de un mensaje de chat (agentes primarios)

`packages/opencode/src/session/prompt.ts` línea 646:

```ts
const model = input.model ?? ag.model ?? (yield* currentModel(input.sessionID))
```

Orden de precedencia:
1. Modelo pedido explícitamente en el request (`input.model`, p.ej. seleccionado en la TUI para ese mensaje).
2. **`model` del agente** (viene de `cfg.agent[nombre].model`; ningún built-in trae uno de fábrica).
3. `currentModel(sessionID)` (prompt.ts líneas ~615–633): modelo actual de la sesión → si no, el modelo del último mensaje user → si no, `provider.defaultModel()`.
4. `provider.defaultModel()` (`packages/opencode/src/provider/provider.ts` líneas 1942–1975): **`cfg.model` global si está seteado**; si no, el modelo usado más recientemente (`~/.local/state/opencode/model.json`); si no, el primer modelo del primer provider configurado.

Doc oficial (https://opencode.ai/docs/agents): "If you don't specify a model, primary agents use the model globally configured while subagents will use the model of the primary agent that invoked the subagent."

### Subagentes (task tool)

`packages/opencode/src/tool/task.ts` líneas ~181–184: `const model = next.model ?? { modelID: msg.info.modelID, providerID: msg.info.providerID }` — el subagente usa su `model` propio si lo tiene; si no, **hereda el modelo del mensaje del agente padre** (no el `cfg.model` global directamente).

### `small_model` global — quién lo usa

`provider.getSmallModel(providerID)` (`packages/opencode/src/provider/provider.ts` líneas 1873–1940):
1. Si `cfg.small_model` está seteado, se parsea y usa ese (cross-provider).
2. Si no, hook de plugin `experimental.provider.small_model`.
3. Si no, heurística por familia dentro del provider actual: `smallModelFamilyPriority = ["gemini-flash", "gpt-nano", "claude-haiku"]` (línea 1982; casos especiales para opencode/copilot/bedrock/azure).
4. Si nada matchea, `undefined` → el caller cae al modelo principal.

Doc (https://opencode.ai/docs/config): "The `small_model` option configures a separate model for lightweight tasks like title generation. By default, OpenCode tries to use a cheaper model if one is available from your provider, otherwise it falls back to your main model."

Consumidores en 1.18.10:
- **`title`** (`packages/opencode/src/session/prompt.ts` líneas 216–221): `ag.model` (si el usuario configuró `agent.title.model`) → si no `getSmallModel(provider de la sesión)` → si no el modelo de la sesión. Es el único agente built-in que usa `small_model` por default.
- `project-copy` handler (`.../handlers/project-copy.ts` línea 31) — uso interno, no un agente.

### Y los demás agentes de sistema

- **`compaction`** (`packages/opencode/src/session/compaction.ts` líneas 328–331): `agent.model` (si `agent.compaction.model` está configurado) → si no, **el modelo del mensaje user de la sesión** (no small_model, no cfg.model directo).
- **`summary`**: sin call-site en 1.18.10 (ver §1).

### Resumen de reglas para el profile switcher

| Agente | Sin `model` por agente usa... | `small_model` aplica? |
|---|---|---|
| `build`, `plan` (primarios) | modelo de sesión/TUI → `cfg.model` → recientes → primer modelo | no |
| `general`, `explore` (subagentes) | modelo del agente padre que los invoca | no |
| `title` | `small_model` (o heurística flash/nano/haiku del provider) → modelo de sesión | **sí** |
| `compaction` | modelo actual de la sesión | no |
| `summary` | n/a (no se invoca en 1.18.10) | n/a |

Implicación: un perfil que setea `cfg.agent[X].model` **pisa la herencia** para ese agente (es el punto de entrada correcto, agent.ts líneas 267–294); un perfil que solo setea `cfg.model`/`cfg.small_model` mueve los defaults sin tocar agentes individuales, con la salvedad de que `cfg.model` no fuerza sesiones ya abiertas con modelo elegido en la TUI (precedencia 1 y 3 arriba).
