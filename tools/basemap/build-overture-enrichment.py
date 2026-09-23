#!/usr/bin/env python3
"""Build an exact OSM-way lookup from a local Overture buildings GeoParquet in the offline toolchain."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
from collections import Counter
from pathlib import Path
from typing import Final


RELEASE: Final = "2026-08-19.0"
OSM_WAY_ID: Final = re.compile(r"^w([0-9]+)@[0-9]+$")
SUBTYPE_USE: Final = {
    "commercial": "commercial",
    "civic": "civic",
    "medical": "civic",
    "education": "civic",
    "religious": "religious",
    "residential": "residential",
    # The existing COP bucket includes OSM building=transportation.
    "transportation": "industrial",
}


def parse_osm_way_id(record_id: str | None) -> int | None:
    match = OSM_WAY_ID.fullmatch(record_id or "")
    return int(match.group(1)) if match else None


def use_for_subtype(subtype: str | None) -> str | None:
    return SUBTYPE_USE.get(subtype or "")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sql_case() -> str:
    clauses = " ".join(
        f"WHEN '{subtype}' THEN '{use}'" for subtype, use in SUBTYPE_USE.items()
    )
    return f"CASE b.subtype {clauses} END"


def build_lookup(args: argparse.Namespace) -> dict[str, object]:
    import duckdb

    source = args.source.resolve()
    state = args.state.resolve()
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    temp = output.parent / "duckdb-temp"
    temp.mkdir(exist_ok=True)

    connection = duckdb.connect(
        config={"extension_directory": str(args.extensions.resolve())}
    )
    connection.execute("SET threads=2")
    connection.execute("SET preserve_insertion_order=false")
    connection.execute("SET memory_limit='2GB'")
    connection.execute(f"SET temp_directory='{temp.as_posix().replace(chr(39), chr(39) * 2)}'")
    connection.execute("SET max_temp_directory_size='8GB'")
    connection.execute("LOAD spatial")

    supported = ", ".join(f"'{value}'" for value in SUBTYPE_USE)
    connection.execute(
        f"""
          CREATE TEMP TABLE filtered_buildings AS
          SELECT id, subtype, sources, geometry
          FROM read_parquet(?)
          WHERE class IS NULL AND subtype IN ({supported})
        """,
        [str(source)],
    )
    connection.execute(
        f"""
          CREATE TEMP TABLE candidates AS
          WITH state AS (SELECT ST_Union_Agg(geom) AS geom FROM ST_Read(?))
          SELECT
            CAST(regexp_extract(s.record_id, '^w([0-9]+)@[0-9]+$', 1) AS UBIGINT) AS osm_id,
            b.id AS overture_id,
            b.subtype,
            {sql_case()} AS use
          FROM filtered_buildings AS b
          CROSS JOIN UNNEST(b.sources) AS source_rows(s)
          CROSS JOIN state
          WHERE s.property = ''
            AND s.dataset = 'OpenStreetMap'
            AND s.license = 'ODbL-1.0'
            AND s.provider = 'osm'
            AND s.resource = 'planet'
            AND regexp_full_match(s.record_id, '^w[0-9]+@[0-9]+$')
            AND ST_Intersects(b.geometry, state.geom)
        """,
        [str(state)],
    )
    rows = connection.execute(
        """
          SELECT osm_id, use, subtype, overture_id
          FROM candidates
          WHERE osm_id IN (
            SELECT osm_id FROM candidates GROUP BY osm_id HAVING count(*) = 1
          )
          ORDER BY osm_id
        """
    ).fetchall()
    candidate_stats = connection.execute(
        "SELECT count(*), count(DISTINCT osm_id) FROM candidates"
    ).fetchone()

    pending = output.with_suffix(output.suffix + ".pending")
    with pending.open("w", newline="", encoding="utf-8") as destination:
        writer = csv.writer(destination, delimiter="\t", lineterminator="\n")
        writer.writerow(("osm_id", "use", "subtype", "overture_id"))
        writer.writerows(rows)
    pending.replace(output)

    by_use = Counter(row[1] for row in rows)
    by_subtype = Counter(row[2] for row in rows)
    manifest = {
        "format": "openeoc-overture-building-enrichment-v1",
        "release": RELEASE,
        "source": str(source),
        "source_bytes": source.stat().st_size,
        "source_sha256": sha256(source),
        "source_coverage": "California bounding envelope; lookup candidates clipped to ca_state.geojson",
        "state_boundary": str(state),
        "state_boundary_sha256": sha256(state),
        "identity_contract": "one exact root OpenStreetMap way record_id w<ID>@<version>; ambiguous IDs excluded",
        "classification_contract": "class must be null in Overture; current OSM building=yes is enforced during archive build",
        "transportation_bucket": "industrial (existing COP building=transportation bucket)",
        "candidate_rows": candidate_stats[0],
        "candidate_unique_osm_ids": candidate_stats[1],
        "excluded_ambiguous_candidate_rows": candidate_stats[0] - len(rows),
        "lookup_rows": len(rows),
        "lookup_sha256": sha256(output),
        "by_use": dict(sorted(by_use.items())),
        "by_subtype": dict(sorted(by_subtype.items())),
    }
    manifest_path = output.with_name("lookup-manifest.json")
    pending_manifest = manifest_path.with_suffix(".json.pending")
    pending_manifest.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    pending_manifest.replace(manifest_path)
    connection.close()
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--extensions", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(build_lookup(args), indent=2))


if __name__ == "__main__":
    main()
