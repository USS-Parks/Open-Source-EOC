#!/bin/bash
# Open Source EOC for macOS: the North Coast Storm demo. The first open sets
# the demo up (about two minutes), then each open starts it and opens its
# window. Other actions from Terminal: "stop" and "status", for example
#   "/Applications/Open Source EOC.app/Contents/MacOS/Open Source EOC" stop
set -u
app="$(cd "$(dirname "$0")/../Resources/app" && pwd)"
data="$HOME/Library/Application Support/Open Source EOC"
logs="$HOME/Library/Logs/Open Source EOC"
mkdir -p "$data" "$logs"
case "$(uname -m)" in
  arm64) node="$app/runtime/node-arm64/bin/node" ;;
  *) node="$app/runtime/node-x64/bin/node" ;;
esac
export OPENEOC_DESKTOP_APP_ROOT="$app"
export OPENEOC_DESKTOP_PREBUILT=1
export OPENEOC_DESKTOP_DATA_ROOT="$data"
export OPENEOC_DESKTOP_DIST_ROOT="$app/web/dist"
export OPENEOC_DESKTOP_PUBLIC_ROOT="$app/web/public"
export OPENEOC_PG_DIST="$app/runtime/pgsql"
cd "$app" || exit 1

action="${1:-launch}"
shift || true
if [ "$action" = launch ] && [ ! -f "$data/profiles/demo/profile.json" ]; then
  osascript -e 'display notification "Setting up the North Coast Storm demo. The first time takes about two minutes." with title "Open Source EOC"' >/dev/null 2>&1 || true
fi
if ! "$node" deploy/windows/desktop.mjs "$action" --profile=demo "$@" >>"$logs/launcher.log" 2>&1; then
  osascript -e 'display alert "Open Source EOC did not start" message "The log is in Library/Logs/Open Source EOC/launcher.log in your home folder."' >/dev/null 2>&1 || true
  tail -n 40 "$logs/launcher.log" >&2
  exit 1
fi
