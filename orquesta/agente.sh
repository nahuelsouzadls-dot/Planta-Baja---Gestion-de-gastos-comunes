#!/usr/bin/env bash
# Lo corre Nahuel UNA vez en su pestaña. Deja a Copilot escuchando órdenes de Claude.
# Uso: ./orquesta/agente.sh <nombre>   (ej: ./orquesta/agente.sh diseno)
# Claude da una orden creando orquesta/ordenes/<nombre>; este script la toma,
# corre Copilot en esta pestaña (sin pedir permisos) y vuelve a esperar.
set -uo pipefail
nombre="${1:?uso: ./orquesta/agente.sh <nombre>}"
cd "$(dirname "$0")/.."
mkdir -p orquesta/ordenes
orden="orquesta/ordenes/$nombre"
tarea="orquesta/tareas/$nombre.md"

echo "🎧 Agente '$nombre' escuchando órdenes de Claude. No hace falta tocar nada acá. (Ctrl+C para cerrar)"
while true; do
  if [ -f "$orden" ]; then
    rm -f "$orden"
    echo
    echo "▶ $(date '+%T') Orden recibida: $(head -1 "$tarea")"
    copilot \
      --allow-all-tools \
      --no-ask-user \
      --deny-tool='shell(git commit)' --deny-tool='shell(git add)' --deny-tool='shell(git push)' \
      --deny-tool='shell(git checkout)' --deny-tool='shell(git reset)' --deny-tool='shell(git stash)' \
      -p "Sos el agente '$nombre'. Leé orquesta/README.md (el protocolo) y $tarea (tu tarea) y ejecutala completa respetando el protocolo. Nadie va a responder preguntas: si algo es ambiguo, elegí la opción más conservadora y anotalo en el reporte. Al terminar, escribí orquesta/reportes/$nombre.md con el formato del protocolo."
    echo "■ $(date '+%T') Terminó. Claude revisa el resultado. Esperando la próxima orden..."
  fi
  sleep 2
done
