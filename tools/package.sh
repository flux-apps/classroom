#!/usr/bin/env bash
# package.sh - build dist/design-from-pdf.zip from the design-from-pdf skill directory.
#
# The skill directory IS the package. Only these files may live in it; anything else (a venv, tests, examples,
# notes) makes this script fail loudly instead of shipping it:
#   top-level files  SKILL.md requirements.txt bootstrap.sh dfp.sh NOTICE.md
#   top-level dirs   dfp/ assets/        (__pycache__ and *.pyc are ignored and never packaged)
#
# Environment: DFP_DIST = output directory (default <repo>/dist)
# Exit: 0 zip written | 1 stray files or missing package files | 3 no usable Python to write the zip
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILL_DIR="$ROOT/.claude/skills/design-from-pdf"
DIST="${DFP_DIST:-$ROOT/dist}"
TOP_FILES="SKILL.md requirements.txt bootstrap.sh dfp.sh NOTICE.md"
TOP_DIRS="dfp assets"

[ -d "$SKILL_DIR" ] || { echo "package: skill directory not found: $SKILL_DIR" >&2; exit 1; }

stray=""
list="$(cd "$SKILL_DIR" && find . -type f ! -path '*/__pycache__/*' ! -name '*.pyc' | sed 's|^\./||' | LC_ALL=C sort)"
while IFS= read -r f; do
  [ -n "$f" ] || continue
  top="${f%%/*}"
  ok=0
  if [ "$top" = "$f" ]; then
    for t in $TOP_FILES; do [ "$t" = "$f" ] && ok=1; done
  else
    for d in $TOP_DIRS; do [ "$d" = "$top" ] && ok=1; done
  fi
  [ "$ok" = 1 ] || stray="$stray $f"
done <<EOF
$list
EOF
if [ -n "$stray" ]; then
  echo "package: refusing to package; not part of the skill package:$stray" >&2
  exit 1
fi
for t in $TOP_FILES; do
  [ -f "$SKILL_DIR/$t" ] || { echo "package: missing package file $t" >&2; exit 1; }
done

PY=""
for c in python3 python "py -3"; do
  # shellcheck disable=SC2086
  if $c -c "import zipfile" >/dev/null 2>&1; then PY="$c"; break; fi
done
[ -n "$PY" ] || { echo "package: no working Python to write the zip" >&2; exit 3; }

native() { cygpath -m "$1" 2>/dev/null || echo "$1"; }
mkdir -p "$DIST" || exit 1
OUT="$DIST/design-from-pdf.zip"
TMP="$DIST/.design-from-pdf.zip.tmp"
rm -f "$TMP"
LIST_FILE="$DIST/.design-from-pdf.files.tmp"
printf '%s\n' "$list" > "$LIST_FILE"
# shellcheck disable=SC2086
$PY - "$(native "$SKILL_DIR")" "$(native "$TMP")" "$(native "$LIST_FILE")" <<'PYEOF' || { rm -f "$TMP" "$LIST_FILE"; echo "package: zip failed" >&2; exit 3; }
import sys, zipfile
skill, out, listing = sys.argv[1:4]
names = [l.strip() for l in open(listing, encoding="utf-8") if l.strip()]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for n in sorted(names):
        z.write(skill + "/" + n, "design-from-pdf/" + n)
PYEOF
rm -f "$LIST_FILE"
mv -f "$TMP" "$OUT" || exit 1
echo "package: wrote $OUT ($(echo "$list" | wc -l | tr -d ' ') files)"
exit 0
