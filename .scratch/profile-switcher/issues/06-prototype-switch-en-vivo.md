# 06 — Prototype: switch de modelo en vivo

Type: prototype
Status: open
Blocked by: 02

## Question

Validar en concreto el mecanismo que el research del ticket 02 señale como más prometedor para cambiar el modelo **sin reiniciar opencode**: prototipo mínimo descartable (variante del plugin local) que intente aplicar un cambio de perfil en la sesión corriente y verificar contra opencode 1.18.10 si el modelo efectivamente cambia (orquestador y subagentes).

Resultado esperado: veredicto **viable / no viable / parcialmente viable** (ej. solo el orquestador), con el asset del prototipo linkeado. Esto decide si la UX principal es switch en vivo o persistir + avisar reinicio.
