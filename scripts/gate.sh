#!/usr/bin/env bash
# gate.sh: the approval-queue gate. Type-checks and tests the app and the new queue in next/, then
# runs the shell tests, including the install test. Needs `npm ci --prefix approval-queue` and
# `npm ci --prefix next` first.
set -euo pipefail
cd "$(dirname "$0")/.."

npm run check --prefix approval-queue
npm test --prefix approval-queue
npm run check --prefix next
npm test --prefix next
for t in tests/*.test.sh; do
  bash "$t"
done
echo "gate: ok"
