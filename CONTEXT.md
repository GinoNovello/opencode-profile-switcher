# opencode-profile-switcher

Plugin de opencode que define perfiles de modelos y los switchea desde la UI sin editar config a mano. Hay una versión para opencode 1.x y otra para 2.0 (ADR-0004); los términos valen para ambas salvo donde se aclara.

## Language

**Perfil**:
Un set nombrado que define la colocación de cada agente, un modelo por tier y uno para cada agente con asignación específica; se aplica en un solo paso.
_Avoid_: preset, configuración, modo

**Tier**:
Una de las dos categorías de capacidad — `heavy` (razonamiento/orquestación) y `rest` (todo lo demás) — a la que se asigna cada agente. Cada perfil define qué modelo va en cada tier; el modelo por defecto de opencode sigue a `heavy`, y el modelo liviano sigue a `rest` (en 1.x `small_model`; en 2.0, que no lo tiene, los agentes ocultos como `title`, `summary` y `compaction`, asignados a `rest` como cualquier otro agente).
_Avoid_: nivel, categoría, rol

**Asignación**:
La colocación de un agente en `heavy`, `rest` o `specific` dentro de un perfil. Un mismo agente puede tener asignaciones diferentes entre perfiles; los agentes sin asignación caen al tier `rest` con aviso.
_Avoid_: mapeo, distribución

**Exclusión**:
Un agente que un perfil marca para conservar, incluso entre reinicios, su último modelo y variante efectivos aunque hayan sido aplicados por otro perfil. Si el plugin todavía no le aplicó ninguno, conserva el original de opencode. Es una alternativa a las tres colocaciones de la asignación y puede variar entre perfiles. En 2.0 no tiene efecto sobre un agente fijado por config (ADR-0003).
_Avoid_: pin, pineo, skip

**Modelo específico**:
Un modelo, con una variante opcional, que un perfil asigna directamente a un agente con asignación `specific`, sin pasar por un tier. Cada perfil debe definir uno para todos sus agentes `specific`, y puede usar modelos distintos para un mismo agente.
_Avoid_: modelo fijo, modelo global, exclusión

**Perfil activo**:
El perfil actualmente aplicado; se persiste en `profiles.json` y el plugin lo re-aplica en cada boot.
_Avoid_: perfil actual, selección

**Agente fijado por config**:
En 2.0, un agente cuyo modelo define la config del usuario (global, del repo o el frontmatter de un agente markdown); esa config le gana al perfil, que no puede cambiarle el modelo (ADR-0003).
_Avoid_: agente excluido, override, agente bloqueado

**Perfil parcial**:
En 2.0, el perfil activo cuando uno o más agentes de su asignación quedaron fijados por config y no tomaron el modelo del perfil; se informa al usuario.
_Avoid_: perfil roto, perfil inválido

**Variante no ofrecida**:
En 2.0, la variante que un perfil asigna a un agente cuando el catálogo de modelos de opencode lista ese modelo sin esa variante (p.ej. `big-pickle#high`, que no ofrece ninguna nombrada). Se aplica igual y se avisa, porque opencode recién la rechaza al mandar un prompt. Una variante omitida o `default`, un modelo que el catálogo no lista y un agente fijado por config nunca avisan.
_Avoid_: variante inválida, variante rota

**Duplicación de perfil**:
Crea un perfil nuevo, independiente y autocontenido con la misma configuración completa que el de origen (modelos `heavy` y `rest`, asignaciones, modelos específicos, variantes y exclusiones); no altera el estado global activo ni el efectivo.
_Avoid_: clone, clonar, copia

**Wizard**:
El flujo interactivo dentro de opencode (diálogos TUI) que crea o edita perfiles completos, incluidas sus asignaciones, exclusiones y modelos, validando contra los providers realmente conectados.
_Avoid_: setup manual, instalador

**Switch en vivo**:
Cambio de perfil sin reiniciar el proceso de opencode; las sesiones sobreviven. En 1.x re-bootstrapea la instancia con la config nueva. En 2.0, donde el modelo es de cada sesión, actualiza los agentes (sesiones y subagentes nuevos) y la sesión enfocada; las demás sesiones abiertas conservan su modelo (ADR-0005).
_Avoid_: hot-reload, reinicio automático

**Indicador de perfil**:
El widget persistente, informativo y no interactivo que muestra a la derecha del prompt (en home y en sesión) el perfil global activo, en texto muted con formato `nombre · modelo-corto-heavy` (p.ej. `performance · glm-5.2`). Representa el perfil activo global, no por sesión; en 2.0 marca cuando es un perfil parcial. Vuelve a leer `profiles.json` — y por ende se actualiza sin reiniciar — al boot, en cada resize del terminal y cuando llega el evento `server.instance.disposed` (que dispara todo switch en vivo). En terminal angosta colapsa a solo el nombre; si el heavy del perfil está ausente o es inválido, muestra solo el nombre; sin perfil activo no renderiza nada. La lógica de formato vive en `src/core/indicator.ts` (pura y testeable); `src/v1/tui.ts` solo la conecta a los slots `home_prompt_right` y `session_prompt_right` vía `api.slots.register` y a una señal reactiva de Solid.
_Avoid_: badge, status bar, banner, breadcrumb
