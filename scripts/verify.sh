#!/usr/bin/env bash
set -e
cd "$(dirname "${BASH_SOURCE[0]}")/.."
# Run: typecheck → test → build → format:check (see steps above)
bun run typecheck
bun run test
bun run build
bun run format:check
