# Desktop Release

## Goal

Provide a repeatable desktop packaging flow for the Tauri-based Free desktop app without code signing or notarization.

Current scope:

- Local production packaging
- Release artifact staging
- SHA256 checksum generation
- Tag-triggered GitHub Actions release for macOS / Linux
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
pnpm exec tauri build --config src-tauri/tauri.conf.json --bundles app

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

If updater signing material is available, the local build also includes updater artifacts and signatures. Local desktop builds now auto-discover keys from these sources, in order:

- existing process env: `TAURI_UPDATER_PUBLIC_KEY`, `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_RAW`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- explicit file envs: `TAURI_UPDATER_PUBLIC_KEY_FILE`, `TAURI_SIGNING_PRIVATE_KEY_FILE`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD_FILE`
- latest matching local keyset under `~/.tauri/free-desktop*.key`, `.key.pub`, `.password`

On macOS, local packaging intentionally avoids Tauri's built-in DMG bundler and generates the DMG in a follow-up `hdiutil makehybrid -hfs` step after the `.app` bundle is produced. If `hdiutil` still fails in the local environment, the flow falls back to a `.zip` archive so staging can still complete.

## Version Source

Desktop versioning is managed independently through `scripts/version.js desktop`.

The desktop release workflow only updates:

- `apps/free/app/src-tauri/tauri.conf.json`

Manual desktop releases now default to a time-based version strategy. The generated value stays semver-compatible for Tauri updater, but it is derived from the current release time rather than manual patch/minor bumps.

Use:

```bash
./run version desktop time
./run version desktop patch
./run version desktop minor
./run version desktop major
./run version desktop 0.2.0
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

Then either:

- export `TAURI_UPDATER_PUBLIC_KEY`, `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- or point to files with `TAURI_UPDATER_PUBLIC_KEY_FILE`, `TAURI_SIGNING_PRIVATE_KEY_FILE`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD_FILE`
- or keep the generated trio in `~/.tauri/` using a `free-desktop*.key` basename and let local desktop builds auto-discover them

For `TAURI_UPDATER_PUBLIC_KEY`, either of these formats works:

- the single-line base64 string Tauri CLI expects
- the full `.pub` file content from `tauri signer generate`

The release workflow normalizes full `.pub` file content into the single-line base64 format Tauri CLI expects before writing `tauri.updater.conf.json`.

For `TAURI_SIGNING_PRIVATE_KEY`, keep the full private key file content from `tauri signer generate`.
The GitHub release workflow base64-encodes that full multiline key file into the single-line format that Tauri CLI actually expects, so GitHub Secrets can safely store the generated file content directly.

## GitHub Actions

The workflow is:

- `.github/workflows/release-desktop.yml`

It creates / updates a GitHub Release on:

- `macos-latest`
- `ubuntu-24.04`

The release workflow is now manual-only. When you trigger it, it will:

1. bump the desktop version automatically
2. commit the version change to `main`
3. create and push `desktop-v<timestamp>` tag
4. build release artifacts from that exact release commit

For macOS, the workflow builds the updater-compatible `.app` bundle first, then packages a plain drag-install `.dmg` in a separate CI step and uploads it to the same release.
The workflow attaches release assets and `latest.json`, which the desktop app queries for in-app updates.

## Release Checklist

1. Run `./run desktop ship`
2. Install and smoke-test the produced package
3. Trigger `Release Desktop` manually
4. Verify the GitHub Release contains installers and `latest.json`
5. Publish checksums together with the binaries

## Notes

- No OS-level code signing is included in this flow
- Users may need to manually trust the app on first install
- JS-only changes can still use OTA separately; native / Tauri changes require a new desktop package
- Updater signing is still mandatory for desktop auto-update
