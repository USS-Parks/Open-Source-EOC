# Try Open Source EOC on Windows

The setup installs Open Source EOC for your Windows account and includes a
demonstration: the North Coast Storm exercise, the same scenario the three
reference dashboards show. Everything in the demonstration is synthetic, and
every screen says so beside the FOUO marking.

## Install

1. Run `deploy\Open-Source-EOC-Setup-0.9.1.exe` from this repository (or a
   copy of it; 1.6 GB, SHA-256 in the `.sha256` file beside it). The
   `0.9.0` setup beside it is the earlier build, kept to go back to. It needs no administrator rights and no internet connection,
   and installs to `%LOCALAPPDATA%\Programs\Open Source EOC`.
2. The setup is not code-signed yet. If Windows says it protected your PC,
   choose **More info**, then **Run anyway**.
3. Accept the defaults. Leave **Create a desktop shortcut for the North Coast
   Storm demo** ticked.
4. On the last page, leave **Open the North Coast Storm demo** ticked and
   choose **Finish**. The first start builds the demonstration database; it
   takes under a minute, then the sign-in page opens in an app window (Edge
   or Chrome).

## Sign in

| Who | Email | Password |
|---|---|---|
| Jordan Lee, Planning Section Chief, Humboldt County OES (administrator) | `jordan.lee@humboldt.example` | `north-coast-exercise` |
| A. Brooks, Utility liaison, CA Energy Commission (partner) | `a.brooks@cec.example` | `north-coast-exercise` |
| R. Martinez, Caltrans liaison (partner) | `r.martinez@caltrans.example` | `north-coast-exercise` |

The demonstration's accounts sign in with a password alone. A production
install keeps two-step sign-in for administrators.

After signing in as Jordan Lee, choose **Planning Section Chief** in the
position menu in the top bar, as the reference dashboards show it. Signing
into a position is an explicit act in ICS, so the application does not do it
for you.

## Four exercises, one sign-in

The demonstration holds four exercises, each on its own scenario clock. Jordan
Lee's sign-in reaches all of them: choose one from the incident menu in the
top bar.

| Exercise | Owned by | Guides |
|---|---|---|
| North Coast Storm | Humboldt County OES | This page |
| Deerhorn Lightning Complex | Hoopa Valley Tribe OES, with the Yurok Tribe in unified command | [Deerhorn exercise](docs/guides/training/deerhorn/EXERCISE-SITUATION-MANUAL.md) |
| Del Norte Atmospheric Rivers | Del Norte County OES | |
| Cascadia Earthquake and Tsunami | Humboldt County OES | |

Every exercise account uses the same password, `north-coast-exercise`. The
demonstration database is built on the first start, so one built by an older
setup has North Coast Storm only: install a setup that carries the exercises,
remove the data folder (below) and start the demo again.

## What to look at

- **Incident overview** (the first screen): the counts, the common operating
  picture, the Community Lifelines, priority work and recent activity. Switch
  to the dark theme from the account menu (top right) or **Light theme** at
  the foot of the rail to see the dark dashboard with aerial imagery.
- **ESFs & Lifelines**: open **Energy** to see the lifeline drawer, with its
  linked actions that open the county's requests.
- Every control on these screens works on the live system: open a count, a
  lifeline, a request or a map layer and follow it.
- The rail shows the dashboard's twelve sections. Turn on **Show every
  section** in **Settings** to list the rest: chronology, dashboards,
  staffing, forms, the JIC, contacts, datasets and more.

## Start, stop and remove

- Start it again from **Open Source EOC Demo** on the desktop or the Start
  menu.
- It runs on this computer only (`127.0.0.1`), with no network needed.
- Uninstall from Windows **Settings > Apps**. Your demonstration data stays in
  `%LOCALAPPDATA%\Open Source EOC` until you delete that folder yourself.

## Try it across several devices

To have other computers and phones on your network use the demonstration,
run the setup again and choose **Install for all users**, then tick **Host
for the network** and **With the North Coast Storm demonstration**. The
setup installs the host's services, shows the addresses the other devices
open, and checks itself. Each device trusts the host's certificate once,
from **Trust this server** on the sign-in page. The internet is not needed:
a Wi-Fi router with its internet line unplugged will do. The
[network host guide](docs/guides/NETWORK-HOST.md) has every step.

## What this build does not do yet

macOS, and the proofs for 150 users and for running disconnected, are the
next units of [the readiness plan](docs/process/READINESS-PSPR-2026-09-24.md).
