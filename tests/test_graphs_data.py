"""Check AnkiNOS native statistics adapter against a real disposable collection.

CI installs the official anki Python package (no Qt/aqt required).
"""
from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path

from anki.collection import Collection
from anki.lang import set_lang

set_lang("en_US")
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("nos_graphs_data", ROOT / "graphs_data.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class NativeGraphsTests(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory()
        self.col = Collection(str(Path(self.scratch.name) / "collection.anki2"))

    def tearDown(self):
        self.col.close()
        self.scratch.cleanup()

    def test_all_native_graph_sections_are_available(self):
        deck = mod.collect_native_graphs(self.col, "deck", 365)
        self.assertEqual(deck["scope"], "deck")
        self.assertEqual(deck["days"], 365)
        self.assertIn("today", deck["data"])
        self.assertIn("future_due", deck["data"])
        self.assertIn("card_counts", deck["data"])
        self.assertIn("reviews", deck["data"])
        self.assertIn("true_retention", deck["data"])

    def test_collection_and_all_history_are_supported(self):
        out = mod.collect_native_graphs(self.col, "collection", 0)
        self.assertEqual(out["scope"], "collection")
        self.assertEqual(out["days"], 0)
        self.assertIn("today", out["data"])

    def test_scope_and_period_are_strictly_validated(self):
        for search in ('deck:current AND is:suspended', '../../', None):
            with self.assertRaises(ValueError):
                mod.collect_native_graphs(self.col, search, 365)
        for days in (True, -1, 366, "365", 200000):
            with self.assertRaises(ValueError):
                mod.collect_native_graphs(self.col, "deck", days)


if __name__ == "__main__":
    unittest.main()
