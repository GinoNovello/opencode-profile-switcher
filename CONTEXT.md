# opencode-profile-switcher

Plugin de opencode que define perfiles de modelos y los switchea desde la UI sin editar config a mano.

## Language

**Perfil**:
Un set nombrado de modelos (uno por tier) que se aplica a todos los agentes en un solo paso.
_Avoid_: preset, configuración, modo

**Tier**:
Una de las dos categorías de capacidad — `heavy` (razonamiento/orquestación) y `rest` (todo lo demás) — a la que se asigna cada agente. Un perfil define qué modelo va en cada tier; `small_model` sigue al tier `rest`.
_Avoid_: nivel, categoría, rol

**Asignación**:
El mapeo agente→tier, compartido entre todos los perfiles. Se define una vez en el wizard; los agentes sin asignación caen al tier `rest` con aviso.
_Avoid_: mapeo, distribución

**Exclusión**:
Un agente marcado para que el switch nunca le toque el modelo (ej. uno que necesita un modelo multimodal específico).
_Avoid_: pin, pineo, skip

**Perfil activo**:
El perfil actualmente aplicado; se persiste en `profiles.json` y el hook `config` lo re-aplica en cada boot.
_Avoid_: perfil actual, selección

**Wizard**:
El flujo interactivo dentro de opencode (diálogos TUI) que crea o edita la asignación y los perfiles, validando contra los providers realmente conectados.
_Avoid_: setup manual, instalador

**Switch en vivo**:
Cambio de perfil sin reiniciar el proceso de opencode: persistir el perfil activo + `client.instance.dispose()` → la instancia se re-bootstrapea con la config nueva y las sesiones sobreviven.
_Avoid_: hot-reload, reinicio automático
