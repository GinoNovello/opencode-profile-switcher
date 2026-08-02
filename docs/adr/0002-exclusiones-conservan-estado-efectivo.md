# Las exclusiones conservan el estado efectivo

Un agente `excluded` conserva su ultimo modelo y variante efectivos, incluso si fueron aplicados por otro perfil y aunque opencode se reinicie; si no existe estado previo del plugin, conserva la configuracion original. Se eligio esta semantica historica en lugar de restaurar siempre la configuracion base, por lo que el plugin debe persistir el estado efectivo.
