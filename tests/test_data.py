"""Exercise collection queries against a disposable, real Anki collection."""

import importlib.util
import shutil
import uuid
import unittest
from pathlib import Path

from anki.collection import Collection
from anki.lang import set_lang

set_lang("en_US")

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("nos_data", ROOT / "data.py")
data = importlib.util.module_from_spec(spec)
spec.loader.exec_module(data)


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        scratch = ROOT / "tests" / ".tmp"
        scratch.mkdir(exist_ok=True)
        self.tmp = scratch / ("nos-test-" + uuid.uuid4().hex)
        self.tmp.mkdir()
        self.col = Collection(str(self.tmp / "collection.anki2"))

    def tearDown(self):
        self.col.close()
        assert self.tmp.resolve().is_relative_to(ROOT / "tests" / ".tmp")
        shutil.rmtree(self.tmp)

    def card(self, deck):
        did = self.col.decks.id(deck)
        note = self.col.new_note(self.col.models.current())
        note.fields[0] = f"Question {deck}"
        note.fields[1] = "Answer"
        self.col.add_note(note, did)
        return self.col.find_cards(f"nid:{note.id}")[0], did

    def log(self, cid, timestamp, ease=3, kind=1, ms=20000):
        self.col.db.execute(
            "INSERT INTO revlog VALUES (?, ?, 0, ?, 1, 1, 2500, ?, ?)",
            int(timestamp * 1000), cid, ease, ms, kind,
        )

    def test_empty_collection_has_no_invented_metrics(self):
        out = data.collect_snapshot(self.col)
        self.assertEqual(out["total_cards"], 0)
        self.assertEqual(out["stats"]["reviews"], 0)
        self.assertEqual(out["stats"]["streak"], 0)
        self.assertIsNone(out["stats"]["pace"])
        self.assertIsNone(out["stats"]["retention"])
        self.assertEqual(out["days"], {})

    def test_rollover_streak_and_weighted_parent_retention(self):
        cid1, _ = self.card("Languages::English")
        cid2, _ = self.card("Languages::Japanese")
        start = self.col.sched.day_cutoff - 86400
        self.log(cid1, start + 1, 3)
        self.log(cid1, start + 2, 1)
        self.log(cid1, start + 3, 3)
        self.log(cid2, start + 4, 1)
        self.log(cid1, start - 1, 3)
        self.log(cid1, start + 5, 0, 4)
        self.log(cid1, start + 6, 3, 5)
        self.log(cid1, start - 35*86400, 1)
        out = data.collect_snapshot(self.col)
        parent = next(d for d in out["decks"] if d["name"] == "Languages")
        self.assertEqual(parent["total"], 2)
        self.assertEqual(len(parent["children"]), 2)
        self.assertEqual(parent["retention"], 60.0)
        self.assertEqual(out["stats"]["retention"], 60.0)
        self.assertEqual(out["stats"]["reviews"], 4)
        self.assertEqual(out["stats"]["milliseconds"], 80000)
        self.assertEqual(out["stats"]["pace"], 180)
        self.assertEqual(out["stats"]["streak"], 2)
        self.assertEqual(sum(day["reviews"] for day in out["days"].values()), 6)

    def test_filtered_cards_count_toward_original_deck(self):
        cid, original_id = self.card("Original")
        filtered_id = self.col.decks.id("Temporary")
        self.col.db.execute("UPDATE cards SET odid=?, did=? WHERE id=?", original_id, filtered_id, cid)
        out = data.collect_snapshot(self.col)
        self.assertEqual(out["total_cards"], 1)
        original = next(d for d in out["decks"] if d["name"] == "Original")
        temporary = next(d for d in out["decks"] if d["name"] == "Temporary")
        self.assertEqual(original["total"], 1)
        self.assertEqual(temporary["total"], 0)

    def test_yesterday_streak_before_first_review_today(self):
        cid, _ = self.card("Daily")
        start = self.col.sched.day_cutoff - 86400
        self.log(cid, start - 10)
        self.log(cid, start - 86410)
        out = data.collect_snapshot(self.col)
        self.assertEqual(out["stats"]["reviews"], 0)
        self.assertEqual(out["stats"]["streak"], 2)

    def test_relative_trends_handle_growth_decline_and_missing_baseline(self):
        self.assertEqual(data.metric_change(120,100,"yesterday")["percent"],20.0)
        self.assertEqual(data.metric_change(50,100,"yesterday")["percent"],-50.0)
        self.assertEqual(data.metric_change(0,100,"yesterday")["percent"],-100.0)
        self.assertIsNone(data.metric_change(10,0,"yesterday")["percent"])
        self.assertIsNone(data.metric_change(None,20,"yesterday")["percent"])

    def test_today_is_compared_with_same_clock_time_yesterday(self):
        from datetime import datetime, timedelta
        cid, _ = self.card("Comparisons")
        start = self.col.sched.day_cutoff - 86400
        yesterday_now = (datetime.now() - timedelta(days=1)).timestamp()
        self.log(cid,yesterday_now-30,ms=10000)
        self.log(cid,yesterday_now+30,ms=90000)
        self.log(cid,start+1,ms=20000)
        out = data.collect_snapshot(self.col)
        self.assertEqual(out["trends"]["reviews"]["previous"],1)
        self.assertEqual(out["trends"]["milliseconds"]["previous"],10000)
        self.assertEqual(out["trends"]["milliseconds"]["percent"],100.0)

    def test_overview_contains_only_selected_deck_and_children(self):
        first, parent = self.card("Focus")
        child, _ = self.card("Focus::Child")
        other, _ = self.card("Other")
        self.col.decks.set_current(parent)
        deck = self.col.decks.get(parent)
        deck["desc"] = '<p>Hello</p><script>window.attacked=1</script><p>World</p>'
        self.col.decks.update_dict(deck)
        start = self.col.sched.day_cutoff - 86400
        self.log(first,start+1,ms=10000)
        self.log(child,start+2,ms=20000)
        self.log(other,start+3,ms=90000)
        out=data.collect_overview_snapshot(self.col)
        self.assertEqual(out["id"],str(parent))
        self.assertEqual(out["total"],2)
        self.assertEqual(out["children"],1)
        self.assertEqual(out["today_reviews"],2)
        self.assertEqual(out["today_milliseconds"],30000)
        self.assertEqual(out["retention"],100.0)
        self.assertNotIn('attacked',out["description"])
        self.assertNotIn('<',out["description"])

    def test_three_level_hierarchy_uses_canonical_names_and_parent_ids(self):
        _, one = self.card("Course::Unit 1::Words")
        _, two = self.card("Course::Unit 2::Words")
        self.card("Other::Words")
        out=data.collect_snapshot(self.col)
        course=next(d for d in out["decks"] if d["full_name"]=="Course")
        self.assertEqual(course["total"],2)
        self.assertIsNone(course["parent_id"])
        for unit in course["children"]:
            self.assertEqual(unit["parent_id"],course["id"])
            self.assertEqual(unit["depth"],1)
            words=unit["children"][0]
            self.assertEqual(words["parent_id"],unit["id"])
            self.assertEqual(words["full_name"],unit["full_name"]+'::Words')
            self.assertIn(int(words["id"]),(one,two))
            self.assertEqual(words["depth"],2)

    def test_overview_base_does_not_require_card_or_history_queries(self):
        from types import SimpleNamespace
        fake=SimpleNamespace(decks=SimpleNamespace(current=lambda:{'id':1,'name':'Parent::Child'}),
                             sched=SimpleNamespace(counts=lambda:(20,4,0)))
        out=data.overview_base(fake)
        self.assertEqual(out["available"],24)
        self.assertTrue(out["partial"])
        self.assertIsNone(out["today_reviews"])

    def test_cache_observes_immediate_edits_in_same_collection(self):
        before=data.collect_snapshot(self.col)
        cid,_=self.card('Added immediately')
        self.log(cid,self.col.sched.day_cutoff-10)
        after=data.collect_snapshot(self.col)
        self.assertEqual(after['total_cards'],before['total_cards']+1)
        self.assertEqual(after['stats']['reviews'],1)

    def test_heatmap_keeps_history_older_than_two_years(self):
        cid,_=self.card('Archive')
        self.log(cid,self.col.sched.day_cutoff-1000*86400)
        out=data.collect_snapshot(self.col)
        self.assertLess(out['history_start_year'],int(out['today'][:4])-1)
        archive=data.collect_history_year(self.col,out['history_start_year'])
        self.assertEqual(sum(day['reviews'] for day in archive['days'].values()),1)
        self.assertNotIn(out['history_start_year'],out['history_loaded_years'])
        refreshed=data.collect_snapshot(self.col)
        self.assertIn(out['history_start_year'],refreshed['history_loaded_years'])

    def test_long_streak_extends_beyond_loaded_heatmap_year(self):
        cid,_=self.card('Long streak')
        start=self.col.sched.day_cutoff-86400
        self.col.db.execute('WITH RECURSIVE seq(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM seq WHERE x<900) INSERT INTO revlog SELECT ?-x*86400000,?,0,3,1,1,2500,1000,1 FROM seq',int((start+1)*1000),cid)
        out=data.collect_snapshot(self.col)
        self.assertEqual(out['stats']['streak'],901)
        self.assertLess(len(out['days']),400,'Do not materialize the entire archive to compute a long streak')

    def test_review_update_and_undo_match_full_recount(self):
        cid,_=self.card('Cached review')
        start=self.col.sched.day_cutoff-86400
        self.log(cid,start-900*86400)
        first=data.collect_snapshot(self.col,revision=0)
        self.log(cid,start+1)
        fast=data.collect_snapshot(self.col,revision=1,review_only=True)
        self.assertEqual(len(fast['days']),len(first['days'])+1)
        data.clear_snapshot_cache()
        self.assertEqual(fast,data.collect_snapshot(self.col,revision=1))
        self.col.db.execute('DELETE FROM revlog WHERE id=?',int((start-900*86400)*1000))
        undone=data.collect_snapshot(self.col,revision=2)
        self.assertEqual(len(undone['days']),1)

    def test_supplied_native_tree_avoids_second_scheduler_query(self):
        self.card('Native tree')
        tree=self.col.sched.deck_due_tree()
        original=self.col.sched.deck_due_tree
        def unexpected():
            raise AssertionError('Scheduler queried twice')
        self.col.sched.deck_due_tree=unexpected
        try:
            self.assertEqual(data.collect_snapshot(self.col,due_tree=tree)['total_cards'],1)
        finally:
            self.col.sched.deck_due_tree=original


if __name__ == "__main__":
    unittest.main()
