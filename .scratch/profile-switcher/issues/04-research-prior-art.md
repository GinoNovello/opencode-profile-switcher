# 04 — Research: prior art — opencode-profiles y el issue upstream

Type: research
Status: resolved

## Question

Antes de construir, mirar lo que ya existe:

1. El paquete npm **`opencode-profiles`** ya está publicado (verificado 2026-07-31). ¿Qué hace, cómo define perfiles, cómo switchea, qué limitaciones tiene? ¿Se superpone con nuestro plugin o resuelve otra cosa? ¿Hay algo para aprender o reusar?
2. El feature request upstream [opencode#12607](https://github.com/anomalyco/opencode/issues/12607): ¿en qué estado está? ¿Hay señales de que opencode vaya a traer perfiles nativos pronto (lo que cambiaría el valor del plugin)? ¿Workarounds propuestos en el hilo?
3. ¿Otros plugins/proyectos de la comunidad que resuelvan el switch de modelos/perfiles en opencode?

Fuentes primarias: npm registry, repos de los paquetes, el hilo del issue en GitHub.

Hallazgos → `.scratch/profile-switcher/research/04-prior-art.md`.

## Answer

`opencode-profiles` (ocp, 0xKahi) NO se superpone: es un CLI launcher que lanza opencode con `OPENCODE_CONFIG_DIR` apuntando a un directorio de config por perfil — cada switch es un proceso nuevo, sin UI ni granularidad modelo→agente (75 dl/mes). El issue upstream #12607 está cerrado "completed" pero lo cerró el propio autor tras el workaround de aliases con `OPENCODE_CONFIG_DIR`; no hay ningún PR/issue activo de perfiles de config nativos (lo activo upstream es auth multi-cuenta, PR #36781), y wildcards de agentes (#18898) fue rechazado como not_planned → el valor del plugin sigue intacto. El competidor real es `opencode-sdd-engram-manage` (~8.9k dl/mes): plugin TUI que activa perfiles `{models: {agente: "provider/model"}}` en vivo vía `api.client.global.config.update()` sin reinicio — mecanismo a reusar — pero acoplado a agentes SDD/gentle-ai. No existe un plugin genérico de perfiles modelo→agente con switch desde la UI. El nombre npm `opencode-profile-switcher` está libre (404), aunque existe un repo homónimo no publicado (huybui38).

Research completo: `.scratch/profile-switcher/research/04-prior-art.md`.
