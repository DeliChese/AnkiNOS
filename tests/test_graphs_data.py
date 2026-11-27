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

    def test_scope_metrics_are_available_for_both_scopes(self):
        for scope in ("deck", "collection"):
            metrics = mod.collect_native_graphs(self.col, scope, 365)["metrics"]
            self.assertIsNotNone(metrics)
            self.assertEqual(metrics["days"], {})
            self.assertEqual(metrics["previous"], {"reviews": 0, "milliseconds": 0})
            self.assertRegex(metrics["today"], r"^\d{4}-\d{2}-\d{2}$")

    def test_scope_and_period_are_strictly_validated(self):
        for search in ('deck:current AND is:suspended', '../../', None):
            with self.assertRaises(ValueError):
                mod.collect_native_graphs(self.col, search, 365)
        for days in (True, -1, 366, "365", 200000):
            with self.assertRaises(ValueError):
                mod.collect_native_graphs(self.col, "deck", days)

    def test_deck_list_and_custom_card_search_filter(self):
        did_zh = self.col.decks.id("Tiếng Trung::1000 từ")
        did_en = self.col.decks.id("Tiếng Anh")
        n1 = self.col.new_note(self.col.models.current())
        n1.fields[0], n1.fields[1] = "你好", "Xin chào"
        n1.add_tag("hsk1")
        self.col.add_note(n1, did_zh)
        n2 = self.col.new_note(self.col.models.current())
        n2.fields[0], n2.fields[1] = "Hello", "Xin chào"
        self.col.add_note(n2, did_en)

        by_deck = mod.collect_native_graphs(self.col, "deck", 365, deck_id=did_zh)
        self.assertEqual(by_deck["deck_id"], str(did_zh))
        self.assertEqual(by_deck["deck_name"], "Tiếng Trung::1000 từ")
        self.assertGreaterEqual(len(by_deck["decks"]), 3)
        self.assertIsInstance(by_deck["calendar_days"], dict)
        self.assertEqual(by_deck["data"]["card_counts"]["excluding_inactive"]["newCards"], 1)

        by_tag = mod.collect_native_graphs(self.col, "collection", 365, search="tag:hsk1")
        self.assertEqual(by_tag["search"], "tag:hsk1")
        self.assertEqual(by_tag["data"]["card_counts"]["excluding_inactive"]["newCards"], 1)

        with self.assertRaises(ValueError):
            mod.collect_native_graphs(self.col, "deck", 365, search="a" * 1001)
        with self.assertRaises(ValueError):
            mod.collect_native_graphs(self.col, "deck", 365, deck_id=99999999)


if __name__ == "__main__":
    unittest.main()
