# 02 — Research: viabilidad del switch de modelo en vivo (sin reiniciar opencode)

Type: research
Status: open

## Question

opencode carga la config una sola vez al iniciar (sin hot-reload). ¿Existe algún mecanismo por el cual un plugin pueda cambiar el modelo efectivo de la sesión actual y de los subagentes **sin reiniciar**?

Investigar contra fuentes primarias (docs opencode.ai, código de `anomalyco/opencode`, tipos de `@opencode-ai/plugin`, SDK `@opencode-ai/sdk`):

1. ¿`chat.params` / `chat.message` permiten sobrescribir el modelo por mensaje? ¿Aplica también a subagentes?
2. ¿El SDK/cliente HTTP expone alguna mutación de config o de sesión (ej. `session.update`, cambiar modelo de la sesión) en caliente?
3. ¿Hay algún evento/mecanismo de reload de config, o forma de que el plugin fuerce una recarga?
4. Si nada de eso existe: ¿cuál es el mejor fallback? (persistir perfil elegido + avisar reinicio; ¿puede el plugin disparar el reinicio?)

El resultado alimenta el prototipo del ticket 06 y el estado del issue upstream [opencode#12607](https://github.com/anomalyco/opencode/issues/12607) puede tener pistas.

Hallazgos → `.scratch/profile-switcher/research/02-switch-en-vivo.md`.
