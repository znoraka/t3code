---
name: sync-upstream
description: Merge upstream/main into the fork, ship the mobile update (OTA when JS-only, native EAS build when native bits changed), build and install the desktop app for the machine the skill runs on (macOS DMG or Linux AppImage), and rebuild + restart the t3code server service the app connects to. Use when the user says "sync upstream", "bring over upstream changes", "pull upstream and deploy", or asks to update the fork and redeploy the apps.
---

# Sync upstream & deploy

End-to-end fork update: merge `upstream/main`, decide OTA vs native for mobile,
ship it, build the desktop app for the current machine, install it, rebuild and
restart the server service, push to `origin`. Run every phase in order; if one
fails, stop and report — do not skip ahead to a later phase.

The desktop app is only the frontend: it adopts an already-running server. The
real backend is a **service running `apps/server/dist/bin.mjs` from this very
checkout** (macOS: launchd job `com.lempire.t3code`, `T3CODE_HOME=~/.t3`).
Merging alone changes nothing for it — it keeps running old code until its dist
is rebuilt and the service restarts (Phase 4).

Hard rules (non-negotiable):

- `origin` (`znoraka/t3code`) is the only write target. **Never** push, PR, or
  comment on upstream `pingdotgg/t3code`.
- **Never run `eas update`.** OTA ships only through `newversion` +
  the self-hosted expo-updates-go server. `eas update` publishes to the wrong
  server and rewrites `apps/mobile/app.json` `updates.url` (revert if it happens).
- Every native mobile rebuild bumps `expo.runtimeVersion` in
  `apps/mobile/app.json` first — unconditionally, even if the JS↔native
  contract "didn't change". No exceptions, no reasoning around it.
- Never kill processes by pattern-matching names/paths, and never touch
  `~/.t3/userdata` (see root AGENTS.md).

## Phase 0 — Preflight

1. Run from the repository root, on `main`, with a clean working tree
   (`git status --porcelain` empty; otherwise stop and ask).
2. Record the pre-merge point — every later decision diffs against it:
   `PRE_MERGE=$(git rev-parse HEAD)`
3. Note platform: `uname -sm` (Darwin arm64 → macOS flow; Linux → Linux flow).
4. If a native mobile build looks likely (Phase 2), check disk space now:
   `df -h /System/Volumes/Data` — the local EAS build needs **~15 GB free**.
   ENOSPC shows up obliquely (pod install rsync errors, `libtool: error
writing file`, 7z "errno=28"). Reclaim order if short: `corepack
pnpm@11.10.0 store prune`, old `release/*.dmg` + `apps/mobile/build-*.ipa`
   (keep newest), `~/Library/Caches` app caches, duplicate Xcode archives.
   Never touch Docker.raw without asking.

## Phase 1 — Merge upstream

1. `git fetch upstream && git merge upstream/main`
2. On conflicts, the fork deliberately diverges — keep **ours** for:
   - `apps/mobile/app.json` (OTA `updates.url`, `runtimeVersion`, slug, fork
     bundle ids `dev.ezag.t3code.*`)
   - `apps/mobile/eas.json`, `apps/mobile/modules/t3-terminal/**`
     (vendored GhosttyKit), fork branding, the AGENTS.md fork header,
     this skill and other fork-only files under `.agents/`.
     Take theirs elsewhere unless it breaks fork behavior; when a conflict needs
     real judgment, stop and ask.
