# Deploying updates for t3-code

This app ships over-the-air (OTA) JavaScript updates through the
**expo-updates-go** server. Bundles are built and published by the `newversion`
tool that lives in the expo-updates-go repo (a sibling checkout, e.g.
`../expo-updates-go`), which builds the bundle, lays it out under
`updates/t3-code/<runtimeVersion>/<timestamp>/`, commits it, and pushes so CI/CD
ships it.

## This app's settings

Unlike the other OTA apps, this one uses a **dynamic `app.config.ts`**, so the
config is split:

- `apps/mobile/app.json` is the OTA **source of truth** — `slug`,
  `runtimeVersion`, and `updates.url`. This is the file `newversion` reads and
  the file you edit to bump runtimeVersion. Current values:
  - slug: t3-code
  - runtimeVersion: 1.0.0 (always trust `app.json`, not this line)
  - updates.url: https://expo-updates.gawaak.ovh/t3-code/manifest
- `app.config.ts` merges those fields from `app.json` (via the `base` config
  arg) and builds everything else — variants, bundle IDs, plugins. If `app.json`
  omits the OTA fields (upstream), it falls back to EAS Update. **Do not** move
  the OTA fields into `app.config.ts`; keep them in `app.json` or `newversion`
  can't read them.

Fork identity (owner / project id / bundle-id root) comes from the repo-root
`.env.local`: `EAS_OWNER`, `EAS_PROJECT_ID`, `MOBILE_BUNDLE_ID`.

## Prerequisite: the expo-updates package must be installed

`expo-updates` is already a dependency here. It is the native module that fetches
and applies updates; without it an installed build never checks the manifest URL.
Because it is native, adding or upgrading it is a **native change** — bump
runtimeVersion and make a fresh build, not an OTA push.

## Ship a new OTA update

**Run the tool from the expo-updates-go repo, NOT from this app.** The tool
publishes the bundle into `./updates/` and runs `git add -A && commit && push`
in whatever directory you launch it from (the current working directory), NOT in
the `-project` path. `-project` only picks which app to _build_. Run from this
app's directory and it publishes into THIS repo and pushes to THIS remote — where
no update server serves it, so **nothing ships** even though the command
succeeds. So:

    cd ../expo-updates-go                                              # MUST cd here first
    go build -o newversion ./cmd/newversion                           # once
    ./newversion -project ~/Documents/dev/t3code/apps/mobile -dry-run # ALWAYS preview first
    ./newversion -project ~/Documents/dev/t3code/apps/mobile -push    # build + commit + push

`-dry-run` prints every command and file write without changing anything — always
run it first and read the output. `-push` performs the deploy
(`git add -A && git commit -m "t3-code <version>" && git push`). Pushing to the
server's remote is an outward-facing deploy — get the user's go-ahead before
`-push`.

What a push does:

1. Patch-bumps this app's `package.json` version (use `-letter` for a letter bump).
2. Runs `npx expo export` in this project.
3. Copies `dist/` into `updates/t3-code/1.0.0/<timestamp>/` (only the latest
   timestamp for a runtimeVersion is served; older ones are removed).
4. Commits and pushes from the expo-updates-go repo.

**Verify it actually shipped.** After `-push`, the new commit must be in the
**expo-updates-go** repo and contain ONLY `updates/t3-code/...` files. Check with
`git -C ../expo-updates-go log -1 --stat`. **Red flag:** if THIS app's git log
gained a commit with a `dist/` bundle or `updates/` folder, or that commit also
lists app source (`.tsx`, `app.json`), you ran it from the wrong directory and
pushed to the wrong repo — undo it, `cd ../expo-updates-go`, and re-run.

## Important: OTA vs native build

OTA updates only ship JavaScript and assets compatible with the **installed
native runtime**. The `runtimeVersion` (1.0.0) is the contract between the
installed binary and the bundles this server serves.

- Pure JS/asset change → just push a new OTA update (above).
- Native change (new native module, config plugin, SDK bump, anything touching
  the native project) → you must **bump runtimeVersion**, make a new build, and
  reinstall. An OTA push alone will not deliver native changes and can break
  clients on the old runtime.

## Creating a new native build: bump runtimeVersion first

Each native binary only ever loads bundles served under its own `runtimeVersion`.
Bundles live at `updates/t3-code/<runtimeVersion>/<timestamp>/`, so a native
build that changes the JS↔native contract must get a **brand-new,
never-before-used runtimeVersion.** Reusing the current value (1.0.0) for an
incompatible binary makes the server hand old-runtime bundles to the new app (or
vice versa) → crashes.

Do this **before** you build the binary:

1. In `apps/mobile/app.json`, bump `expo.runtimeVersion` to a new, never-shipped
   value (e.g. 1.0.0 → 1.1.0). Keep it monotonic; do NOT reuse or go backwards.
2. Bump the user-facing native version (`version` in `app.config.ts`) if the
   store/build needs it.
3. Build and reinstall the native binary (see below).
4. Only after the new binary is installed, ship OTA updates for it with
   `newversion`. Its bundles land in a fresh `updates/t3-code/<new-runtimeVersion>/`
   folder and never touch the bundles still served to clients on 1.0.0.

### Local build command (this fork's quirks)

The plain `npx eas build --local` fails in this monorepo for three reasons that
are already worked around — keep them in place:

- **Global build plugin.** eas-cli shells out to `npx eas-cli-local-build-plugin`,
  which npm can't resolve against the repo's pnpm overrides. Install it globally
  (`npm i -g eas-cli-local-build-plugin`) and point eas-cli at it. So build with:

      cd apps/mobile
      EAS_LOCAL_BUILD_PLUGIN_PATH=$(which eas-cli-local-build-plugin) \
        npx eas build -p ios --profile preview --local

- **Swift `weak let`.** Xcode 26.0.1's Swift rejects `weak let` in Expo SDK 56's
  native code. Patched via `patches/expo-modules-jsi@56.0.7.patch` and
  `patches/expo-modules-core@56.0.14.patch`. Drop both once on Xcode 26.1+.
- **pnpm self-manager.** `~/Library/pnpm/.tools/pnpm/10.24.0` must be a valid
  pnpm install or the build's `pnpm install` fails.

Install the resulting `.ipa` on the connected iPhone (unlock it first):

    xcrun devicectl device install app --device <udid> apps/mobile/build-*.ipa

Notes:

- `newversion` only ever deletes the previous timestamp **within the same
  app+runtimeVersion**, so bumping runtimeVersion preserves the old runtime's
  bundle and keeps existing users working until they reinstall.
- Don't hand-edit `updates/` in the expo-updates-go repo. Let `newversion`
  create the new runtimeVersion folder on the first OTA push for that build.
