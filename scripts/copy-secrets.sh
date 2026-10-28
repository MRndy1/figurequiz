#!/usr/bin/env bash
# Copy secrets from an env file to the clipboard one at a time, without printing them.
#
#   scripts/copy-secrets.sh web/.env.local OPENROUTER_API_KEY SUPABASE_SECRET_KEY
#
# For each NAME it puts the value on the clipboard, waits while you paste it (into the Vercel
# dashboard, say) and press Enter, then moves on. The clipboard is cleared at the end, even on
# Ctrl+C. Values never reach the screen, so they can't end up in a terminal log or a chat
# transcript — the counterpart of scripts/set-secret.sh.
set -euo pipefail

if [ $# -lt 2 ]; then
  echo "usage: $0 <env-file> <NAME>..." >&2
  exit 2
fi
file=$1
shift
if [ ! -r "$file" ]; then
  echo "error: can't read $file" >&2
  exit 1
fi

trap 'pbcopy < /dev/null' EXIT

for name in "$@"; do
  value=$(grep -m1 "^$name=" "$file" | cut -d= -f2-) || true
  if [ -z "$value" ]; then
    echo "error: $name is not set in $file" >&2
    exit 1
  fi
  printf '%s' "$value" | pbcopy
  printf 'Copied %s (%d characters). Paste it, then press Enter here... ' "$name" "${#value}" >&2
  if ! read -r _ < /dev/tty; then
    printf '\nStopped. Clipboard cleared.\n' >&2
    exit 1
  fi
done
echo "Done. Clipboard cleared." >&2
