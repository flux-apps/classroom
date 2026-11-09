#!/usr/bin/env bash
# Test runner for design-from-pdf. Run from anywhere:
#   bash tests/run.sh [unittest args, e.g. tests.test_probe]
# Exit: 0 all green · 1 test failures · 3 environment blocked (deps could not be installed).
# Interpreter: $DFP_PYTHON, else the skill's venv. The venv lives OUTSIDE the skill dir (an installed skill may be
# read-only and is replaced on update): $DFP_VENV_DIR, else <DFP_HOME>/venv-<sha8 of requirements.txt>
# (DFP_HOME default: %LOCALAPPDATA%/design-from-pdf, else ${XDG_DATA_HOME:-~/.local/share}/design-from-pdf).
# First run builds it from requirements.txt (~2 min).
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILL_DIR="$ROOT/.claude/skills/design-from-pdf"
REQ="$SKILL_DIR/requirements.txt"
cd "$ROOT"
if command -v node >/dev/null 2>&1 && [ -f "$ROOT/tests/probe.test.js" ]; then
  echo "Running Node feature tests..."
  node --test "$ROOT"/tests/*.test.js || exit 1
fi


sha256() { sha256sum "$1" 2>/dev/null || shasum -a 256 "$1"; }

dfp_home() {
  if [ -n "${DFP_HOME:-}" ]; then echo "$DFP_HOME"
  elif [ -n "${LOCALAPPDATA:-}" ]; then echo "$(cygpath -u "$LOCALAPPDATA" 2>/dev/null || echo "$LOCALAPPDATA")/design-from-pdf"
  else echo "${XDG_DATA_HOME:-$HOME/.local/share}/design-from-pdf"; fi
}

if [ -f "$SKILL_DIR/bootstrap.sh" ]; then
  VENV="$(bash "$SKILL_DIR/bootstrap.sh" --print-venv | tail -n1)"
else
  VENV="${DFP_VENV_DIR:-$(dfp_home)/venv-$(sha256 "$REQ" | cut -c1-8)}"
fi

venv_python() {
  for p in "$VENV/Scripts/python.exe" "$VENV/Scripts/python" "$VENV/bin/python"; do
    [ -x "$p" ] && { echo "$p"; return 0; }
  done
  return 1
}

if [ -n "${DFP_PYTHON:-}" ]; then
  PY="$DFP_PYTHON"
elif [ -f "$SKILL_DIR/bootstrap.sh" ]; then
  bash "$SKILL_DIR/bootstrap.sh" >&2 || { echo "blocked: bootstrap.sh failed" >&2; exit 3; }
  PY="$(venv_python)" || { echo "blocked: no venv python after bootstrap" >&2; exit 3; }
else
  # bootstrap.sh not built yet: minimal inline equivalent, same venv + stamp contract.
  PY="$(venv_python || true)"
  if [ -z "$PY" ]; then
    # Probe by running: on Windows `python3` may be the Microsoft Store shim, which exists but fails.
    BASE=""
    for c in python3 python py; do
      if command -v "$c" >/dev/null 2>&1 && "$c" -c "import venv" >/dev/null 2>&1; then BASE="$c"; break; fi
    done
    [ -n "$BASE" ] || { echo "blocked: no working python (python3/python/py) on PATH" >&2; exit 3; }
    mkdir -p "$(dirname "$VENV")"
    "$BASE" -m venv "$VENV" >&2 || exit 3
    PY="$(venv_python)" || exit 3
    "$PY" -m pip install -q -r "$REQ" >&2 || { echo "blocked: pip install failed" >&2; exit 3; }
    sha256 "$REQ" | cut -d' ' -f1 > "$VENV/.requirements.sha256"
  fi
fi

export PYTHONDONTWRITEBYTECODE=1
export PYTHONPATH="$SKILL_DIR${PYTHONPATH:+:$PYTHONPATH}"   # dfp lives in the skill; tests live at the root
if [ "$#" -gt 0 ]; then
  exec "$PY" -m unittest "$@"
fi
exec "$PY" -m unittest discover -s tests -t . -p "test_*.py"
