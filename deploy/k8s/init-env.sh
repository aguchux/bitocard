#!/usr/bin/env sh
# Copies every missing deploy/k8s/<shared|bitocard|udozo>/env/<name> from its <name>.example, never overwriting a file
# already there, readable by its owner only. Fill in the blanks before `kubectl apply -k deploy/k8s`.
set -eu
cd "$(dirname "$0")"
for example in shared/env/*.example bitocard/env/*.example udozo/env/*.example; do
  target="${example%.example}"
  if [ -e "$target" ]; then
    echo "kept    $target"
  else
    cp "$example" "$target"
    chmod 600 "$target"
    echo "created $target"
  fi
done
# Anything still blank is listed, so nothing is applied half set up.
grep -lE '^[A-Za-z_][A-Za-z0-9_]*=$' shared/env/*.env bitocard/env/*.env udozo/env/*.env 2>/dev/null | sed 's/^/to fill in: /' || true
