"""Exercise insight boundaries and actions against disposable Anki collections."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from anki.collection import Collection
from anki.lang import set_lang

set_lang("en_US")
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("nos_study", ROOT / "study_data.py")
study = importlib.util.module_from_spec(spec)
spec.loader.exec_module(study)


class StudyTests(unittest.TestCase):
    def setUp(self):
        (ROOT / "tests/.tmp").mkdir(exist_ok=True)
        self.tmp = tempfile.TemporaryDirectory(dir=ROOT / "tests/.tmp")
        self.col = Collection(str(Path(self.tmp.name) / "collection.anki2"))
        self.sequence = 0

    def tearDown(self):
        study.clear_cache()
        self.col.close()
        self.tmp.cleanup()

    def card(self, name):
        did = self.col.decks.id(name)
        note = self.col.new_note(self.col.models.current())
        note.fields[0] = name
        self.col.add_note(note, did)
        return self.col.find_cards(f"nid:{note.id}")[0], did

    def logs(self, cid, amount, *, days=1, ease=3, kind=1, ms=20000):
        for _ in range(amount):
            self.sequence += 1
            rid = (self.col.sched.day_cutoff-days*86400)*1000 + self.sequence
            self.col.db.execute("INSERT INTO revlog VALUES (?,?,0,?,1,1,2500,?,?)", rid, cid, ease, ms, kind)

    def test_no_fabricated_estimates_or_retention(self):
        self.assertIsNone(study.collect_support(self.col)["timing"]["all"]["median_ms"])
        cid, _ = self.card("Small sample")
        self.logs(cid, 19)
        self.logs(cid, 30, kind=4)
        self.logs(cid, 30, kind=5)
        self.logs(cid, 30, ms=0)
        self.assertEqual(study.collect_support(self.col)["timing"]["all"]["samples"], 19)

    def test_parent_rollups_filtered_ownership_and_exact_actions(self):
        cid, did = self.card("Languages::English")
        other, _ = self.card("Other::English")
        self.logs(cid, 20, days=35)
        self.logs(cid, 12)
        self.logs(cid, 8, ease=1)
        self.logs(cid, 2, ease=1, kind=2)
        self.logs(other, 2, ease=1)
        filtered = self.col.decks.id("Filtered")
        self.col.db.execute("UPDATE cards SET odid=?,did=? WHERE id=?", did, filtered, cid)
        result = study.collect_support(self.col)
        parent = str(self.col.decks.id("Languages"))
        self.assertEqual(result["decks"][parent]["retention"], 60)
        self.assertEqual(result["decks"][parent]["change_points"], -40)
        self.assertEqual(result["decks"][parent]["repeated_lapses"], 1)
        self.assertEqual(study.insight_cards(self.col, int(parent), "repeated_lapses"), [cid])
        self.assertEqual(study.insight_cards(self.col, int(parent), "retention_drop"), [cid])
        self.assertEqual(result["timing"]["all"]["median_ms"], 20000)
        with self.assertRaises(ValueError):
            study.insight_cards(self.col, did, "arbitrary search")

    def test_manual_and_old_logs_do_not_create_an_insight(self):
        cid, did = self.card("Boundaries")
        self.logs(cid, 5, days=31, ease=1)
        self.logs(cid, 5, ease=1, kind=4)
        self.logs(cid, 5, ease=1, kind=5)
        self.assertEqual(study.insight_cards(self.col, did, "repeated_lapses"), [])
        self.assertEqual(study.collect_support(self.col)["decks"][str(did)]["repeated_lapses"], 0)

    def test_cache_invalidates_on_write_and_collection_change(self):
        cid, _ = self.card("Cache")
        one = study.collect_support(self.col)
        self.assertIs(one, study.collect_support(self.col))
        self.logs(cid, 25)
        two = study.collect_support(self.col)
        self.assertEqual(two["timing"]["all"]["samples"], 25)
        with tempfile.TemporaryDirectory(dir=ROOT / "tests/.tmp") as folder:
            other = Collection(str(Path(folder) / "other.anki2"))
            try:
                self.assertEqual(study.collect_support(other)["decks"], {})
            finally:
                other.close()


if __name__ == "__main__":
    unittest.main()
