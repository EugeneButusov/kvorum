#!/usr/bin/env bash
# provision-env.sh — generate .env on the target host from the 1Password vault.
# See docs/runbooks/secrets-rotation.md and ADR-028 for context.
#
# This script is a stub. Full implementation lands in M7.
# Exit code 69 (EX_UNAVAILABLE) signals that the feature is not yet available.

set -euo pipefail

echo "provision-env.sh: not yet implemented (lands in M7)." >&2
echo "To set up the environment manually, copy .env.example to .env and fill in the values." >&2
echo "See docs/runbooks/secrets-rotation.md for the full rotation procedure." >&2
exit 69
