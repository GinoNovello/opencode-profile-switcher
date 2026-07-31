# 01 — Research: API de plugins de opencode — comandos slash e interacción con el usuario

Type: research
Status: open

## Question

¿Cómo hace un plugin de opencode (npm, cargado vía array `plugin` de `opencode.json`) para:

1. **Registrar un comando slash** visible en la UI (ej. `/profile <nombre>`) — ¿custom commands, `tui.command.execute`, otro mecanismo? ¿Puede recibir argumentos y autocompletar los nombres de perfil?
2. **Interactuar con el usuario** — mostrar un wizard/preguntas paso a paso dentro de opencode (para el setup de perfiles), mostrar toasts/mensajes de confirmación ("perfil aplicado", "reiniciá para aplicar").
3. **Persistir estado** — dónde y cómo un plugin escribe/lee config propia (archivo propio, sección en `opencode.json`, API del SDK).

Contexto: opencode 1.18.10; plugin local de referencia en `~/.config/opencode/plugins/profile-switcher.ts`; PRD en `PRD.md`. Fuentes primarias: docs oficiales de opencode (opencode.ai/docs), repo `anomalyco/opencode`, tipos de `@opencode-ai/plugin`.

Hallazgos → `.scratch/profile-switcher/research/01-api-plugins-comandos-ui.md`.
