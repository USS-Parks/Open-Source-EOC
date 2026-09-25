#!/usr/bin/env bash
# Build the North Coast Storm demo for macOS as "Open Source EOC.app" in a disk
# image. Runs on a Mac (a GitHub Actions macOS runner) from the repository
# root after `pnpm install`. The app carries Node for Apple silicon and Intel
# and PostgreSQL 16 with PostGIS from Postgres.app, each checked against its
# pinned checksum, and the same server, web build and public files as the
# Windows setup.
#
#   deploy/macos/build-app.sh <output directory>
set -euo pipefail

out="${1:?give the output directory}"
root="$(pwd)"
version="$(node -p 'require("./package.json").version')"
node_version="v24.15.0"
node_arm64_sha256="372331b969779ab5d15b949884fc6eaf88d5afe87bde8ba881d6400b9100ffc4"
node_x64_sha256="ffd5ee293467927f3ee731a553eb88fd1f48cf74eebc2d74a6babe4af228673b"
pg_app_url="https://github.com/PostgresApp/PostgresApp/releases/download/v2.9.6/Postgres-2.9.6-16.dmg"
pg_app_sha256="2689dc64d6a02e0a66e4585616919060d8fbf5bb06886fccc05b7f87638bf081"
pg_prefix="/Applications/Postgres.app/Contents/Versions/16"

work="$(mktemp -d)"
app="$out/Open Source EOC.app"
res="$app/Contents/Resources/app"
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$res/runtime"

fetch() { # url file sha256
  curl -fsSL -o "$2" "$1"
  echo "$3  $2" | shasum -a 256 -c - >/dev/null || { echo "$1 does not match its pinned checksum" >&2; exit 1; }
}

echo "== web build"
node deploy/windows/desktop.mjs build

echo "== Node"
for arch in arm64 x64; do
  sha="node_${arch}_sha256"
  fetch "https://nodejs.org/dist/$node_version/node-$node_version-darwin-$arch.tar.gz" "$work/node-$arch.tar.gz" "${!sha}"
  tar -xzf "$work/node-$arch.tar.gz" -C "$work"
  mv "$work/node-$node_version-darwin-$arch" "$res/runtime/node-$arch"
done

echo "== PostgreSQL with PostGIS"
fetch "$pg_app_url" "$work/postgres.dmg" "$pg_app_sha256"
hdiutil attach -nobrowse -readonly -mountpoint "$work/pgmount" "$work/postgres.dmg" >/dev/null
ditto "$work/pgmount/Postgres.app/Contents/Versions/16" "$res/runtime/pgsql"
hdiutil detach "$work/pgmount" >/dev/null
ls "$res/runtime/pgsql" "$res/runtime/pgsql/share"

