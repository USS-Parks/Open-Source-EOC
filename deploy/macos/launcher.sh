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

notify() { osascript -e "display notification \"$1\" with title \"Open Source EOC\"" >/dev/null 2>&1 || true; }

action="${1:-launch}"
shift || true

# The maps and layers come as a separate download, the map data packet. On an
# open without it installed, the newest packet in Downloads or on the Desktop,
# as its .zip or as the folder Safari unpacks it into, is checked against its
# manifest and installed; without one the demo opens on the base map and says
# where the packet goes.
if [ "$action" = launch ] && [ ! -f "$data/map-data/map-data.json" ]; then
  packet="$(ls -td "$HOME/Downloads"/Open-Source-EOC-*-map-data "$HOME/Downloads"/Open-Source-EOC-*-map-data.zip \
    "$HOME/Desktop"/Open-Source-EOC-*-map-data "$HOME/Desktop"/Open-Source-EOC-*-map-data.zip 2>/dev/null | head -1)"
  if [ -n "$packet" ]; then
    notify "Installing the maps and layers from $(basename "$packet"). This takes a minute or two."
    if ! "$node" deploy/windows/desktop.mjs install-map-data --from="$packet" >>"$logs/launcher.log" 2>&1; then
      notify "The map data packet did not match its manifest and was not installed. Download it again."
    fi
  else
    notify "Maps and layers are not installed. Put the Open Source EOC map data download in Downloads and open the app again."
  fi
fi
if [ "$action" = launch ] && [ ! -f "$data/profiles/demo/profile.json" ]; then
  notify "Setting up the North Coast Storm demo. The first time takes about two minutes."
fi
if ! "$node" deploy/windows/desktop.mjs "$action" --profile=demo "$@" >>"$logs/launcher.log" 2>&1; then
  osascript -e 'display alert "Open Source EOC did not start" message "The log is in Library/Logs/Open Source EOC/launcher.log in your home folder."' >/dev/null 2>&1 || true
  tail -n 40 "$logs/launcher.log" >&2
  exit 1
fi
