# Air gap: connections the system makes

Run 2026-09-25T14:49:44.656Z, from commit `2145fe1` with uncommitted changes, on Windows 10.0.26200. Written by `deploy/windows/prove-airgap.mjs`; the raw records are in `deploy/test-runtime/out/rd5-airgap/`.
Result: **PASS**, no connection outside this computer and its local network, and 0 page errors.

## What ran

The network host profile with the North Coast Storm demo (`host-demo`), in phases:

1. **Set up and first start:** the step the setup program runs after copying files (`desktop.mjs setup`), which creates a PostgreSQL cluster, migrates it and seeds the scenario; then PostgreSQL from the host settings file, the server with its delivery queue and scheduler, and Caddy with the host's own certificate authority, each started as its generated service definition says, on the loopback address with spare ports.
2. **Idle:** ten seconds with nobody signed in, while the scheduler and delivery queue run.
3. **North Coast walk:** Chromium over HTTPS, trusting the host's authority by its keys: Jordan Lee signs in and opens every section in the rail (14: Overview, Map, ESFs & Lifelines, SITREP, Boards, Resources, Tasks, Field Reports, Operational Periods, IAP, Participants, Messages, Settings, Help), zooms the map in and out, opens the notifications panel and the account menu.
4. **Backup:** the scheduled backup task's command against the running host.

Installing with the setup program was not part of the run: its file copy has no network step, and the services, firewall rule and trusted root it adds change this computer's settings, which a session does not do. Basho's unplugged run covers the installed system.

## The recorders

- **Node processes** (the setup step, the server, the backup): every TCP and TLS connection, name lookup and UDP datagram they asked for, recorded inside each process through `lib/net-recorder.mjs`. 19 records from 2 processes.
- **Connection sampler:** twice a second, the TCP connections of every process descended from the proof (the Node processes, Caddy, Chromium) and of the PostgreSQL server and its backends. 55 samples, up to 34 processes at once.
- **Chromium's network log:** every request the browser made, with who started it. A request a page started names the page's origin, and every one is counted. The browser's own services (updates, autofill, account sign-in) start theirs with no origin; they belong to the browser, not to this system, an agency's own browser policy governs them, and they are listed apart below. The flags that switch those services off were set and do not stop them all.
- **The page:** every request the console made.

Limits: without administrator rights a session cannot trace UDP destinations of processes other than Node, or attribute lookups the Windows DNS client makes on a process's behalf. PostgreSQL and Caddy are configured with only loopback and local names, and Node's lookups are recorded in-process.

## Destinations

