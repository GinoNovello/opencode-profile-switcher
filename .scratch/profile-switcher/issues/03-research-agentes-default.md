# 03 — Research: agentes default de opencode

Type: research
Status: open

## Question

El plugin cubre **únicamente los agentes que vienen por default en opencode**. Necesitamos la lista exacta y sus características:

1. ¿Qué agentes trae opencode 1.18.10 por default (built-in), sin contar los definidos por el usuario en archivos `.md`? (el plugin local asume: build, plan, general, explore, compaction, title, summary, orchestrator, coder, planner, researcher, vision — verificar cuáles son realmente built-in).
2. ¿Cuáles necesitan capacidades especiales (ej. multimodal para `vision`) que justifiquen pinearlos por default?
3. ¿Puede un plugin **enumerar los agentes programáticamente** (vía `cfg.agent`, SDK, u otro), en vez de hardcodear la lista? ¿Qué pasa con agentes nuevos que aparezcan en versiones futuras?
4. ¿Cómo interactúa `model`/`small_model` global con el `model` por agente? (qué hereda quién).

Fuentes primarias: docs opencode.ai, código de `anomalyco/opencode`.

Hallazgos → `.scratch/profile-switcher/research/03-agentes-default.md`.
