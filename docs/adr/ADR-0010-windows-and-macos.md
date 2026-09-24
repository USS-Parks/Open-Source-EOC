# ADR-0010: Windows and macOS are the deployment platforms

Status: accepted, 2026-09-24

Supersedes the deployment decision of [ADR-0007](./ADR-0007-deploy-targets.md)
and the deployment paths recorded in
[ADR-0004](./ADR-0004-plugin-sandbox.md). ADR-0004's extension model stands.

## Decision

Open Source EOC is installed and run on Windows and macOS machines, in two
ways:

- **Workstation:** one computer runs the database, the server and the web
  application for one operator.
- **Host:** one Windows or Mac computer runs the shared system as a background
  service, and every other person and agency connects to it over HTTPS from a
  browser or the installed application, on the local network or a VPN, with
  no internet needed.

There is no Linux or Docker deployment. The Docker Compose path, `install.sh`,
`upgrade.sh`, `backup.sh`, `restore.sh` and `schedule-backup.sh` are removed.
Git history keeps them.

## Grounds

Basho, 2026-09-24: "This will be run on Windows and Mac OS machines. Make sure
that is the case. I do not want a Linux docker build, and NEVER specified that
as a preference." The Docker path came from the original roster's deployment
prompt of 2026-09-17, written by a planning session, not from any
requirement of the project's owner. It had never run on a Linux host.

The stack already runs on Windows without containers: the setup bundles Node,
PostgreSQL with PostGIS and the web application, and every test run of the
project has used that PostgreSQL on Windows. Node and PostgreSQL with PostGIS
run natively on macOS the same way.

## Consequences

- The Windows workstation is built. The Windows host, and the macOS
  workstation and host, are scheduled in
  [the readiness plan](../process/READINESS-PSPR-2026-09-24.md).
- HTTPS on a host uses Caddy (Apache-2.0), which runs natively on Windows and
  macOS, with the host's own certificate authority or an agency certificate.
- Continuous integration moves from Linux runners to Windows and macOS
  runners, so the product is tested where it runs.
- Version 1.0 remains single-node: one API process per database.
