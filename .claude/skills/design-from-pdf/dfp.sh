#!/usr/bin/env bash
# dfp.sh - run a dfp command:  dfp.sh probe|analyze|gate|scaffold|validate|verify ...
# Makes sure the environment exists (bootstrap.sh), then runs `python -m dfp` from it. Works from any current
# directory: the skill directory is resolved from this file, never from the cwd. JSON goes to stdout; bootstrap
# progress and reasons go to stderr.
set -u
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

bash "$SKILL_DIR/bootstrap.sh" >&2 || exit 3
VENV="$(bash "$SKILL_DIR/bootstrap.sh" --print-venv | tail -n 1)"

PY=""
for p in "$VENV/Scripts/python.exe" "$VENV/Scripts/python" "$VENV/bin/python"; do
  if [ -x "$p" ]; then PY="$p"; break; fi
done
[ -n "$PY" ] || { echo "blocked: no python in $VENV after bootstrap" >&2; exit 3; }

export PYTHONDONTWRITEBYTECODE=1
case "$(uname -s 2>/dev/null)" in
  MINGW*|MSYS*|CYGWIN*)
    NATIVE="$(cygpath -w "$SKILL_DIR" 2>/dev/null || echo "$SKILL_DIR")"
    export PYTHONPATH="$NATIVE${PYTHONPATH:+;$PYTHONPATH}" ;;
  *)
    export PYTHONPATH="$SKILL_DIR${PYTHONPATH:+:$PYTHONPATH}" ;;
esac
exec "$PY" -m dfp "$@"
