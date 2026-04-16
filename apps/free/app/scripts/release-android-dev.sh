#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../../.." && pwd)"
APP_ENV=development "$ROOT_DIR/scripts/free-app-android-apk.sh"
