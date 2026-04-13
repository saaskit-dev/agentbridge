#!/usr/bin/env bash

set -euo pipefail

CARGO_BIN="${CARGO_HOME:-$HOME/.cargo}/bin"

append_path() {
  if [ -n "${GITHUB_PATH:-}" ]; then
    echo "$1" >> "$GITHUB_PATH"
  fi
}

if [ -d "$CARGO_BIN" ]; then
  append_path "$CARGO_BIN"
  export PATH="$CARGO_BIN:$PATH"
fi

if command -v rustup >/dev/null 2>&1; then
  if ! rustup toolchain list | grep -q '^stable'; then
    rustup toolchain install stable --profile minimal
  fi

  rustup default stable
  rustc --version
  cargo --version
  exit 0
fi

if command -v rustc >/dev/null 2>&1 && command -v cargo >/dev/null 2>&1; then
  rustc --version
  cargo --version
  exit 0
fi

curl --proto '=https' --tlsv1.2 --retry 10 --retry-connrefused --location --silent --show-error --fail https://sh.rustup.rs \
  | sh -s -- --default-toolchain stable --profile minimal -y

append_path "$HOME/.cargo/bin"
export PATH="$HOME/.cargo/bin:$PATH"

rustc --version
cargo --version
