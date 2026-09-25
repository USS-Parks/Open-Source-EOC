# Load test: 150 people on one incident

Run 2026-09-25T11:04:00.466Z for 120 minutes, from commit `5cbfc18` with uncommitted changes.
Result: **PASS**, every threshold below met.
Written by `deploy/windows/prove-load.mjs`; the minute-by-minute samples are in `LOAD-TEST-SAMPLES.jsonl`.

## What ran

- **Host:** the network host profile with the North Coast Storm demo (`host-demo`), started exactly as its generated service definitions say: PostgreSQL from the host settings file, the server with its delivery queue and scheduler, and Caddy serving HTTPS with the host's own certificate authority. It ran as this user on the loopback address with spare ports; installing the services and the firewall rule is the setup program's part and changes nothing measured here.
- **Machine:** AMD Ryzen 7 5800H with Radeon Graphics, 16 logical processors, 60 GB memory, Windows 11 (10.0.26200), Node v24.15.0.
- **Load generator:** on the same machine as the host, so it competes with the server for the processor and the result understates what a dedicated host does.
- **People:** 150 synthetic accounts added as members of Humboldt County OES, the incident's owning organization. Each signs in with its own password session and connects from its own loopback address (127.0.0.2 to 127.0.0.151), so the server's per-address flood and sign-in limits see 150 separate clients, as on a network. People arrive over the first three minutes.
- **What each person does, for the whole run:**
  - holds two live sockets through HTTPS: the incident's Field Reports board sync, and the notification stream (refetching the inbox when told something changed);
  - visits a screen about every 30 seconds (15 to 45), each visit firing that screen's reads together as the console does: the overview (summary, activity, lifelines, incident list, inbox) three times in eleven, the map (four board layers and the impact analysis) twice, Field Reports twice, Shelters, resource requests, threads and messages, and lifelines with the ESF grid once each;
  - edits their own field report's summary about every 30 seconds over REST, as the console does; the server folds the edit into the board's live document and every other person receives it on their socket;
  - one person in 10 is a field user whose queued offline edit syncs over the board socket about every 5 minutes (2.5 to 7.5), as the field client does, sending the whole document with an operation id;
  - makes another REST write about every 2 minutes (1 to 3): posting in the Road status thread, submitting a resource request, or moving one of their requests to its next stage;
  - renews the session every ten minutes, and, like the web client, renews and retries once when a request meets a refused access token.
- **Measured:** every request's time from send to full response at the client, reads and writes apart (sign-in, renewals and field sync acknowledgements count as writes); for each edit, the time from the sender's send to each other person's receipt on the live socket; the server's heap and resident memory from its metrics endpoint once a minute.

## Thresholds

| Measure | Threshold | Result | |
|---|---|---|---|
| Errors (failed requests, socket errors, dropped sockets) | 0 | 0 | pass |
| Reads, 95th percentile | under 1000 ms | 245 ms | pass |
| Writes, 95th percentile | under 2000 ms | 33 ms | pass |
| A live edit reaching the other people, 95th percentile | under 2000 ms | 32 ms | pass |
| Server heap growth after a 10-minute warm-up | under 10% | 8.4% | pass |
| Everyone signed in | 150 | 150 | pass |

## Volumes and other percentiles

| | Count | 50th | 95th | 99th | Longest |
|---|---|---|---|---|---|
| Reads | 123023 | 20 ms | 245 ms | 406 ms | 1224 ms |
| Writes | 46390 | 19 ms | 33 ms | 76 ms | 324 ms |
| Live edit deliveries | 5324817 | 18 ms | 32 ms | 94 ms | 337 ms |

Sign-ins 150, session renewals 1650 (0 requests sent with the access token a renewal had just replaced, renewed and retried once as the web client does), screen visits 35396, REST record edits 35432, field syncs acknowledged 352, thread messages 2923, resource requests submitted 2992 and moved on 2741 times, inbox refetches on a notification signal 5732.

Server memory after warm-up (median of the first and last fifth of the settled samples): heap 161 MB to 175 MB, resident 506 MB to 558 MB (10.4%).

## Every ten minutes

| Minute | Heap MB | Resident MB | Sockets | Reads | Read 95th | Writes | Write 95th | Live 95th | Errors | Generator delay 99th |
|---|---|---|---|---|---|---|---|---|---|---|
| 10 | 126 | 497 | 300 | 1033 | 127 ms | 368 | 40 ms | 42 ms | 0 | 22 ms |
| 20 | 172 | 504 | 300 | 978 | 170 ms | 370 | 38 ms | 36 ms | 0 | 22 ms |
| 30 | 163 | 532 | 300 | 1044 | 151 ms | 385 | 33 ms | 31 ms | 0 | 22 ms |
| 40 | 162 | 530 | 300 | 1007 | 191 ms | 362 | 30 ms | 30 ms | 0 | 21 ms |
| 50 | 191 | 539 | 300 | 1083 | 216 ms | 382 | 33 ms | 33 ms | 0 | 22 ms |
| 60 | 187 | 540 | 300 | 1078 | 266 ms | 389 | 31 ms | 30 ms | 0 | 22 ms |
| 70 | 165 | 547 | 300 | 997 | 271 ms | 373 | 32 ms | 31 ms | 0 | 22 ms |
| 80 | 214 | 554 | 300 | 1096 | 281 ms | 386 | 34 ms | 33 ms | 0 | 22 ms |
| 90 | 163 | 552 | 300 | 981 | 320 ms | 395 | 31 ms | 32 ms | 0 | 22 ms |
| 100 | 160 | 556 | 300 | 1065 | 353 ms | 362 | 30 ms | 30 ms | 0 | 22 ms |
| 110 | 155 | 554 | 300 | 1128 | 384 ms | 390 | 36 ms | 35 ms | 0 | 23 ms |
| 120 | 171 | 574 | 300 | 1021 | 399 ms | 367 | 32 ms | 31 ms | 0 | 22 ms |

## Errors

None.
