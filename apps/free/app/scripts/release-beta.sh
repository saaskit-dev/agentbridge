#!/usr/bin/env bash
# One-command beta release from a local macOS machine or self-hosted GitHub runner.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../../.." && pwd)"
APP_ENV=production RELEASE_LANE=beta "$ROOT_DIR/scripts/free-app-ios-release.sh"
