#!/usr/bin/env python3
"""Focused tests for the H14 exact-identity lookup contract."""

import importlib.util
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("build-overture-enrichment.py")
SPEC = importlib.util.spec_from_file_location("h14_enrichment", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class EnrichmentContractTest(unittest.TestCase):
    def test_accepts_only_versioned_osm_way_identity(self) -> None:
        self.assertEqual(MODULE.parse_osm_way_id("w22942679@7"), 22942679)
        self.assertIsNone(MODULE.parse_osm_way_id("r22942679@7"))
        self.assertIsNone(MODULE.parse_osm_way_id("w22942679"))
        self.assertIsNone(MODULE.parse_osm_way_id(None))

    def test_conservative_subtype_crosswalk(self) -> None:
        self.assertEqual(MODULE.use_for_subtype("commercial"), "commercial")
        self.assertEqual(MODULE.use_for_subtype("medical"), "civic")
        self.assertEqual(MODULE.use_for_subtype("education"), "civic")
        self.assertEqual(MODULE.use_for_subtype("transportation"), "industrial")
        self.assertIsNone(MODULE.use_for_subtype("entertainment"))
        self.assertIsNone(MODULE.use_for_subtype("unmapped"))
        self.assertIsNone(MODULE.use_for_subtype(None))


if __name__ == "__main__":
    unittest.main()