| Recorder | Destination | Count |
|---|---|---|
| Node | tcp 127.0.0.1:55624 | 15 |
| Node | name 127.0.0.1 | 4 |
| Sampler, createdb.exe | 127.0.0.1:55624 (set up and first start) | 1 |
| Sampler, postgres.exe | 127.0.0.1:65333 (set up and first start) | 1 |
| Sampler, node.exe | 127.0.0.1:55624 (set up and first start, idle, North Coast walk, backup) | 311 |
| Sampler, postgres.exe | 127.0.0.1:62642 (set up and first start) | 9 |
| Sampler, postgres.exe | 127.0.0.1:62643 (set up and first start) | 5 |
| Sampler, postgres.exe | 127.0.0.1:58261 (set up and first start, idle, North Coast walk, backup) | 33 |
| Sampler, caddy.exe | 127.0.0.1:55625 (idle, North Coast walk, backup) | 332 |
| Sampler, node.exe | 127.0.0.1:55626 (idle) | 5 |
| Sampler, node.exe | 127.0.0.1:55625 (idle) | 5 |
| Sampler, caddy.exe | 127.0.0.1:58745 (idle) | 5 |
| Sampler, node.exe | 127.0.0.1:58746 (idle, North Coast walk, backup) | 29 |
| Sampler, node.exe | 127.0.0.1:58743 (idle) | 5 |
| Sampler, postgres.exe | 127.0.0.1:58738 (idle, North Coast walk, backup) | 29 |
| Sampler, postgres.exe | 127.0.0.1:58736 (idle, North Coast walk, backup) | 29 |
| Sampler, postgres.exe | 127.0.0.1:58740 (idle, North Coast walk, backup) | 29 |
| Sampler, postgres.exe | 127.0.0.1:58742 (idle, North Coast walk, backup) | 29 |
| Sampler, postgres.exe | 127.0.0.1:58741 (idle, North Coast walk, backup) | 29 |
| Sampler, postgres.exe | 127.0.0.1:58739 (idle, North Coast walk, backup) | 29 |
| Sampler, chrome.exe | 2607:f8b0:4005:808::2003:443 (North Coast walk) | 15 |
| Sampler, chrome.exe | 2001:4860:4829:7700:::443 (North Coast walk) | 15 |
| Sampler, chrome.exe | 2001:4860:482d:7700:::443 (North Coast walk) | 15 |
| Sampler, chrome.exe | 2001:4860:4846:400:::443 (North Coast walk) | 15 |
| Sampler, chrome.exe | 2607:f8b0:4005:80b::200e:443 (North Coast walk) | 15 |
| Sampler, chrome.exe | 2607:f8b0:4023:1c07::54:443 (North Coast walk) | 15 |
| Sampler, chrome.exe | 2600:1900:4110:86f:::80 (North Coast walk) | 15 |
| Sampler, chrome.exe | 127.0.0.1:55626 (North Coast walk) | 30 |
| Sampler, caddy.exe | 127.0.0.1:62096 (North Coast walk) | 15 |
| Sampler, caddy.exe | 127.0.0.1:62109 (North Coast walk) | 15 |
| Sampler, node.exe | 127.0.0.1:54738 (North Coast walk, backup) | 18 |
| Sampler, node.exe | 127.0.0.1:54748 (North Coast walk, backup) | 18 |
| Sampler, node.exe | 127.0.0.1:54740 (North Coast walk, backup) | 18 |
| Sampler, node.exe | 127.0.0.1:54750 (North Coast walk, backup) | 18 |
| Sampler, node.exe | 127.0.0.1:54741 (North Coast walk, backup) | 18 |
| Sampler, node.exe | 127.0.0.1:54751 (North Coast walk, backup) | 18 |
| Sampler, node.exe | 127.0.0.1:54745 (North Coast walk, backup) | 18 |
| Sampler, node.exe | 127.0.0.1:54742 (North Coast walk, backup) | 18 |
| Sampler, node.exe | 127.0.0.1:54746 (North Coast walk, backup) | 18 |
| Sampler, node.exe | 127.0.0.1:54739 (North Coast walk, backup) | 18 |
| Sampler, node.exe | 127.0.0.1:54752 (North Coast walk, backup) | 18 |
| Sampler, node.exe | 127.0.0.1:54744 (North Coast walk, backup) | 18 |
| Sampler, node.exe | 127.0.0.1:62110 (North Coast walk) | 15 |
| Sampler, node.exe | 127.0.0.1:54737 (North Coast walk, backup) | 18 |
| Sampler, node.exe | 127.0.0.1:54749 (North Coast walk, backup) | 18 |
| Sampler, node.exe | 127.0.0.1:54747 (North Coast walk, backup) | 18 |
| Sampler, node.exe | 127.0.0.1:54743 (North Coast walk, backup) | 18 |
| Sampler, postgres.exe | 127.0.0.1:62114 (North Coast walk, backup) | 18 |
| Sampler, postgres.exe | 127.0.0.1:62112 (North Coast walk, backup) | 18 |
| Sampler, postgres.exe | 127.0.0.1:62111 (North Coast walk, backup) | 18 |
| Sampler, postgres.exe | 127.0.0.1:62115 (North Coast walk, backup) | 18 |
| Sampler, postgres.exe | 127.0.0.1:62113 (North Coast walk, backup) | 18 |
| Sampler, chrome.exe | 2607:f8b0:4023:c03::bc:5228 (North Coast walk) | 10 |
| Sampler, chrome.exe | 142.251.219.174:443 (North Coast walk) | 10 |
| Chromium log, a page's request | localhost | 483 |
| Page | localhost:55626 | 612 |

## Outside addresses written in the code

None is contacted in the run above. Each is text: documentation and attribution links a person may follow, schema and namespace identifiers, example values in help text, error messages from bundled libraries, and addresses of optional integrations and catalog sources an administrator must configure and switch on (IPAWS, feeds, catalog data sources, federation peers). With none configured, as here, none is contacted; on an air-gapped network any that is configured fails without affecting the rest.

