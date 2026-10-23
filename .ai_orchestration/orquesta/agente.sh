#!/usr/bin/env bash
# Lo corre Nahuel UNA vez en su pestaña. Deja al agente escuchando órdenes de Claude.
# Uso: ./.ai_orchestration/orquesta/agente.sh <nombre> [copilot|agy]
#   <nombre>   — identidad del agente (implementador, auditor, antigravity…)
#   [herramienta] — CLI a usar: copilot (default) o agy (Gemini)
#
# Roles:
#   implementador → copilot   (codea, escribe CSS/HTML)
#   auditor       → agy       (audita calidad, testea, corrige errores)
#   antigravity   → copilot   (auditor de diseño visual)
#
# Claude crea .ai_orchestration/orquesta/ordenes/<nombre> para disparar la tarea.
set -uo pipefail
nombre="${1:?uso: ./.ai_orchestration/orquesta/agente.sh <nombre> [copilot|agy]}"
herramienta="${2:-copilot}"
cd "$(dirname "$0")/../.."
mkdir -p .ai_orchestration/orquesta/ordenes
orden=".ai_orchestration/orquesta/ordenes/$nombre"
tarea=".ai_orchestration/orquesta/tareas/$nombre.md"

prompt_base="Sos el agente '$nombre'. Leé .ai_orchestration/orquesta/README.md (el protocolo) y $tarea (tu tarea) y ejecutala completa respetando el protocolo. Nadie va a responder preguntas: si algo es ambiguo, elegí la opción más conservadora y anotalo en el reporte. Al terminar, escribí .ai_orchestration/orquesta/reportes/$nombre.md con el formato del protocolo."

echo "🎧 Agente '$nombre' [$herramienta] escuchando órdenes de Claude. (Ctrl+C para cerrar)"
while true; do
  if [ -f "$orden" ]; then
    rm -f "$orden"
    echo
    echo "▶ $(date '+%T') Orden recibida: $(head -1 "$tarea")"
    case "$herramienta" in
      agy)
        agy \
          --dangerously-skip-permissions \
          --mode accept-edits \
          -p "$prompt_base"
        ;;
      copilot|*)
        copilot \
          --allow-all-tools \
          --no-ask-user \
          --deny-tool='shell(git commit)' --deny-tool='shell(git add)' --deny-tool='shell(git push)' \
          --deny-tool='shell(git checkout)' --deny-tool='shell(git reset)' --deny-tool='shell(git stash)' \
          -p "$prompt_base"
        ;;
    esac
    echo "■ $(date '+%T') Terminó. Claude revisa el resultado. Esperando la próxima orden..."
  fi
  sleep 2
done
