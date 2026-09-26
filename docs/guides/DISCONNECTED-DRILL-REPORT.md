# Disconnected Drill Report

The record for [the disconnected drill](DISCONNECTED-DRILL.md): one copy per
run, filled in as the run goes. Write what was seen, including what failed
or needed a workaround; a blank means not checked.

Neither part has been run. The first runs are Basho Parks's; until they
happen, nothing here is a result. Part 1's record is the evidence that
rows AR7 and INV-3 of the [capability facet status](../FACET-STATUS.md)
wait on: the unplugged run with a second device, and the install from
media on a disconnected second computer.

## Part 1: the unplugged run

| Field | Entry |
|---|---|
| Date and place | |
| People | |
| Build: setup file and its SHA-256 | |
| Computer A: model, Windows edition and version | |
| Computer B: model, Windows edition and version | |
| Network: switch or router, and how the internet line was kept out | |

| Step | Result: PASS, FAIL or NOTE | Time | What was seen |
|---|---|---|---|
| 1. Computer B from media: the second-machine transfer check | | Setup to Finish: ; click to sign-in page: | |
| 2. Computer A disconnected, with a fixed address | | | |
| 3. Host installed from media; hash `True` | | Setup start to `HOST_ADDRESS` lines: | |
| 4. `HOST CHECK PASSED`; thumbprint | | | |
| 5. `AIR-GAP CHECK PASSED` | | | |
| 6. Signed in with two-step codes; incident activated | | | |
| 7. Screens walked; map point and field report record kept through a browser restart | | | |
| 8. Second device trusted the host, signed in, and saw live edits both ways | | | |
| 9. Second device reopened offline and signed in again on return | | | |
| 10. Host restarted unplugged; check passed again; records present | | | |
| 11. Backup copied to media and verified | | | |
| Phone walk, if done (recorded in the network host guide's table) | | | |

The host check's lines:

```text

```

The unplugged check's lines, at step 5 and again at step 10:

```text

```

**Part 1 verdict:** passed, or failed at step ___, with the exceptions:

## Part 2: the 72-hour drill

| Field | Entry |
|---|---|
| Hour 0 (date and clock time) and the end | |
| Players and their positions | |
| Controller and evaluator | |
| Host: build, and whether it held any real data | |
| Stand-ins used, with their versions | |
| Delivery windows: email, SMS, webhooks | |
| Federation partner, if any | |

### Baseline, before the cut

| Check | Result |
|---|---|
| Test email shown on the relay's page | |
| Test SMS logged by the text stand-in | |
| Webhook logged by its stand-in | |
| Feed current under **Feed readiness** | |
| Federation partner "Up to date" | |

### What waited, expired and caught up

One row per service. Times are hours from the cut.

| Service | Waited during the cut | Delivered when its route returned, and how long after | Expired, and when | Resent after expiry, and the result | Notes |
|---|---|---|---|---|---|
| Email | | | | | |
| SMS | | | | | |
| Webhook | | | | | |
| Feed | Failed polls counted on one notification: | Recovered at: | Last good item kept on the map: | | |
| Federation | Updates waiting at the peak: | "Up to date" again at: | | | |
| In-app notices | | | | | |

### Devices, restart and clock

| Check | Result |
|---|---|
| Field device offline: how long, what queued, what synced, any conflict | |
| Host restart at hour 30: services back, waiting messages kept | |
| Clock line, day 1 | |
| Clock line, day 2 | |
| Clock line, day 3 | |
| Backup copied to media and verified (day 3) | |
| Incident records carried to another instance on media | No path in this build |
| IPAWS | Not configured |

### Event log

| Clock time | Hour | What happened | Recorded by |
|---|---|---|---|
| | | | |

### Hotwash

| Field | Entry |
|---|---|
| Strengths | |
| Areas for improvement | |
| Corrective actions, each with an owner and a date | |

**Part 2 verdict:** what the EOC could and could not do for three days
without the internet, in the evaluator's words:
