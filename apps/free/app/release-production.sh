#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
APP_ENV=production "$ROOT_DIR/scripts/free-app-ios-release.sh"
