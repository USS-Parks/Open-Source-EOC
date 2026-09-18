# Standards Interoperability Guide

Standards are native here, not a bolt-on export. The same data an operator works
with round-trips to the open standards other systems speak.

## CAP 1.2 (alerting)

Author a Common Alerting Protocol 1.2 alert in the app; it validates against
the base schema and the FEMA IPAWS Profile and serializes to CAP XML with full
fidelity. External CAP XML ingests the same way. IPAWS-OPEN transmission is
enable-at-will; see [../IPAWS-ENABLEMENT.md](../IPAWS-ENABLEMENT.md).

## EDXL-DE and EDXL-RM (resource messaging)

A 213RR resource request emits as an EDXL-DE envelope carrying EDXL-RM, and an
EDXL envelope imports onto the resource-request board. This is how requests
cross between systems that speak EDXL.

## EDXL-HAVE (facility status)

Facility status exports as EDXL-HAVE: organization, operating status, EMS
traffic, and bed capacity, so a hospital-status consumer reads it directly.

## Cursor-on-Target (CoT/TAK)

Any geospatial board record emits as a CoT event a TAK server consumes, and an
inbound CoT track lands as a live COP layer. The bridge runs in the shared
layer, so it also works offline in the field client.

## OGC API - Features and GeoJSON

Any board that carries geometry is served as an OGC API - Features collection
in GeoJSON, so a GIS client reads the live operating picture as standard
features.

## The frozen API contract

The public REST, WebSocket, and webhook surface is a versioned contract, and a
contract test holds the running server to it, so the documented API and the
deployed API cannot drift. See [../API.md](../API.md).
