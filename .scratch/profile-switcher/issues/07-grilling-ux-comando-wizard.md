# 07 — Grilling: UX del comando /profile y del wizard de setup

Type: grilling
Status: open
Blocked by: 01, 06

## Question

Sabiendo qué permite la API de plugins (ticket 01) y si el switch en vivo es viable (ticket 06), fijar con el usuario los flujos concretos:

1. **`/profile`**: sintaxis exacta (`/profile <nombre>`, `/profile` sin args ¿lista?, ¿muestra el activo?), mensajes de confirmación, comportamiento del fallback si no hay switch en vivo (texto del aviso de reinicio, ¿reinicio automático?).
2. **Wizard de setup**: nombre del comando (¿`/profile-setup`?), flujo de preguntas (por tier vs por agente default), edición/borrado de perfiles existentes, qué pasa la primera vez que se usa `/profile` sin perfiles definidos.
3. **Errores**: perfil inexistente, config corrupta, modelo no disponible.
