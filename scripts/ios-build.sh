#!/usr/bin/env bash
#
# Build the ScriptumIQ iPhone app on a Mac and run it: on the iOS Simulator (default) or on an
# iPhone plugged into the Mac. The iOS twin of scripts/android-build.ps1 — see docs/IOS_HANDOFF.md.
#
#   scripts/ios-build.sh                     # Simulator, Debug, against production
#   scripts/ios-build.sh --device            # the plugged-in iPhone, Release (runs without Metro)
#   scripts/ios-build.sh --api http://192.168.1.20:3000   # against a dev server on the LAN
#   IOS_UNIVERSAL_LINKS=1 scripts/ios-build.sh --device   # once the paid Apple account is set up
#
# `expo prebuild --clean` regenerates apps/mobile/ios/ from app.json + app.config.ts every time, as
# the Android script does for android/: nothing in ios/ is hand-edited or committed.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

DEVICE=0
API="https://app.scriptumiq.com"
CONFIG=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --device) DEVICE=1 ;;
    --api) API="$2"; shift ;;
    --release) CONFIG="Release" ;;
    --debug) CONFIG="Debug" ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done
# A phone should run without a Metro server on the Mac; the Simulator is quicker to iterate in Debug.
if [[ -z "$CONFIG" ]]; then
  if [[ $DEVICE -eq 1 ]]; then CONFIG="Release"; else CONFIG="Debug"; fi
fi

say() { printf '\n== %s\n' "$*"; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "missing: $1 — $2" >&2; exit 1; }; }

say "checking the toolchain"
need xcodebuild "install Xcode from the App Store, open it once, then: sudo xcode-select -s /Applications/Xcode.app"
need node "install Node 22 (brew install node@22, or nvm install 22)"
need pod "install CocoaPods: brew install cocoapods"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$NODE_MAJOR" == "22" ]] || echo "warning: Node $NODE_MAJOR found; the repo is built and tested on Node 22" >&2
if ! command -v pnpm >/dev/null 2>&1; then
  say "enabling pnpm through corepack (the version is pinned in package.json)"
  corepack enable
fi
xcodebuild -version | head -1

say "installing the workspace"
pnpm install --frozen-lockfile

say "regenerating ios/ (API $API, Universal Links ${IOS_UNIVERSAL_LINKS:-off})"
cd "$ROOT/apps/mobile"
export EXPO_PUBLIC_API_URL="$API"
npx expo prebuild --platform ios --clean

if [[ $DEVICE -eq 1 ]]; then
  say "building $CONFIG for the plugged-in iPhone"
  npx expo run:ios --device --configuration "$CONFIG"
else
  say "building $CONFIG for the Simulator"
  npx expo run:ios --configuration "$CONFIG"
fi
