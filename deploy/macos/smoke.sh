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

"$launcher" launch --no-browser || { cat "$log"; exit 1; }
curl -fsS http://127.0.0.1:8081/api/v1/ready
echo
curl -fsS http://127.0.0.1:8081/ | grep -qi "<html" || { echo "the console page did not load"; exit 1; }
"$launcher" status
"$launcher" stop
tail -n 20 "$log"
echo "SMOKE_PASSED"
