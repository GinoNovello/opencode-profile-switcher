# En 2.0 la config del usuario gana sobre el perfil, y se avisa

En OpenCode 2.0 los plugins de usuario corren antes que la config de agentes del host, asi que un `model` definido en cualquier capa de config (global, del repo o el frontmatter de un agente markdown) pisa al perfil; en 1.x era al reves, porque el hook `config` mutaba la config ya resuelta. Se decidio aceptar esa precedencia, aplicar el perfil igual y despues del recargado comparar el resultado con lo planeado: los agentes fijados por config se informan al usuario y el perfil activo se marca como parcial. Se descarto reescribir la config del usuario para recuperar la precedencia de 1.x (efecto lateral sobre archivos ajenos) y aceptarla en silencio (el usuario no sabria por que un agente no cambio).

## Consecuencias

Enmienda ADR-0002 en 2.0: una exclusion solo tiene efecto sobre agentes no fijados por config. Un agente fijado conserva el modelo de su config, este o no excluido, y su estado efectivo no se le puede restaurar.