| Host | Where |
|---|---|
| cwwp2.dot.ca.gov | deploy/windows/out/build/app-dist/assets/src-DdPwqlJp.js, shared/src/data-packs/catalog.ts |
| emilms.fema.gov | deploy/windows/out/build/app-dist/assets/src-DdPwqlJp.js, shared/src/dictionary/lifelines.ts |
| eoc.example.org | server/src/notify/mass.ts |
| gis.data.ca.gov | deploy/windows/out/build/app-dist/assets/src-DdPwqlJp.js, shared/src/data-packs/catalog.ts |
| github.com | deploy/windows/out/build/app-dist/assets/CopMap-Dy75z5Q-.js, deploy/windows/out/build/app-dist/assets/field-submissions-BF1uxE1i.js, deploy/windows/out/build/app-dist/assets/maplibre-gl-DCuw7m-g.js, deploy/windows/out/build/app-dist/assets/maplibre-gl-worker-CNLXcz58.js |
| hifld-geoplatform.opendata.arcgis.com | deploy/windows/out/build/app-dist/assets/src-DdPwqlJp.js, shared/src/data-packs/catalog.ts |
| hooks.example.org | deploy/windows/out/build/app-dist/assets/AdminSurface-DSE13gVc.js, server/src/notify/allowlist.ts |
| humboldtgov.org | deploy/windows/out/build/app-dist/assets/src-DdPwqlJp.js, shared/src/data-packs/catalog.ts |
| incidents.fire.ca.gov | deploy/windows/out/build/app-dist/assets/src-DdPwqlJp.js, shared/src/data-packs/catalog.ts |
| json-schema.org | deploy/windows/out/build/app-dist/assets/src-DdPwqlJp.js |
| maplibre.org | deploy/windows/out/build/app-dist/assets/maplibre-gl-DCuw7m-g.js |
| react.dev | deploy/windows/out/build/app-dist/assets/index-Dl-TJHnb.js, deploy/windows/out/build/app-dist/assets/react-dom-CLGruyau.js |
| schemas.openxmlformats.org | server/src/boards/transfer.ts |
| schemas.xmlsoap.org | server/src/ipaws/connector.ts |
| wiki.openstreetmap.org | deploy/windows/out/build/app-dist/assets/maplibre-gl-DCuw7m-g.js |
| www.caloes.ca.gov | shared/src/dictionary/esf.ts |
| www.census.gov | deploy/windows/out/build/app-dist/assets/src-DdPwqlJp.js, shared/src/data-packs/catalog.ts |
| www.integratedpublicalertsystem.gov | server/src/ipaws/connector.ts |
| www.opengis.net | server/src/geo/routes.ts |
| www.w3.org | deploy/windows/out/build/app-dist/assets/CopMap-Dy75z5Q-.js, deploy/windows/out/build/app-dist/assets/Icon-Bwhac1rG.js, deploy/windows/out/build/app-dist/assets/MapSurface-B80K4oHp.css, deploy/windows/out/build/app-dist/assets/index-Dl-TJHnb.js, and 1 more |

## The browser's own requests

Chromium reached these for its own services while it ran, in requests no page started. They are not the system's connections and are not counted above.

- clients2.google.com (1 request)
- www.gstatic.com (1 request)
- update.googleapis.com (3 requests)
- accounts.google.com (1 request)
- www.google.com (2 requests)
- edgedl.me.gvt1.com (1 request)
- content-autofill.googleapis.com (11 requests)
- android.clients.google.com (4 requests)
- socket 2607:f8b0:4005:808::2003:443 (North Coast walk)
- socket 2001:4860:4829:7700:::443 (North Coast walk)
- socket 2001:4860:482d:7700:::443 (North Coast walk)
- socket 2001:4860:4846:400:::443 (North Coast walk)
- socket 2607:f8b0:4005:80b::200e:443 (North Coast walk)
- socket 2607:f8b0:4023:1c07::54:443 (North Coast walk)
- socket 2600:1900:4110:86f:::80 (North Coast walk)
- socket 2607:f8b0:4023:c03::bc:5228 (North Coast walk)
- socket 142.251.219.174:443 (North Coast walk)

## Outside connections

None.
