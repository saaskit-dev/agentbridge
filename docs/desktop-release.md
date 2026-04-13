# Desktop Release

## Goal

Provide a repeatable desktop packaging flow for the Tauri-based Free desktop app without code signing or notarization.

Current scope:

- Local production packaging
- Release artifact staging
- SHA256 checksum generation
- Manual GitHub Actions release for macOS / Windows
- GitHub Releases based desktop auto-update

## Commands

From the repo root:

```bash
# Build production desktop bundle only
./run desktop build

# Build and stage releasable artifacts
./run desktop ship
```

Equivalent direct commands:

```bash
cd apps/free/app
pnpm tauri:build:production

cd ../..
./scripts/free-desktop-release.sh
```

## Output

Staged release artifacts are copied to:

```bash
apps/free/app/dist-desktop/<version>/<platform-arch>/
```

That directory contains:

- Desktop installers / app bundles copied from `apps/free/app/src-tauri/target/release/bundle/`
- `SHA256SUMS.txt`

If `TAURI_UPDATER_PUBLIC_KEY` is set in the environment, the local build also includes updater artifacts and signatures.

## Version Source

Desktop versioning is unified through `scripts/version.js`.

The script now updates all of:

- `apps/free/app/package.json`
- `apps/free/app/src-tauri/tauri.conf.json`

Use:

```bash
./run version patch
./run version minor
./run version major
./run version 0.2.0
```

## Auto Update

The desktop app uses Tauri updater with a static GitHub Releases endpoint:

```text
https://github.com/<owner>/<repo>/releases/latest/download/latest.json
```

Updater signing is required by Tauri and cannot be disabled. This is separate from macOS / Windows code signing.

Required secrets:

- `TAURI_UPDATER_PUBLIC_KEY`
- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

Generate the updater keypair with:

```bash
cd apps/free/app
pnpm tauri signer generate -w ~/.tauri/free-desktop.key
```

Then:

- put the public key content in `TAURI_UPDATER_PUBLIC_KEY`
- put the private key content in `TAURI_SIGNING_PRIVATE_KEY`
- put the password in `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

## GitHub Actions

Use the manual workflow:

- `.github/workflows/release-desktop.yml`

It creates / updates a GitHub Release on:

- `macos-latest`
- `windows-latest`

The workflow attaches release assets and `latest.json`, which the desktop app queries for in-app updates.

## Release Checklist

1. Bump version with `./run version ...`
2. Run `./run desktop ship`
3. Install and smoke-test the produced package
4. Trigger `Release Desktop`
5. Verify the GitHub Release contains installers and `latest.json`
6. Publish checksums together with the binaries

## Notes

- No OS-level code signing is included in this flow
- Users may need to manually trust the app on first install
- JS-only changes can still use OTA separately; native / Tauri changes require a new desktop package
- Updater signing is still mandatory for desktop auto-update
