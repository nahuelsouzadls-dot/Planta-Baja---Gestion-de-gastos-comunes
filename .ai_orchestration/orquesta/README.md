# Orquesta — protocolo multi-agente

**Claude Code** es el orquestador: decide qué se hace, escribe las tareas, lanza a los agentes, revisa cada resultado y commitea.
**Los agentes de Copilot** corren en pestañas de Nahuel, pero reciben las órdenes de Claude. Cada uno tiene un nombre y sus propios archivos.
Nahuel solo habla con Claude.

```
orquesta/
├── README.md          ← este protocolo (lo leen todos)
├── tablero.md         ← estado general: qué agente hace qué (lo mantiene Claude)
├── agente.sh          ← deja una pestaña escuchando órdenes (lo corre Nahuel una vez)
├── ordenes/<nombre>   ← la señal de "arrancá" que deja Claude (no se versiona)
├── tareas/<nombre>.md ← la tarea actual de cada agente (la escribe Claude)
└── reportes/<nombre>.md ← el resultado de cada agente (lo escribe el agente)
```

## Cómo se trabaja

**Una sola vez:** Nahuel abre una pestaña por agente y corre `./orquesta/agente.sh <nombre>`. La pestaña queda escuchando y no hay que volver a tocarla.

1. **Nahuel le pide a Claude** lo que quiere. Nunca le habla a Copilot.
2. **Claude escribe la tarea** en `tareas/<nombre>.md`, se la resume a Nahuel y espera su ok.
3. **Claude da la orden** creando `ordenes/<nombre>`. La pestaña del agente la toma y corre Copilot ahí, a la vista, sin pedir permisos.
4. **El agente escribe su reporte** en `reportes/<nombre>.md`.
5. **Claude revisa el diff**, le cuenta a Nahuel el resultado y, con su ok, commitea. Si hay que corregir algo, actualiza la tarea y da otra orden.

## Reglas para los agentes de Copilot

1. **Tocá solo los archivos que tu tarea lista en "Archivos tuyos".** Otros agentes trabajan en paralelo sobre el mismo repo. Si necesitás cambiar un archivo que no es tuyo, no lo cambies: pedilo en el reporte.
2. **No toques `orquesta/agente.sh`, `README.md` ni `tablero.md`**: son del orquestador (en una corrida, `agente.sh` quedó vacío y ningún agente pudo volver a arrancar).
3. **No hagas commit, ni `git add`, ni `git stash`, ni `git checkout`.** El orquestador commitea después de revisar. Si dos agentes hacen operaciones de git a la vez, se rompe el trabajo del otro.
4. **Respetá `.github/copilot-instructions.md`** y la guía que indique tu tarea.
5. **Si algo es ambiguo, no adivines.** Hacé lo que esté claro y marcá el resto como pregunta en el reporte.
6. **Al terminar, escribí `orquesta/reportes/<tu-nombre>.md`** (reemplazando el contenido anterior) con este formato exacto:

```markdown
# Reporte: <nombre> — <id de la tarea>

## Hecho
- qué cambiaste, archivo por archivo

## Cómo lo verifiqué
- qué revisaste o corriste

## Preguntas / pedidos al orquestador
- (o "ninguna")

ESTADO: listo
```

La última línea es `ESTADO: listo` si completaste la tarea, o `ESTADO: bloqueado` si no pudiste seguir. Claude detecta esa línea: escribila solo cuando hayas terminado.
