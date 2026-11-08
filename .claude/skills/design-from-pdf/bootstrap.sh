#!/usr/bin/env bash
# bootstrap.sh - make sure the pinned Python environment for the dfp tools exists. Safe to run every time.
#
#   bootstrap.sh               fast path when the venv matches requirements.txt (no python, no pip, no network);
#                              otherwise create the venv and `pip install -r requirements.txt`
#   bootstrap.sh --print-venv  print the resolved venv directory and exit 0 (no side effects)
#
# Environment:
#   DFP_HOME          writable data dir (default: %LOCALAPPDATA%/design-from-pdf, else
#                     ${XDG_DATA_HOME:-~/.local/share}/design-from-pdf). Never inside the skill directory.
#   DFP_VENV_DIR      exact venv location (default: <DFP_HOME>/venv-<first 8 hex of sha256(requirements.txt)>)
#   DFP_BASE_PYTHON   interpreter used to CREATE the venv (default: first of python3, python, py -3 that runs
#                     and is Python >= 3.9)
#
# Exit: 0 ready | 3 blocked (message starts with "blocked:"); there is no fallback to a system Python.
# Portable to bash 3.2 (macOS) and Git Bash on Windows.

set -u
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REQ="$SKILL_DIR/requirements.txt"

sha256() { sha256sum "$1" 2>/dev/null || shasum -a 256 "$1"; }

dfp_home() {
  if [ -n "${DFP_HOME:-}" ]; then
    echo "$DFP_HOME"
  elif [ -n "${LOCALAPPDATA:-}" ]; then
    echo "$(cygpath -u "$LOCALAPPDATA" 2>/dev/null || echo "$LOCALAPPDATA")/design-from-pdf"
  else
    echo "${XDG_DATA_HOME:-$HOME/.local/share}/design-from-pdf"
  fi
}

block() { echo "blocked: $*" >&2; exit 3; }

[ -f "$REQ" ] || block "requirements.txt not found next to bootstrap.sh"
REQ_HASH="$(sha256 "$REQ" | cut -d' ' -f1)"
[ -n "$REQ_HASH" ] || block "neither sha256sum nor shasum is available"

if [ -n "${DFP_VENV_DIR:-}" ]; then
  VENV="$DFP_VENV_DIR"
else
  VENV="$(dfp_home)/venv-$(echo "$REQ_HASH" | cut -c1-8)"
fi

if [ "${1:-}" = "--print-venv" ]; then
  echo "$VENV"
  exit 0
fi

venv_python() {
  local p
  for p in "$VENV/Scripts/python.exe" "$VENV/Scripts/python" "$VENV/bin/python"; do
    if [ -x "$p" ]; then echo "$p"; return 0; fi
  done
  return 1
}

STAMP="$VENV/.requirements.sha256"
if PY="$(venv_python)" && [ -f "$STAMP" ] && [ "$(cut -d' ' -f1 < "$STAMP" | tr -d '\r\n')" = "$REQ_HASH" ]; then
  exit 0                                   # fast path: nothing to do, works offline
fi

# Create the venv only when it does not exist yet; a stale stamp just reinstalls into it.
if [ -z "${PY:-}" ]; then
  PY=""
  OK_CHECK='import sys, venv; sys.exit(0 if sys.version_info >= (3, 9) else 1)'
  if [ -n "${DFP_BASE_PYTHON:-}" ]; then
    # shellcheck disable=SC2086
    "$DFP_BASE_PYTHON" -c "$OK_CHECK" >/dev/null 2>&1 || block "DFP_BASE_PYTHON ($DFP_BASE_PYTHON) is not a working Python >= 3.9 with the venv module"
    BASE=("$DFP_BASE_PYTHON")
  else
    BASE=()
    for c in "python3" "python" "py -3"; do
      # shellcheck disable=SC2086
      if $c -c "$OK_CHECK" >/dev/null 2>&1; then BASE=($c); break; fi
    done
    [ "${#BASE[@]}" -gt 0 ] || block "no working Python >= 3.9 found (tried python3, python, py -3); install Python or set DFP_BASE_PYTHON"
  fi
  mkdir -p "$(dirname "$VENV")" || block "cannot create $(dirname "$VENV") (set DFP_HOME to a writable directory)"
  echo "bootstrap: creating environment in $VENV" >&2
  "${BASE[@]}" -m venv "$VENV" >&2 || block "could not create the virtual environment in $VENV"
  PY="$(venv_python)" || block "the virtual environment in $VENV has no python executable"
fi

echo "bootstrap: installing pinned dependencies (first run needs network, about 2 minutes)" >&2
"$PY" -m pip install -q --disable-pip-version-check -r "$REQ" >&2 || block "pip install failed (network? see messages above); nothing was stamped, the next run retries"
"$PY" -c "import pymupdf, PIL" >&2 || block "dependencies installed but pymupdf/Pillow do not import"
echo "$REQ_HASH" > "$STAMP"
exit 0
