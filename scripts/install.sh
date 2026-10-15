#!/usr/bin/env bash
# install.sh: link the approval-queue command and its reminder hook script into ~/.local/bin, so
# both resolve to this checkout. Run it again after moving the checkout.
set -euo pipefail
cd "$(dirname "$0")/.."
here="$(pwd)"
dest="$HOME/.local/bin"
mkdir -p "$dest"
for name in approval-queue claude-approval-queue-reminder; do
  # A stow link in the way is replaced; a real file is not.
  if [ -e "$dest/$name" ] && [ ! -L "$dest/$name" ]; then
    echo "install: $dest/$name is a regular file; remove it first" >&2
    exit 1
  fi
  ln -sfn "$here/bin/.local/bin/$name" "$dest/$name"
done
echo "install: linked approval-queue and claude-approval-queue-reminder into $dest"
