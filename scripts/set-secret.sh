#!/usr/bin/env bash
# Save a secret into a git-ignored env file without it ever appearing on screen.
#
#   scripts/set-secret.sh web/.env.local OPENROUTER_API_KEY
#
# Prompts for the value with input hidden (paste it and press Enter), replaces any existing
# line for that name, and leaves the file readable only by you. Claude never handles keys
# (SESSION.md), so a person runs this and pastes the key at the prompt.
set -euo pipefail

if [ $# -ne 2 ]; then
  echo "usage: $0 <env-file> <NAME>" >&2
  exit 2
fi
file=$1
name=$2

case $name in
  '' | [0-9]* | *[!A-Z0-9_]*)
    echo "error: '$name' is not an env var name (capitals, digits, underscores)" >&2
    exit 2
    ;;
esac

if ! git check-ignore -q "$file"; then
  echo "error: $file is not git-ignored, so a secret written there could be committed" >&2
  exit 1
fi

printf 'Paste %s (input hidden), then press Enter: ' "$name" >&2
IFS= read -rs value || true
echo >&2
# A paste can drag along a newline or spaces; keys never contain whitespace.
value=${value//[$'\t\r\n ']/}
if [ -z "$value" ]; then
  echo "error: nothing was pasted; $file is unchanged" >&2
  exit 1
fi

touch "$file"
chmod 600 "$file"
tmp=$(mktemp "$file.XXXXXX")
chmod 600 "$tmp"
grep -v "^$name=" "$file" > "$tmp" || true
printf '%s=%s\n' "$name" "$value" >> "$tmp"
mv "$tmp" "$file"
echo "Saved $name to $file (${#value} characters)." >&2
