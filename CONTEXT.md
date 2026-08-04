# opencode-profile-switcher

Plugin de opencode que define perfiles de modelos y los switchea desde la UI sin editar config a mano.

## Language

**Perfil**:
Un set nombrado que define la colocación de cada agente, un modelo por tier y uno para cada agente con asignación específica; se aplica en un solo paso.
_Avoid_: preset, configuración, modo

**Tier**:
Una de las dos categorías de capacidad — `heavy` (razonamiento/orquestación) y `rest` (todo lo demás) — a la que se asigna cada agente. Cada perfil define qué modelo va en cada tier; el `model` global sigue a `heavy` y `small_model` sigue a `rest`.
_Avoid_: nivel, categoría, rol

**Asignación**:
La colocación de un agente en `heavy`, `rest` o `specific` dentro de un perfil. Un mismo agente puede tener asignaciones diferentes entre perfiles; los agentes sin asignación caen al tier `rest` con aviso.
_Avoid_: mapeo, distribución

**Exclusión**:
Un agente que un perfil marca para conservar, incluso entre reinicios, su último modelo y variante efectivos aunque hayan sido aplicados por otro perfil. Si el plugin todavía no le aplicó ninguno, conserva el original de opencode. Es una alternativa a las tres colocaciones de la asignación y puede variar entre perfiles.
_Avoid_: pin, pineo, skip

**Modelo específico**:
Un modelo, con una variante opcional, que un perfil asigna directamente a un agente con asignación `specific`, sin pasar por un tier. Cada perfil debe definir uno para todos sus agentes `specific`, y puede usar modelos distintos para un mismo agente.
_Avoid_: modelo fijo, modelo global, exclusión

**Perfil activo**:
El perfil actualmente aplicado; se persiste en `profiles.json` y el hook `config` lo re-aplica en cada boot.
_Avoid_: perfil actual, selección

**Duplicación de perfil**:
Crea un perfil nuevo, independiente y autocontenido con la misma configuración completa que el de origen (modelos `heavy` y `rest`, asignaciones, modelos específicos, variantes y exclusiones); no altera el estado global activo ni el efectivo.
_Avoid_: clone, clonar, copia

**Wizard**:
El flujo interactivo dentro de opencode (diálogos TUI) que crea o edita perfiles completos, incluidas sus asignaciones, exclusiones y modelos, validando contra los providers realmente conectados.
_Avoid_: setup manual, instalador

**Switch en vivo**:
Cambio de perfil sin reiniciar el proceso de opencode: persistir el perfil activo + `client.instance.dispose()` → la instancia se re-bootstrapea con la config nueva y las sesiones sobreviven.
_Avoid_: hot-reload, reinicio automático
