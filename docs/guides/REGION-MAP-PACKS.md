# Maps for another region

The Windows setup and the map data packet carry California: the statewide
street map, building footprints, road jurisdiction and public land overlays,
the critical facilities, tribal and jurisdiction boundary, and risk and
vulnerability layers, North Coast imagery and elevation, and the offline
address search index. An
EOC anywhere else builds a **region map packet** for its own area on a
computer with the internet, carries it to the EOC on a USB drive or other
media, checks it, and installs it. After that the EOC works in that area with
no internet: the map opens over the area, shows its streets and buildings,
and address search finds its places.

## What a region packet holds

| File | Built by | Needed |
|---|---|---|
| Street map | `tools/basemap/generate-california.sh` | Yes |
| Building footprints | the same script | No |
| Address search index | `tools/basemap/build-gazetteer.mjs` | No, but search is unavailable without it |
| The area's bounds | you choose them | Yes |

The California overlays, critical facilities, boundaries and risk layers,
and the imagery and elevation built from USGS sources for the North Coast,
cover California only; a region packet leaves them out, and the map does not
offer them while it is installed. The low-detail map the app
carries for zoomed-out views covers California only, so outside California
the street map is what shows at every zoom.

Every file in a packet is named in its manifest, `map-data.json`, with its
size and SHA-256. The EOC refuses a packet if any file differs, and installs
a good one whole, so a bad copy leaves the maps already installed in place.

## 1. Build it on a computer with the internet

You need a Windows computer with Git Bash, or a Mac; Java 21 or later; Node;
about 10 GB of free disk and 4 GB of memory for a state; and a checkout of
this repository at the release the EOC runs.

1. Find the area's Geofabrik extract at `https://download.geofabrik.de`, and
   note its path: `us/montana`, `us/north-dakota`,
   `canada/british-columbia`. A county or reservation uses its state's
   extract; the bounds (step 4) decide where the map opens.
2. Build the street map and building footprints into a new, empty folder:

   ```
   OPENEOC_MAP_AREA=us/montana tools/basemap/generate-california.sh tools/basemap/out/montana
   ```

   The street map keeps the file name `california.pmtiles` whatever area it
   covers: that is the name a packet carries the street map under.
   `OPENEOC_SKIP_BUILDINGS=1` skips the building footprints.
3. Build the address search index into the same folder, adding a county's
   address points if you have them (tools/basemap/README.md, section 10):

   ```
   node tools/basemap/build-gazetteer.mjs tools/basemap/out/montana/california.pmtiles --out tools/basemap/out/montana/gazetteer.tsv
   ```

4. Choose the bounds: the west, south, east and north edges of the area in
   decimal degrees, with a margin. For a county, its extent from any map
   tool; for example `-116.1,44.3,-104,49.1` for all of Montana.
5. Pack it, naming the region in lowercase letters, numbers and hyphens:

   ```
   node tools/basemap/pack-map-data.mjs --basemap=tools/basemap/out/montana --region=montana --bounds=-116.1,44.3,-104,49.1
   ```

   It writes `deploy/Open-Source-EOC-<version>-map-data-montana.zip` and a
   `.sha256` file beside it, and prints `MAP_DATA_READY` with the SHA-256.
   It packs only the files in that folder, and refuses to run without
   `--basemap`, so the California files never go into a region packet.
6. **Write the SHA-256 down** where it does not travel with the media: on
   paper, in the result table below, or in a message to the EOC's
   administrator. The check in step 2 below compares against this record,
   not against the `.sha256` file on the same drive, which could be changed
   along with the packet.

## 2. Carry it in and install it

1. Copy the `.zip` (and its `.sha256`) to the media and take it to the EOC.
2. On the EOC computer, in PowerShell, check the file against the SHA-256
   you wrote down:

   ```
   (Get-FileHash -Algorithm SHA256 E:\Open-Source-EOC-0.9.2-map-data-montana.zip).Hash
   ```

   The two must match exactly (case does not matter). If they do not, do not
   install it: build or copy it again.
3. Install it. On a network host, in PowerShell run as administrator:

   ```
   & "C:\Program Files\Open Source EOC\app\deploy\windows\Open Source EOC.cmd" -Action InstallMapData -Profile host -From E:\Open-Source-EOC-0.9.2-map-data-montana.zip
   ```

   On a single computer, the same command without `-Profile host`, in the
   Windows account that uses Open Source EOC. It prints `MAP_DATA_INSTALLED`
   with the number of files. It checks every file against the manifest
   first; a file that does not match stops it with the file's name. Use the
   folder Open Source EOC was installed into if it is not
   `C:\Program Files\Open Source EOC`. On a Mac, see the READ-ME in the
   packet.
4. Restart Open Source EOC so it reads the new maps: on a network host,
   `Restart-Service OpenSourceEOC-Server` as administrator; on a single
   computer, run the same command with `-Action Stop` in place of
   `-Action InstallMapData` and its `-From`, then open Open Source EOC from
   the Start menu.
5. Open the map. It opens over the region's bounds, shows its streets, and
   the command bar's address search finds a street you know there.

To go back to the setup's California maps, install the California map data
packet the same way.

## Record the run

The carry-in has not been run on a real EOC host. Whoever runs it first
fills in this table and keeps it with the drill reports.

| Step | Result | Notes |
|---|---|---|
| Region and Geofabrik path | | |
| Bounds used | | |
| Build computer, and time to build | | |
| Packet file name and size | | |
| SHA-256 written down at the build | | |
| SHA-256 on the EOC computer matches | | |
| `MAP_DATA_INSTALLED` line | | |
| Map opens over the region | | |
| A street and an address found by search | | |
| Checked with the internet unplugged | | |
| Run by, and date | | |
