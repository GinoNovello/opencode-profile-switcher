# La version para 2.0 se publica como paquete hermano

OpenCode 1.x y 2.0 resuelven los mismos subpaths del paquete (`./server`, `./tui`) pero esperan modulos incompatibles, y un install sin version debe cargar siempre el codigo correcto. Por eso la version para 2.0 se publica como `opencode-profile-switcher-v2` y `opencode-profile-switcher` queda para 1.x; ambos salen del mismo repo y comparten el nucleo (perfiles, `profiles.json`, wizard e indicador puros), con un adaptador por host.

## Opciones consideradas

- Mismo nombre con majors y dist-tags (`@1`, `@2`): conserva el nombre, pero un install sin version en 2.0 instala el codigo de 1.x.
- Un artefacto dual detras de los mismos subpaths: la doc oficial lo cubre solo para el server, exige subir el piso de 1.x a 1.18.29 y un import de mas lo rompe en silencio.
- Mover `latest` a 2.0 y congelar 1.x: rompe a quien instala sin version en 1.x mientras 1.x se siga manteniendo.
