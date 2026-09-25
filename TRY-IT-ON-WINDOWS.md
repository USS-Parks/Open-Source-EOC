# Try Open Source EOC on Windows

The setup installs Open Source EOC for your Windows account and includes a
demonstration: the North Coast Storm exercise, the same scenario the three
reference dashboards show. Everything in the demonstration is synthetic, and
every screen says so beside the FOUO marking.

## Install

1. Run `deploy\windows\out\installer\Open-Source-EOC-Setup-0.9.0.exe` from
   this repository (or a copy of it; 1.6 GB, SHA-256 in the `.sha256` file
   beside it). It needs no administrator rights and no internet connection,
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

## What this build does not do yet

It serves one computer. Letting other machines and agencies connect to one
host, macOS, and the proofs for 150 users and for running disconnected are
the next units of [the readiness plan](docs/process/READINESS-PSPR-2026-09-24.md).
