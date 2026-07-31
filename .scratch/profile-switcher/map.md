# Mapa wayfinder — opencode-profile-switcher

Label: wayfinder:map

## Destination

El paquete **`opencode-profile-switcher`** publicado en npm, instalable como cualquier plugin de opencode agregando el nombre al array `"plugin"` de `opencode.json` (estilo superpowers). Con README y ejemplos. El mapa lleva la ejecución adentro: no termina en una spec, termina en el paquete publicado y funcionando.

## Notes

- Dominio: plugin de opencode (verificado contra opencode 1.18.10). Punto de partida: el plugin local ya probado en `~/.config/opencode/plugins/profile-switcher.ts` y el [PRD](../../PRD.md).
- Skills a consultar por sesión: `/grilling` y `/domain-modeling` para decisiones; `/prototype` para el switch en vivo; `/research` para tickets research.
- Idioma del esfuerzo: español.
- El repo aún no tiene commits ni remoto → los hallazgos de research van a `.scratch/profile-switcher/research/<slug>.md` en el working tree (no hay ramas `research/*` posibles todavía).
- Este esfuerzo **sí ejecuta**: cuando las decisiones estén resueltas, los tickets de implementación/publicación graduarán desde la niebla.

## Decisiones so far

Decisiones tomadas en la sesión de charting (sin ticket propio; quedan acá como registro):

- **Destino = paquete npm publicado** — no solo spec; se entrega el plugin instalable vía array `plugin` de `opencode.json`.
- **UX del switch: en vivo si se puede, sino avisar** — apuntamos a switch sin reinicio (a validar con prototipo); fallback: persistir perfil elegido + avisar "reiniciá opencode".
- **Alcance genérico** — cada usuario define sus perfiles en su config; sin presets fijos.
- **Solo agentes default de opencode** — el plugin cubre únicamente los agentes que vienen por default; cada perfil se configura mediante un **wizard interactivo dentro de opencode** (cómo se implementa un setup así es ticket de research).
- **Trigger: solo comando slash** — ej. `/profile <nombre>`; sin keybind por ahora.
- **Perfiles globales** — a nivel usuario, no por proyecto.
- **Nombre npm: `opencode-profile-switcher`** — sin scope; verificado libre en npm el 2026-07-31. (`opencode-profiles` ya existe → prior art, ver ticket 04.)

<!-- índice de tickets cerrados: una línea por ticket, gist + link -->

- [Research: prior art — opencode-profiles y el issue upstream](issues/04-research-prior-art.md) — nadie ofrece switch genérico modelo→agente desde la UI (hueco intacto; upstream no lo va a hacer); el mecanismo de switch en vivo de `opencode-sdd-engram-manage` (`api.client.global.config.update()`) es reusable; publicar el nombre npm pronto (existe repo homónimo sin publicar).

## Not yet specified

Niebla en scope, todavía sin pregunta afilada:

- **Implementación del plugin** — el slicing depende del schema de config (ticket 05) y del resultado del prototipo de switch en vivo (ticket 06).
- **Implementación del wizard de setup** — depende de qué permita la API de plugins (ticket 01) y del schema (ticket 05).
- **README, ejemplos de perfiles y docs** — depende del schema y la UX finales.
- **Publicación en npm y versión inicial** — depende de que exista el paquete; incluye decidir versiones de opencode soportadas / peer deps.
- **Estrategia de testing / CI** — depende de cómo quede estructurado el paquete.

## Out of scope

- **Manejo de credenciales/providers** — lo resuelve opencode con `/connect` (PRD).
- **Perfiles a nivel organización/enterprise** (PRD).
- **Keybind para cambiar/ciclar perfiles** — descartado en charting; solo comando slash. Vuelve solo si se redibuja el destino.
