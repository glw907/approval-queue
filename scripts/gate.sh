#!/usr/bin/env bash
# gate.sh: the approval-queue gate. Type-checks and tests the app, then runs the shell tests,
# including the install test. Needs `npm ci --prefix approval-queue` first and the brief register
# (REGISTER, default ~/.claude/docs/voice/approval-brief.md).
set -euo pipefail
cd "$(dirname "$0")/.."

npm run check --prefix approval-queue
npm test --prefix approval-queue
for t in tests/*.test.sh; do
  bash "$t"
done
echo "gate: ok"
