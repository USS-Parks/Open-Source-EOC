#!/usr/bin/env bash
# Open the built disk image as a person would: copy the app into
# Applications, open the demo without a browser window, check that it serves
# the console and answers ready, then stop it.
#
#   deploy/macos/smoke.sh <directory holding the .dmg>
set -euo pipefail
dir="${1:?give the directory holding the disk image}"
dmg="$(ls "$dir"/Open-Source-EOC-*-macOS.dmg | head -1)"
mount="$(mktemp -d)"
hdiutil attach -nobrowse -readonly -mountpoint "$mount" "$dmg" >/dev/null
ditto "$mount/Open Source EOC.app" "/Applications/Open Source EOC.app"
hdiutil detach "$mount" >/dev/null
launcher="/Applications/Open Source EOC.app/Contents/MacOS/Open Source EOC"
log="$HOME/Library/Logs/Open Source EOC/launcher.log"
data="$HOME/Library/Application Support/Open Source EOC"

# A map data packet in Downloads, as a person leaves the download beside the
# disk image: stand-ins built from the maps in git, packed as the real one is.
stand="$(mktemp -d)"
mkdir -p "$stand/basemap" "$HOME/Downloads"
for name in california buildings overlays north-coast-imagery north-coast-terrain; do
  cp web/public/basemap/basemap.pmtiles "$stand/basemap/$name.pmtiles"
done
cp web/public/basemap/buildings-overture.json "$stand/basemap/"
printf '{"layers":[]}\n' > "$stand/basemap/overlays-manifest.json"
printf '#openeoc-gazetteer\t1\t2026-09-25T00:00:00.000Z\nplace\tAlbion\tvillage\t\t-123.76863\t39.22351\talbion\t\n' > "$stand/gazetteer.tsv"
node tools/basemap/pack-map-data.mjs --basemap="$stand/basemap" --gazetteer="$stand/gazetteer.tsv" --out="$HOME/Downloads"

"$launcher" launch --no-browser || { cat "$log"; exit 1; }
curl -fsS http://127.0.0.1:8081/api/v1/ready
echo
curl -fsS http://127.0.0.1:8081/ | grep -qi "<html" || { echo "the console page did not load"; exit 1; }
# The packet was found, checked and installed, and its maps and index are in use.
test -f "$data/map-data/map-data.json" || { echo "the map data packet was not installed"; cat "$log"; exit 1; }
curl -fsS http://127.0.0.1:8081/runtime-config.js | grep -q "OPENEOC_BASEMAP_PMTILES_URL" || { echo "the installed maps are not offered"; exit 1; }
cmp <(curl -fsS http://127.0.0.1:8081/basemap/north-coast-terrain.pmtiles) web/public/basemap/basemap.pmtiles || { echo "an installed map is not served"; exit 1; }
test "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8081/gazetteer.tsv)" != 200 || { echo "the address index is served"; exit 1; }
grep -q "offline address search loaded" "$data/profiles/demo/logs/server.log" || { echo "the installed address index was not loaded"; exit 1; }
"$launcher" status
"$launcher" stop
tail -n 20 "$log"
echo "SMOKE_PASSED"
