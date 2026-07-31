# PRD — opencode-profile-switcher

> Estado: borrador básico. Las decisiones de diseño se definen más adelante en este mismo documento.

## Resumen

Plugin público para opencode que permite definir **perfiles de modelos** (conjuntos de modelos asignados a todos los agentes) y **switchear entre ellos desde la UI de opencode**, sin editar a mano la configuración.

## Problema

- opencode **no tiene perfiles nativos** (feature request abierto: [opencode#12607](https://github.com/anomalyco/opencode/issues/12607)).
- Quienes combinan varios providers/modelos (ej. xAI + GLM) deben cambiar a mano ~14 asignaciones de modelo (`model`, `small_model` y el `model` de cada agente) repartidas entre `opencode.json` y los archivos `.md` de cada agente.
- Es tedioso y propenso a errores, sobre todo cuando se agota el usage de un provider y hay que saltar a otro.

## Objetivos

- Distribuirse como paquete npm instalable con `"plugin": ["opencode-profile-switcher"]`.
- Permitir cambiar de perfil desde la UI de opencode (comando slash y/o keybind).
- Aplicar el cambio a **todos los agentes + `model` + `small_model`** en un solo paso.
- Funcionar con cualquier set de providers/modelos que el usuario tenga configurado.

## Punto de partida (MVP)

Nos basamos en el plugin local **ya construido y probado** en `~/.config/opencode/plugins/profile-switcher.ts`.

Qué hace hoy (verificado contra opencode 1.18.10):

- Usa el hook `config(cfg)` para sobrescribir los modelos al iniciar.
- Mapea perfiles con tiers (`heavy` / `rest`) más un set `PINNED_AGENTS` para excluir agentes (ej. `vision`, que necesita modelo multimodal).
- Se activa con la variable de entorno `OPENCODE_PROFILE=glm`.
- Confirmado: orquestador y subagentes (basados en archivo) se sobrescriben correctamente; los 3 modelos del GLM Coding Plan responden.

**Limitación actual:** requiere reiniciar opencode (la config no se recarga en caliente).

## Features del MVP

1. Definir perfiles en la config del usuario.
2. Cambiar de perfil desde la UI.
3. Aplicar el cambio a todos los agentes + `model` + `small_model`.
4. Excluir/pinear agentes que no deban cambiar (ej. multimodal).

## Decisiones de diseño abiertas (trabajar acá después)

- **Alcance:** ¿genérico (cada usuario define sus perfiles), presets fijos, o mixto?
- **Comportamiento del switch en UI:**
  - comando + reinicio automático,
  - comando que avisa "reiniciá",
  - o switch en vivo sin reinicio (riesgo técnico clave: validar si los hooks `chat.message` / `chat.params` permiten cambiar el modelo en la sesión actual).
- **Mapeo de tiers:** ¿auto-detección (heavy/rest) o mapeo explícito por agente?
- **Distribución:** nombre y scope del paquete npm; versiones de opencode soportadas.

## Restricciones técnicas conocidas

- opencode carga la config **una sola vez** al iniciar (sin hot-reload).
- Hooks disponibles relevantes: `config(cfg)`, `tui.command.execute`, custom commands, custom tools, `chat.message`, `chat.params`.
- El **switch en vivo sin reinicio** es el riesgo técnico principal a validar.

## Fuera de alcance (por ahora)

- Manejo de credenciales/providers (eso lo resuelve opencode con `/connect`).
- Perfiles a nivel de organización/enterprise.

## Próximos pasos

1. Resolver las decisiones de diseño abiertas.
2. Prototipar el switch desde la UI (validar viabilidad del switch en vivo).
3. Empaquetar como npm + README + ejemplos de perfiles.
