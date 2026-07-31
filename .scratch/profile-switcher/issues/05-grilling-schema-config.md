# 05 — Grilling: schema de perfiles y ubicación de la config

Type: grilling
Status: open
Blocked by: 01, 02, 03

## Question

Con los hechos de los tickets 01–03 sobre la mesa, decidir con el usuario:

1. **Schema de un perfil**: ¿tiers (heavy/rest) con asignación por agente default, mapeo explícito agente→modelo, o híbrido? ¿Cómo se expresa el pineo/exclusión (ej. `vision`)? ¿Soporta `variant` (ej. "max")?
2. **Ubicación**: ¿dónde viven los perfiles (archivo propio global tipo `~/.config/opencode/profiles.json`, sección dentro de `opencode.json`, otro)? ¿Dónde se persiste el **perfil activo**?
3. **Validación**: qué pasa con un perfil que referencia un modelo/provider no configurado.

Decisiones ya tomadas que acotan esto: alcance genérico, solo agentes default, perfiles globales, setup vía wizard.