3. Install: `vp i`. If pnpm fails to self-switch ("Failed to switch pnpm to
   v11.10.0 … ENOENT"), use
   `COREPACK_ENABLE_STRICT=0 CI=true corepack pnpm@11.10.0 install --no-frozen-lockfile`
   (see Failure modes for the permanent shim fix — the EAS build phase spawns
   plain `pnpm`, so fix the shim before a native build).
4. If the merge bumped a dependency vendored under `.repos/`, run
   `vpr sync:repos`.

## Phase 2 — Mobile: OTA or native build?

Classify the merged changes:

```
git diff --name-only "$PRE_MERGE"..HEAD -- apps/mobile packages/client-runtime packages/contracts packages/shared
```

**Native build required** if any of these changed:

- `apps/mobile/app.json` or `apps/mobile/app.config.ts` (plugins, SDK, any
  native config — a pure `version` string bump alone doesn't count)
- `apps/mobile/package.json` dependencies: any add/remove/bump of a package
  shipping native code; `expo`, `react-native`, and `expo-updates` bumps are
  always native
- `apps/mobile/modules/**`, `apps/mobile/plugins/**`, `apps/mobile/patches/**`,
  any tracked `ios/` or `android/` files, `eas.json`

Everything else (app JS/TS, shared packages, assets) is OTA-safe.
**When unsure, treat it as native.** No mobile changes at all → skip to Phase 3.

Full background: `apps/mobile/AGENTS.md`.

### OTA path (JS-only)

Requires the expo-updates-go checkout as a **sibling of the repo**
(`../expo-updates-go` with a built `./newversion`). Missing → skip with a note
in the final report that the OTA must be shipped from the Mac.

1. Do **not** set `APP_VARIANT` — `apps/mobile/.env.local` pins
   `APP_VARIANT=preview`, matching the installed build.
2. From `../expo-updates-go`:
   `./newversion -project <repo>/apps/mobile -dry-run` — read the output, then
   rerun with `-push`.
   - `newversion` calls `npx expo`, which chokes on the root package.json's
     pnpm-style `>` overrides (npm EINVALIDPACKAGENAME). Shim `npx` on PATH to
     exec `<repo>/apps/mobile/node_modules/.bin/expo` directly.
   - If a `-push` run is interrupted: in expo-updates-go
     `git checkout -- updates/`, revert the `apps/mobile/package.json` version
     bump it wrote, delete the partial `apps/mobile/dist/`, rerun.
3. The push alone does **not** deploy (no git webhook). Trigger Coolify:
   ```
   curl -X GET "https://coolify.gawaak.ovh/api/v1/deploy?uuid=$(cat ~/.config/coolify/t3code-deploy-uuid)" \
     -H "Authorization: Bearer $(cat ~/.config/coolify/token)"
   ```
   If either file is missing, ask the user for the value instead of guessing.
4. Verify (RTV = `expo.runtimeVersion` from `apps/mobile/app.json`):
   ```
   curl -s -H "expo-runtime-version: <RTV>" -H "expo-platform: ios" \
     -H "expo-protocol-version: 1" https://expo-updates.gawaak.ovh/t3-code/manifest
   ```
   `createdAt` must be from this run (Coolify may take a minute; re-check, don't
   conclude failure on the first stale read).
5. Handoff wording: Settings shows **no OTA id/hash** — tell the dev to open
   Settings and **tap the Version row 5×** to force the update. Never promise a
   visible hash.

### Native path (macOS only)

On Linux, stop here: report that a **native build is required** and must be run
from the Mac; do not attempt it.

1. Bump `expo.runtimeVersion` in `apps/mobile/app.json` — monotonic, never
   reused (e.g. 1.6.0 → 1.7.0). Commit the bump before building.
2. `rm -rf apps/mobile/ios` — stale prebuild output confuses EAS.
3. From `apps/mobile/` (**must** cd there — from the root, eas-cli invents a
   bogus EAS project and leaves a stray root `eas.json`):
   ```
   LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 npx eas build -p ios --profile preview --local --non-interactive
   ```
   Always `--local` (build on this Mac, never the EAS cloud queue). Credentials
   live on EAS (account znoraka@gmail.com, project `@gawaak/t3-code`, team
   N3RCJ8629P, ad-hoc distribution). Output: `build-<ts>.ipa` in `apps/mobile/`.
   - If npm dies with EINVALIDPACKAGENAME spawning the local build plugin:
     `npm install -g eas-cli-local-build-plugin@<version eas wants>` from
     outside the repo, then `export EAS_LOCAL_BUILD_PLUGIN_PATH=$(which eas-cli-local-build-plugin)`.
   - A stale Keychain Apple password fails login **and deletes the Keychain
     entry** — the real password is then needed once (re-saved on success).
4. Install on the iPhone:
   - USB: `xcrun devicectl device install app --device <coredevice-uuid> build-<ts>.ipa`,
     then `devicectl device process launch` to smoke-test.
   - No USB: ad-hoc OTA install — host the `.ipa` + `manifest.plist` on public
     HTTPS (plandrop via the `upload-artifact` skill) and have the dev open
     `itms-services://?action=download-manifest&url=<https manifest url>` in
     Safari. Works because the device UDID is in the ad-hoc profile.
   - New iPhone? It must be registered **before** the build — see "Registering
     a new iPhone" in the maintainer's notes / `eas device:create` (interactive).
5. The fresh binary embeds the latest JS; no OTA push is needed now. Future
   OTA pushes will target the new runtimeVersion automatically.

## Phase 3 — Desktop build & install (current machine)

### macOS

1. Build (unsigned by default — that's fine for local install):
   `COREPACK_ENABLE_STRICT=0 corepack pnpm@11.10.0 run dist:desktop:dmg:arm64`
   (`:x64` on Intel). Output: `release/T3-Code-<ver>-<arch>.dmg`.
2. Install — replace the canonical app only, leave any `*.backup.app` copies:
   ```
   hdiutil attach -nobrowse release/T3-Code-<ver>-<arch>.dmg
   ditto "/Volumes/<volume>/T3 Code (Alpha).app" "/Applications/T3 Code (Alpha).app.new"
   rm -rf "/Applications/T3 Code (Alpha).app" && mv "/Applications/T3 Code (Alpha).app.new" "/Applications/T3 Code (Alpha).app"
   hdiutil detach "/Volumes/<volume>"
   ```
3. Restart the app: the frontend holds no state — sessions live in the server
   service — so quitting and relaunching it is always safe (this agent session
   survives; it belongs to the service, not the app):
   ```
   osascript -e 'quit app "T3 Code (Alpha)"'; sleep 3; open -a "T3 Code (Alpha)"
   ```

### Linux

1. x64: `COREPACK_ENABLE_STRICT=0 corepack pnpm@11.10.0 run dist:desktop:linux`
   arm64: `COREPACK_ENABLE_STRICT=0 corepack pnpm@11.10.0 run dist:desktop:artifact --platform linux --target AppImage --arch arm64`
   Output: `release/T3-Code-<ver>-<arch>.AppImage`.
2. Install: `mkdir -p ~/Applications && install -m755 release/T3-Code-<ver>-<arch>.AppImage ~/Applications/T3-Code.AppImage`
   (overwrites the previous one). Relaunching the app is safe here too — state
   lives in the service — but there is no clean way to quit an Electron app
   from a shell without pattern-killing (forbidden), so tell the dev in the
   report to relaunch the frontend themselves.

The desktop build doubles as the post-merge compile check — do **not** run
repo-wide `vp check`/test suites on top of it (CI owns those).

## Phase 4 — Server service (the backend the app connects to)

1. Rebuild the server dist the service runs:
   `vp run --filter t3 build` → refreshes `apps/server/dist/bin.mjs`.
   (Rewriting dist while the old service runs is safe — it holds old code in
   memory until restarted.)
2. Find the service:
   - macOS: launchd job `com.lempire.t3code`
     (`~/Library/LaunchAgents/com.lempire.t3code.plist`, KeepAlive). Restart:
     `launchctl kickstart -k gui/$(id -u)/com.lempire.t3code`
   - Linux: same layout as macOS — a systemd service runs `dist/bin.mjs` from
     the checkout, with the AppImage as frontend. Find the unit once:
     `systemctl --user list-units '*t3*'` (fall back to system units), confirm
     via `ExecStart` that it points at this checkout's dist, then restart with
     `systemctl --user restart <unit>` (add `sudo` for a system unit). Verify
     with `systemctl --user status <unit>` showing a fresh main PID.
3. **Check whether this session runs under that service before restarting.**
   Walk the parent-PID chain (`ps -o ppid= -p $pid`, then `ps -o command=`);
   if an ancestor is `… dist/bin.mjs start`, the restart will kill this very
   agent session.
   - **Not under the service:** restart now, then verify it came back
     (`launchctl list | grep com.lempire.t3code` shows a fresh PID; tail
     `~/.t3/logs/fork-service.log`).
   - **Under the service (the usual case):** do NOT restart mid-run. Finish
     every remaining phase, write the final report, and make the _very last
     tool call_ a detached delayed restart so the report is delivered first:
     ```
     # macOS
     nohup bash -c 'sleep 20 && launchctl kickstart -k gui/'$(id -u)'/com.lempire.t3code' >/dev/null 2>&1 &
     # Linux (systemd-run detaches from this soon-to-die process tree)
     systemd-run --user --on-active=20s systemctl --user restart <unit>
     ```
     Tell the user in the report: the service restarts ~20 s after this
     message, this session and connected clients will drop briefly, and the
     desktop app reconnects on its own (it adopts the running server).
4. This restart is the sanctioned exception to "never start a server against
   `~/.t3/userdata`" — it IS the production service. Still never point a dev or
   test server at that home dir.

## Phase 5 — Push & report

1. Push the merge (and any runtimeVersion bump) to the fork:
   `git push origin main` — origin only, never upstream.
2. Final report must state:
   - upstream range merged (`PRE_MERGE..HEAD`, headline changes)
   - mobile: **OTA shipped** (runtimeVersion + verified manifest `createdAt`,
     "tap Version 5×" instruction) / **native build** (new runtimeVersion,
     install status) / **skipped** (why, and what to run where)
   - desktop: artifact path, installed location, relaunched
   - server service: rebuilt + restarted (fresh PID), or the scheduled delayed
     restart and what will briefly drop
   - anything skipped or needing the other machine
3. If the delayed service restart applies, fire it only after the report text
   is written — nothing may run after it.

## Failure modes quick reference

- **npm EINVALIDPACKAGENAME** on any `npx` in-repo: the root package.json's
  pnpm-style `>` override keys break npm. Use `corepack pnpm exec expo`, the
  npx shim (OTA path), or the global plugin + `EAS_LOCAL_BUILD_PLUGIN_PATH`
  (EAS path).
- **Plain `pnpm` "Failed to switch pnpm to v11.10.0 … ENOENT"**: corrupt
  self-managed toolchain stub at `~/Library/pnpm/.tools/pnpm/11.10.0/`. Fix:
  write `{"dependencies":{"pnpm":"11.10.0"}}` to its package.json,
  `npm install --no-save` there, copy `bin/pnpm` shim from a working sibling
  version dir. Required before EAS builds (its install phase spawns plain pnpm).
- **CocoaPods crash** "Unicode Normalization not appropriate for ASCII-8BIT":
  shell locale is `C` — export `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8` for any
  prebuild/pod/xcodebuild step.
- **iOS simulator builds** (dev only, not this skill's device build) must be
  arm64-only: the vendored GhosttyKit.xcframework has no x86_64 slice.
