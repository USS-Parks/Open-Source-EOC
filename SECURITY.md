# Security policy

OpenEOC holds For Official Use Only information for emergency operations
centers. If you find a vulnerability, report it privately so it can be fixed
before it is public.

## Supported versions

| Version | Security fixes |
|---|---|
| Latest `0.9.x` evaluation build | Yes, until 1.0 is released |
| Earlier builds | No |

No release has been tagged yet, so the latest evaluation build is the current
`main` branch. After 1.0, security fixes go to the latest minor release only;
see [Releases and support](GOVERNANCE.md#releases-and-support).

## How to report

Use GitHub private vulnerability reporting: on this repository's GitHub page,
open the **Security** tab and choose **Report a vulnerability**. The report
stays private between you and the maintainers.

That button appears only once private reporting is enabled in the repository
settings. Until it is, open a GitHub issue that asks for a private contact and
says nothing else: no description of the problem, no affected component, no
proof of concept. A maintainer will reply with a private channel.

Never put vulnerability details in a public issue, discussion, pull request or
commit.

## What to include

- The version, from `GET /api/v1/health` or [the changelog](CHANGELOG.md), and
  the deployment path: Docker, Windows desktop, or a source checkout.
- The affected part: the server, the web client, or the deploy scripts.
- Steps to reproduce, using synthetic data.
- The impact: what an attacker can read, change or stop, and what access they
  need first.
- Whether you know of it being exploited.
- Whether and how you want to be credited.

Use synthetic data only, and test only against an installation you run. Never
send real incident information, personal data or credentials from a live
deployment, and never probe a jurisdiction's live system.

## Scope

In scope:

- the server (`server/`) and the contracts it shares with the client
  (`shared/`);
- the web client (`web/`), including the offline field client;
- the deploy scripts and configuration in `deploy/`: the Docker install,
  upgrade, backup and restore scripts, the Windows desktop launcher and the
  installer build.

What matters most: a way around sign-in, two-step sign-in, roles, row-level
security or the boundary between jurisdictions; any read by someone with no
account or grant, since the product has no public facet; a change to or
deletion from the audit trail; an IPAWS send without a second administrator's
confirmation; a secret written to a log or a response.

Out of scope:

- third-party services and software, such as an SMTP relay, an SMS provider,
  IPAWS-OPEN, an identity provider, PostgreSQL, Caddy or a browser. Report
  those to their maintainers. A way that OpenEOC's own use of a dependency
  exposes a deployment is in scope.
- the synthetic credentials of the demo and acceptance profiles, such as
  `demo-admin@example.org`, published in
  [the demonstration scenario](docs/DEMO-SCENARIO.md) and
  [the Windows desktop guide](docs/WINDOWS-DESKTOP.md). They are public on
  purpose, and those profiles must never hold real data.

The controls the product claims are summarized in
[the security and continuity posture](docs/SECURITY-CONTINUITY.md) and
[the threat model](docs/THREAT-MODEL.md).

## What happens next

These are the goals of a volunteer project, not guarantees:

- acknowledgement of the report within 7 days;
- an assessment within 30 days: whether the report is accepted, how severe it
  is, and the plan to fix it;
- a fix developed in private and released with an advisory, coordinated with
  you.

## Disclosure

The default is coordinated disclosure 90 days after the report, or earlier if
a fix is released and you agree. If a fix needs longer, the maintainers will
say why and agree a new date with you. Advisories are published through
GitHub's security advisories for this repository and listed in
[the changelog](CHANGELOG.md), crediting the reporter unless you ask
otherwise.

## No bug bounty

The project pays no reward for reports.