# Postgres.app expects its own place in /Applications. Any library path that
# names it is rewritten relative to the file that loads it, and each changed
# file is signed again (ad hoc), so the runtime works from inside the app.
pg="$res/runtime/pgsql"
# PL/Python loads the python.org framework from /Library, outside the app,
# and the product creates no extension but PostGIS, so it is left out.
find "$pg/lib/postgresql" "$pg/share/postgresql/extension" -name '*plpython*' -delete
# A universal binary's otool listing heads each architecture's libraries with
# a line naming the file, which ends in a colon; only the other lines are
# libraries.
deps() { otool -L "$1" | grep -v ':$' | awk '{print $1}'; }
relocated=0
while IFS= read -r -d '' file; do
  file -b "$file" | grep -q "Mach-O" || continue
  changed=0
  id="$(otool -D "$file" | sed -n 2p)"
  if [[ "$id" == "$pg_prefix"/* ]]; then
    install_name_tool -id "@loader_path/$(basename "$id")" "$file" 2>/dev/null
    changed=1
  fi
  while IFS= read -r dep; do
    [[ "$dep" == "$pg_prefix"/* ]] || continue
    target="$pg/${dep#"$pg_prefix"/}"
    rel="$(python3 -c 'import os,sys; print(os.path.relpath(sys.argv[1], sys.argv[2]))' "$target" "$(dirname "$file")")"
    install_name_tool -change "$dep" "@loader_path/$rel" "$file" 2>/dev/null
    changed=1
  done < <(deps "$file")
  if [ "$changed" = 1 ]; then
    codesign --force --sign - "$file" 2>/dev/null
    relocated=$((relocated + 1))
  fi
done < <(find "$pg" -type f -print0)
echo "relocated $relocated files"
# Each file is checked by its own path: file(1) lists a universal binary once
# per architecture, and the app's path has spaces in it. Only an absolute path
# can point outside the app: a relative one starts with @, and ICU's bare
# names match the ICU libraries already loaded from inside it. Static archives
# are never loaded.
left=""
while IFS= read -r -d '' f; do
  [[ "$f" == *.a ]] && continue
  file -b "$f" | grep -q "Mach-O" || continue
  outside="$(deps "$f" | grep '^/' | grep -v '^/usr/lib/\|^/System/' || true)"
  [ -z "$outside" ] || left+="$f: $outside"$'\n'
done < <(find "$pg" -type f -print0)
if [ -n "$left" ]; then echo "Library paths outside the app remain:"; printf '%s' "$left" | head -40; exit 1; fi

echo "== the app"
cp package.json LICENSE NOTICE "$res/"
cp deploy/windows/installer/THIRD-PARTY-NOTICES.txt "$res/"
mkdir -p "$res/deploy/windows"
cp deploy/windows/desktop.mjs deploy/windows/ts-loader.mjs "$res/deploy/windows/"
cp -R deploy/windows/lib "$res/deploy/windows/lib"
mkdir -p "$res/server"
cp server/package.json "$res/server/"
cp -R server/src "$res/server/src"
# Test sources carry synthetic fixture accounts; the app keeps only the demo's.
find "$res/server/src" -type d -name __tests__ -prune -exec rm -rf {} +
cp -R server/migrations "$res/server/migrations"
# pnpm writes the deploy's store path relative to the workspace and reads it
# back from server/, one folder deeper, so a target outside the repository
# lands at /Users/var. The Windows staging deploys inside the repository too.
resolved="$PWD/deploy/macos/out/resolved-server.$$"
rm -rf "$resolved"
pnpm --filter=@openeoc/server deploy --prod --legacy --node-linker=hoisted "$resolved"
cp -R "$resolved/node_modules" "$res/server/node_modules"
rm -rf "$resolved"
mkdir -p "$res/node_modules"
cp -RL node_modules/typescript "$res/node_modules/typescript"
mkdir -p "$res/web"
cp -R deploy/windows/out/build/app-dist "$res/web/dist"
mkdir -p "$res/web/public"
find web/public -maxdepth 1 -type f -exec cp {} "$res/web/public/" \;
for dir in fonts napsg icons basemap; do
  [ -d "web/public/$dir" ] && cp -R "web/public/$dir" "$res/web/public/$dir"
done
printf '{\n  "schema": 1,\n  "version": "%s",\n  "prebuilt": true\n}\n' "$version" > "$res/desktop-install.json"

cp deploy/macos/launcher.sh "$app/Contents/MacOS/Open Source EOC"
chmod 755 "$app/Contents/MacOS/Open Source EOC"
sed "s/@VERSION@/$version/g" deploy/macos/Info.plist > "$app/Contents/Info.plist"
codesign --force --sign - "$app"

echo "== disk image"
stage="$work/dmg"
mkdir -p "$stage"
ditto "$app" "$stage/Open Source EOC.app"
ln -s /Applications "$stage/Applications"
cp deploy/macos/READ-ME-FIRST.txt "$stage/"
dmg="$out/Open-Source-EOC-$version-macOS.dmg"
rm -f "$dmg"
hdiutil create -volname "Open Source EOC $version" -srcfolder "$stage" -ov -format UDZO "$dmg" >/dev/null
shasum -a 256 "$dmg" | cut -d' ' -f1 | tr -d '\n' > "$dmg.sha256"
echo "DMG_READY file=$dmg bytes=$(stat -f %z "$dmg") sha256=$(cat "$dmg.sha256")"
