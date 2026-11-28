"""Comprehensive unit tests for Smart Daily Memory Scheduler (no Anki runtime required)."""
from __future__ import annotations

from concurrent.futures import Future
from datetime import date, datetime, timedelta
import importlib.util
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
PKG = "nos_daily_test"
package = types.ModuleType(PKG)
package.__path__ = [str(ROOT)]
sys.modules[PKG] = package

for mod_name in ("media_store", "i18n", "daily_scheduler", "daily_store", "daily_bridge"):
    spec = importlib.util.spec_from_file_location(f"{PKG}.{mod_name}", ROOT / f"{mod_name}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)

ds = sys.modules[f"{PKG}.daily_scheduler"]
store_mod = sys.modules[f"{PKG}.daily_store"]
bridge_mod = sys.modules[f"{PKG}.daily_bridge"]


class _FakeCard:
    def __init__(self, row: tuple) -> None:
        self.id, self.nid, self.did, self.queue, self.due, self.ivl, self.factor, self.reps, self.lapses, self.odid, self.odue, self.data = row


class _FakeDB:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self.conn = conn

    def all(self, sql: str, *args):
        return self.conn.execute(sql, args).fetchall()

    def scalar(self, sql: str, *args):
        row = self.conn.execute(sql, args).fetchone()
        return row[0] if row else None


class _FakeDecks:
    def __init__(self, decks: dict[int, dict]) -> None:
        self._decks = decks

    def all_names_and_ids(self):
        return [types.SimpleNamespace(id=did, name=d["name"]) for did, d in self._decks.items()]

    def all(self):
        return list(self._decks.values())

    def get(self, did: int):
        return self._decks.get(did)

    def id_for_name(self, name: str):
        for did, d in self._decks.items():
            if d["name"] == name:
                return did
        return None


class _FakeCollection:
    def __init__(self, today_date: date, sched_today: int, decks: dict[int, dict]) -> None:
        self.conn = sqlite3.connect(":memory:")
        self.conn.executescript("""
            CREATE TABLE notes(id INTEGER PRIMARY KEY, flds TEXT NOT NULL);
            CREATE TABLE cards(
                id INTEGER PRIMARY KEY, nid INTEGER NOT NULL, did INTEGER NOT NULL,
                queue INTEGER NOT NULL, due INTEGER NOT NULL, ivl INTEGER NOT NULL,
                factor INTEGER NOT NULL, reps INTEGER NOT NULL, lapses INTEGER NOT NULL,
                odid INTEGER NOT NULL DEFAULT 0, odue INTEGER NOT NULL DEFAULT 0,
                data TEXT NOT NULL DEFAULT '{}'
            );
            CREATE TABLE revlog(
                id INTEGER PRIMARY KEY, cid INTEGER NOT NULL, ease INTEGER NOT NULL, type INTEGER NOT NULL
            );
        """)
        self.db = _FakeDB(self.conn)
        self.decks = _FakeDecks(decks)
        # Rollover at 04:00 local time next day.
        cutoff_dt = datetime(today_date.year, today_date.month, today_date.day, 4, 0, 0) + timedelta(days=1)
        self.sched = types.SimpleNamespace(day_cutoff=int(cutoff_dt.timestamp()), today=sched_today)
        self.today_date = today_date
        self.undo_entries: list[str] = []

    def add_card(
        self,
        cid: int,
        did: int,
        front: str,
        *,
        queue: int = 2,
        due: int = 100,
        ivl: int = 10,
        factor: int = 2500,
        reps: int = 2,
        lapses: int = 0,
        odid: int = 0,
        odue: int = 0,
        data: str = "{}",
        revlog_days: list[int] | None = None,
    ) -> None:
        self.conn.execute("INSERT INTO notes(id, flds) VALUES(?, ?)", (cid, f"{front}\x1fBack"))
        self.conn.execute(
            "INSERT INTO cards VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            (cid, cid, did, queue, due, ivl, factor, reps, lapses, odid, odue, data),
        )
        for idx, offset in enumerate(revlog_days or []):
            dt = datetime(self.today_date.year, self.today_date.month, self.today_date.day, 12, 0, 0) + timedelta(days=offset)
            rev_id = int(dt.timestamp() * 1000) + cid * 10 + idx
            self.conn.execute("INSERT INTO revlog VALUES(?,?,?,?)", (rev_id, cid, 3, 1))
        self.conn.commit()

    def get_card(self, cid: int) -> _FakeCard:
        row = self.conn.execute(
            "SELECT id,nid,did,queue,due,ivl,factor,reps,lapses,odid,odue,data FROM cards WHERE id=?",
            (cid,),
        ).fetchone()
        if not row:
            raise KeyError(cid)
        return _FakeCard(row)

    def add_custom_undo_entry(self, label: str) -> int:
        self.undo_entries.append(label)
        return len(self.undo_entries)

    def update_cards(self, cards: list[_FakeCard]) -> None:
        for card in cards:
            self.conn.execute("UPDATE cards SET due=? WHERE id=?", (card.due, card.id))
        self.conn.commit()

    def merge_undo_entries(self, _entry: int) -> None:
        pass


class DailySchedulerTests(unittest.TestCase):
    def setUp(self) -> None:
        (ROOT / "tests/.tmp").mkdir(exist_ok=True)
        self.tmp = tempfile.TemporaryDirectory(dir=ROOT / "tests/.tmp")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.today = date(2026, 11, 26)

    def test_retrievability_fsrs_and_sm2_fallback(self) -> None:
        # At elapsed == stability, FSRS power-law retrievability equals 0.90.
        r_at_s = ds.compute_retrievability(10.0, 10.0, 0.5)
        self.assertAlmostEqual(r_at_s, 0.9, places=4)
        self.assertLess(ds.compute_retrievability(20.0, 10.0, 0.5), r_at_s)
        self.assertEqual(ds.compute_retrievability(0.0, 10.0, 0.5), 1.0)

        s, d, decay, model = ds.parse_memory_state(json.dumps({"s": 14.5, "d": 5.2, "decay": 0.45}), 10, 2500)
        self.assertEqual((model, s, d, decay), ("fsrs", 14.5, 5.2, 0.45))

        s2, d2, _decay2, model2 = ds.parse_memory_state("{}", 12, 2500)
        self.assertEqual(model2, "sm2")
        self.assertIsNone(d2)
        self.assertAlmostEqual(s2, 12.0, places=2)

    def test_hierarchical_scope_resolution(self) -> None:
        all_decks = {
            1: "English",
            2: "English::Vocab",
            3: "English::Vocab::IELTS",
            4: "English::Grammar",
            5: "Medicine",
            6: "Medicine::Anatomy",
        }
        self.assertEqual(ds.resolve_scope_deck_ids(all_decks, "all"), {1, 2, 3, 4, 5, 6})
        self.assertEqual(
            ds.resolve_scope_deck_ids(all_decks, "decks", deck_names=["English"], include_children=True),
            {1, 2, 3, 4},
        )
        self.assertEqual(
            ds.resolve_scope_deck_ids(all_decks, "decks", deck_names=["English"], include_children=False),
            {1},
        )
        self.assertEqual(
            ds.resolve_scope_deck_ids(all_decks, "decks", deck_names=["English::Vocab", "Medicine::Anatomy"], include_children=True),
            {2, 3, 6},
        )

    def test_low_retrievability_prioritized_and_durable_routed_to_light_days(self) -> None:
        # Card 1: fragile low-stability overdue card (S=2d, last reviewed 6 days ago -> R is low & drops fast).
        fragile = ds.ScheduledCard(
            card_id=1, note_id=1, deck_id=1, deck_name="English", queue=2, due=96, due_offset=-4,
            ivl=2, reps=2, lapses=1, odid=0,
            first_studied_day=(self.today - timedelta(days=10)).isoformat(),
            last_review_day=(self.today - timedelta(days=6)).isoformat(),
            stability=2.0, difficulty=7.5, decay=0.5, memory_model="fsrs", preview="fragile",
        )
        # Card 2: durable high-stability card (S=120d, last reviewed 123 days ago -> R barely drops per day).
        durable = ds.ScheduledCard(
            card_id=2, note_id=2, deck_id=1, deck_name="English", queue=2, due=97, due_offset=-3,
            ivl=120, reps=8, lapses=0, odid=0,
            first_studied_day=(self.today - timedelta(days=200)).isoformat(),
            last_review_day=(self.today - timedelta(days=123)).isoformat(),
            stability=120.0, difficulty=3.0, decay=0.5, memory_model="fsrs", preview="durable",
        )
        # Today (0) has 18/20 slots used; days 1..4 are crowded (18/20); day 5 is empty (0/20)!
        existing = {0: 18, 1: 18, 2: 18, 3: 18, 4: 18, 5: 0, 6: 12}
        plan = ds.plan_redistribution([durable, fragile], existing, self.today, daily_cap=20, initial_window=10)
        by_cid = {m["card_id"]: m for m in plan["moves"]}
        # Fragile low-R card must land earlier (Today=0) than durable card, which should route to the valley day (5).
        self.assertEqual(by_cid[1]["target_offset"], 0)
        self.assertEqual(by_cid[2]["target_offset"], 5)

    def test_automatic_window_expansion_preserves_daily_cap(self) -> None:
        # 60 overdue cards with daily_cap=5 and existing 2 cards/day -> only 3 free slots/day -> needs >= 20 days (> initial 14).
        overdue = [
            ds.ScheduledCard(
                card_id=i + 1, note_id=i + 1, deck_id=1, deck_name="English", queue=2, due=95, due_offset=-5,
                ivl=10 + (i % 20), reps=3, lapses=0, odid=0,
                first_studied_day=(self.today - timedelta(days=30)).isoformat(),
                last_review_day=(self.today - timedelta(days=15)).isoformat(),
                stability=10.0 + (i % 30), difficulty=5.0, decay=0.5, memory_model="fsrs",
            )
            for i in range(60)
        ]
        existing = {d: 2 for d in range(0, 40)}
        plan = ds.plan_redistribution(overdue, existing, self.today, daily_cap=5, initial_window=14)
        self.assertTrue(plan["window_expanded"])
        self.assertGreater(plan["expanded_window"], 14)
        self.assertEqual(plan["total_movable"], 60)
        # Verify NO day exceeds daily_cap=5.
        for day_info in plan["days"]:
            self.assertLessEqual(day_info["after"], 5)

    def test_only_studied_day_cards_enter_daily_tab_and_future_is_locked(self) -> None:
        decks = {
            1: {"id": 1, "name": "English", "dyn": 0},
            2: {"id": 2, "name": "English::Vocab", "dyn": 0},
            3: {"id": 3, "name": "Medicine", "dyn": 0},
        }
        col = _FakeCollection(self.today, sched_today=100, decks=decks)
        # Excluded: New card (queue=0)
        col.add_card(10, 2, "Brand new", queue=0, due=1, ivl=0, reps=0, revlog_days=[])
        # Excluded: Intra-day learning step (queue=1)
        col.add_card(11, 2, "Intra-day step", queue=1, due=1700000000, ivl=0, reps=1, revlog_days=[0])
        # Excluded: Suspended review card (queue=-1)
        col.add_card(12, 2, "Suspended", queue=-1, due=100, ivl=10, reps=3, revlog_days=[-10])
        # Excluded: Review card with no revlog history
        col.add_card(13, 2, "No revlog", queue=2, due=100, ivl=5, reps=1, revlog_days=[])
        # Included: Overdue review card
        col.add_card(20, 2, "Overdue review", queue=2, due=97, ivl=4, data=json.dumps({"s": 3.5, "d": 6.0}), revlog_days=[-12, -7])
        # Included: Overdue day-learn card (queue=3 -> shown in overdue count, NOT movable!)
        col.add_card(21, 2, "Overdue day-learn", queue=3, due=99, ivl=1, revlog_days=[-2])
        # Included: Today card
        col.add_card(22, 2, "Due today", queue=2, due=100, ivl=7, data=json.dumps({"s": 7.0, "d": 5.0}), revlog_days=[-14, -7])
        # Included: Future card (locked)
        col.add_card(23, 2, "Future card", queue=2, due=103, ivl=10, data=json.dumps({"s": 10.0, "d": 4.5}), revlog_days=[-15, -7])
        # Included only in 'all', excluded when scoped to 'English'
        col.add_card(24, 3, "Medicine today", queue=2, due=100, ivl=8, revlog_days=[-8])

        snap_en = ds.collect_daily_schedule(col, scope_mode="decks", deck_names=["English"], include_children=True, daily_cap=20)
        self.assertEqual(snap_en["total_tracked"], 4)  # cards 20, 21, 22, 23
        self.assertEqual(snap_en["pending_first_study"], 2)  # cards 10, 11
        self.assertEqual(snap_en["overdue"]["count"], 2)
        self.assertEqual(snap_en["overdue"]["movable_count"], 1)  # only card 20 (queue=2)
        self.assertEqual(snap_en["overdue"]["non_movable_count"], 1)  # card 21 (queue=3)
        self.assertEqual(snap_en["today_bucket"]["card_ids"], [22])
        self.assertFalse(snap_en["today_bucket"]["locked"])
        self.assertEqual(snap_en["today_bucket"]["cards"][0]["first_studied_day"], (self.today - timedelta(days=14)).isoformat())
        day_plus_3 = next(d for d in snap_en["future"]["days"] if d["offset"] == 3)
        self.assertTrue(day_plus_3["locked"])
        self.assertEqual(day_plus_3["count"], 1)

    def test_apply_preserves_fsrs_and_rollback_skips_reviewed_cards(self) -> None:
        decks = {1: {"id": 1, "name": "English", "dyn": 0}}
        col = _FakeCollection(self.today, sched_today=100, decks=decks)
        fsrs_blob_1 = json.dumps({"s": 3.0, "d": 6.2})
        fsrs_blob_2 = json.dumps({"s": 40.0, "d": 3.8})
        col.add_card(30, 1, "Card A", queue=2, due=96, ivl=4, factor=2500, reps=3, lapses=1, data=fsrs_blob_1, revlog_days=[-10, -8])
        col.add_card(31, 1, "Card B", queue=2, due=97, ivl=40, factor=2600, reps=6, lapses=0, data=fsrs_blob_2, revlog_days=[-60, -43])

        store = store_mod.DailyStore(self.root, "Alice")
        snap = ds.collect_daily_schedule(col, scope_mode="all", daily_cap=10)
        res = bridge_mod.apply_redistribution_in_col(col, snap["plan"], store, "Toàn bộ")
        self.assertEqual(res["applied"], 2)
        batch_id = res["batch"]["id"]

        # Verify ONLY due changed; ivl, factor, reps, lapses, and FSRS data are untouched.
        c30 = col.get_card(30)
        c31 = col.get_card(31)
        self.assertGreaterEqual(c30.due, 100)
        self.assertGreaterEqual(c31.due, 100)
        self.assertEqual((c30.ivl, c30.factor, c30.reps, c30.lapses, c30.data), (4, 2500, 3, 1, fsrs_blob_1))
        self.assertEqual((c31.ivl, c31.factor, c31.reps, c31.lapses, c31.data), (40, 2600, 6, 0, fsrs_blob_2))

        # Simulate user reviewing Card 30 AFTER the batch ran -> rollback must skip Card 30 and restore only Card 31.
        future_rev_ms = int(res["batch"]["created_ms"]) + 5000
        col.conn.execute("INSERT INTO revlog VALUES(?,?,?,?)", (future_rev_ms, 30, 3, 1))
        col.conn.commit()

        rb = bridge_mod.rollback_batch_in_col(col, batch_id, store)
        self.assertEqual(rb["restored"], 1)
        self.assertEqual(rb["skipped_reviewed"], 1)
        self.assertEqual(col.get_card(31).due, 97)  # restored!
        self.assertEqual(col.get_card(30).due, c30.due)  # preserved!

        # Presets + backup validator check
        preset = store.save_preset("Tiếng Anh", scope_mode="decks", deck_names=["English"], include_children=True, daily_cap=35)
        self.assertEqual(len(store.list_presets()), 1)
        summary = store_mod.validate_database(store.path)
        self.assertEqual(summary, {"presets": 1, "batches": 1})
        store.delete_preset(preset["id"])
        self.assertEqual(len(store.list_presets()), 0)

    @unittest.skipUnless(importlib.util.find_spec("aqt"), "requires Anki's Qt operations")
    def test_daily_mutations_publish_native_collection_changes(self) -> None:
        import aqt
        from anki.collection import Collection, OpChanges
        from anki.lang import set_lang

        set_lang("en_US")
        col = Collection(str(self.root / "collection.anki2"))
        self.addCleanup(col.close)
        did = col.decks.id("Daily test")
        note = col.new_note(col.models.current())
        note.fields = ["Question", "Answer"]
        col.add_note(note, did)
        card = note.cards()[0]
        today = col.sched.today
        card.type = card.queue = 2
        card.due, card.ivl, card.factor, card.reps = today - 1, 5, 2500, 1
        col.update_card(card)
        col.db.execute("INSERT INTO revlog VALUES (?, ?, 0, 3, 5, 1, 2500, 1000, 1)",
                       (col.sched.day_cutoff - 2 * 86400) * 1000, card.id)

        def run_operation(op, done, **_kwargs):
            future = Future()
            try:
                future.set_result(op())
            except Exception as error:
                future.set_exception(error)
            done(future)

        deck_browser = object()
        mw = types.SimpleNamespace(col=col, deckBrowser=deck_browser,
                                   taskman=types.SimpleNamespace(with_progress=run_operation),
                                   _increase_background_ops=lambda: None, _decrease_background_ops=lambda: None,
                                   update_undo_actions=lambda: None)
        reported, initiators, replies, launched = [], [], [], []

        def collect_changes(changes, initiator):
            self.assertIsInstance(changes, OpChanges)
            reported.append(changes)
            initiators.append(initiator)

        def dispatch(method, **fields):
            bridge_mod.handle({"method": method, **fields}, root=self.root, profile="Alice",
                              current=lambda: True, reply=lambda _channel, payload: replies.append(payload),
                              on_mutated=lambda: None, on_start_review=lambda *args: launched.append(args))

        hooks = aqt.gui_hooks.operation_did_execute
        hooks.append(collect_changes)
        self.addCleanup(hooks.remove, collect_changes)
        with patch.object(aqt, "mw", mw):
            dispatch("apply_plan")
            batch_id = replies[-1]["data"]["apply_result"]["batch"]["id"]
            self.assertTrue(reported[-1].card)
            self.assertIs(initiators[-1], deck_browser)
            self.assertEqual(col.get_card(card.id).due, today)
            dispatch("apply_plan")
            self.assertEqual(replies[-1]["data"]["apply_result"]["applied"], 0)
            self.assertFalse(col.op_made_changes(reported[-1]))
            dispatch("rollback_batch", batch_id=batch_id)
            self.assertEqual(replies[-1]["data"]["rollback_result"]["restored"], 1)
            self.assertTrue(reported[-1].card)
            self.assertIs(initiators[-1], deck_browser)
            self.assertEqual(col.get_card(card.id).due, today - 1)
            dispatch("apply_plan")
            dispatch("study_today", minutes=15)
            filtered = col.decks.id_for_name(bridge_mod.FILTERED_DECK_NAME)
            self.assertIsNotNone(filtered)
            self.assertEqual(launched[-1], (filtered, 15))
            self.assertEqual(replies[-1]["data"], {"started": True, "deck_id": str(filtered), "count": 1})
            self.assertTrue(reported[-1].card and reported[-1].deck)
            self.assertIs(initiators[-1], deck_browser)
            self.assertEqual(col.get_card(card.id).odid, did)
            dispatch("study_today")
            self.assertEqual(launched[-1], (filtered, None))
            self.assertEqual(replies[-1]["data"], {"started": True, "deck_id": str(filtered), "count": 1})
            self.assertTrue(reported[-1].card)
            self.assertIs(initiators[-1], deck_browser)

    @unittest.skipUnless(importlib.util.find_spec("aqt"), "requires Anki's Qt operations")
    def test_live_update_guard_blocks_deckbrowser_reload_during_navigation(self) -> None:
        from anki.collection import OpChanges
        from anki.lang import set_lang
        import aqt.deckbrowser as deckbrowser_mod

        set_lang("en_US")
        spec = importlib.util.spec_from_file_location(f"{PKG}.integration", ROOT / "integration.py")
        integ = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = integ
        for dep in ("data", "theme_settings"):
            if f"{PKG}.{dep}" not in sys.modules:
                dspec = importlib.util.spec_from_file_location(f"{PKG}.{dep}", ROOT / f"{dep}.py")
                dmod = importlib.util.module_from_spec(dspec)
                sys.modules[dspec.name] = dmod
                dspec.loader.exec_module(dmod)
        spec.loader.exec_module(integ)

        orig_op = deckbrowser_mod.DeckBrowser.op_executed
        orig_refresh = deckbrowser_mod.DeckBrowser.refresh
        reloads = []

        class _DummyDeckBrowser(deckbrowser_mod.DeckBrowser):
            def __init__(self):
                self._refresh_needed = False

        def fake_op(view, changes, handler, focused):
            reloads.append(("op", handler, focused))
            return True

        def fake_refresh(view):
            reloads.append(("refresh",))

        self.addCleanup(setattr, deckbrowser_mod.DeckBrowser, "op_executed", orig_op)
        self.addCleanup(setattr, deckbrowser_mod.DeckBrowser, "refresh", orig_refresh)
        deckbrowser_mod.DeckBrowser.op_executed = fake_op
        deckbrowser_mod.DeckBrowser.refresh = fake_refresh
        integ._guard_live_updates()

        view = _DummyDeckBrowser()
        fake_mw = types.SimpleNamespace(col=object(), state="deckBrowser")
        with (
            patch.object(integ, "mw", fake_mw),
            patch.object(integ, "enabled", lambda: True),
            patch.object(integ, "_live_context", view),
            patch.object(integ, "_navigating", True),
        ):
            changes = OpChanges(study_queues=True, card=True, deck=True)
            dirty = deckbrowser_mod.DeckBrowser.op_executed(view, changes, None, True)
            self.assertFalse(dirty)
            deckbrowser_mod.DeckBrowser.refresh(view)
            self.assertEqual(reloads, [])

    def test_safety_floor_and_max_shift_guardrails(self) -> None:
        # Borderline card currently at ~78% R (above 75% floor) drops below 75% if pushed far out.
        borderline = ds.ScheduledCard(
            card_id=101, note_id=101, deck_id=1, deck_name="English", queue=2, due=99, due_offset=-1,
            ivl=5, reps=3, lapses=0, odid=0,
            first_studied_day=(self.today - timedelta(days=20)).isoformat(),
            last_review_day=(self.today - timedelta(days=12)).isoformat(),
            stability=5.0, difficulty=5.5, decay=0.5, memory_model="fsrs", preview="borderline",
        )
        # Durable card stays well above 75% even weeks later.
        durable = ds.ScheduledCard(
            card_id=102, note_id=102, deck_id=1, deck_name="English", queue=2, due=98, due_offset=-2,
            ivl=90, reps=8, lapses=0, odid=0,
            first_studied_day=(self.today - timedelta(days=150)).isoformat(),
            last_review_day=(self.today - timedelta(days=92)).isoformat(),
            stability=90.0, difficulty=3.5, decay=0.5, memory_model="fsrs", preview="durable",
        )
        existing = {0: 1, 1: 1, 2: 1, 3: 1, 10: 0}
        plan = ds.plan_redistribution(
            [durable, borderline], existing, self.today,
            daily_cap=2, initial_window=14, max_window=7, min_target_r=0.75,
        )
        self.assertEqual(plan["max_window"], 7)
        self.assertLessEqual(plan["expanded_window"], 7)
        self.assertEqual(plan["safe_floor_r"], 75)
        by_cid = {m["card_id"]: m for m in plan["moves"]}
        self.assertEqual(by_cid[101]["target_offset"], 0)

    def test_virtual_catchup_and_reschedule_session_queues(self) -> None:
        today_card = ds.ScheduledCard(
            card_id=1, note_id=1, deck_id=1, deck_name="English", queue=2, due=100, due_offset=0,
            ivl=10, reps=2, lapses=0, odid=0,
            first_studied_day=(self.today - timedelta(days=20)).isoformat(),
            last_review_day=(self.today - timedelta(days=10)).isoformat(),
            stability=10.0, difficulty=5.0, decay=0.5, memory_model="fsrs",
        )
        overdue_high_r = ds.ScheduledCard(
            card_id=2, note_id=2, deck_id=1, deck_name="English", queue=2, due=99, due_offset=-1,
            ivl=60, reps=5, lapses=0, odid=0,
            first_studied_day=(self.today - timedelta(days=100)).isoformat(),
            last_review_day=(self.today - timedelta(days=61)).isoformat(),
            stability=60.0, difficulty=4.0, decay=0.5, memory_model="fsrs",
        )
        overdue_low_r = ds.ScheduledCard(
            card_id=3, note_id=3, deck_id=1, deck_name="English", queue=2, due=95, due_offset=-5,
            ivl=3, reps=2, lapses=1, odid=0,
            first_studied_day=(self.today - timedelta(days=15)).isoformat(),
            last_review_day=(self.today - timedelta(days=8)).isoformat(),
            stability=3.0, difficulty=7.0, decay=0.5, memory_model="fsrs",
        )
        sq_virtual = ds.build_session_queue(
            [today_card], [overdue_low_r, overdue_high_r], self.today,
            daily_cap=2, backlog_mode="virtual", review_order="auto",
        )
        self.assertEqual(sq_virtual["resolved_order"], "desc_r")
        self.assertEqual(sq_virtual["count"], 2)
        self.assertEqual(sq_virtual["today_included"], 1)
        self.assertEqual(sq_virtual["overdue_included"], 1)
        self.assertEqual(sq_virtual["deferred_count"], 1)
        # In desc_r with cap=2, today_card (1) and overdue_high_r (2) are chosen; 1 & 2 ordered desc R.
        self.assertEqual(set(sq_virtual["card_ids"]), {1, 2})

        sq_resched = ds.build_session_queue(
            [today_card], [overdue_low_r, overdue_high_r], self.today,
            daily_cap=2, backlog_mode="reschedule", review_order="asc_r",
        )
        self.assertEqual(sq_resched["resolved_order"], "asc_r")
        self.assertEqual(sq_resched["card_ids"], [1])
        self.assertEqual(sq_resched["overdue_included"], 0)

    @unittest.skipUnless(importlib.util.find_spec("aqt"), "requires Anki's Qt operations")
    def test_virtual_catchup_fsrs_sm2_ordering_relearning_guard_and_cleanup(self) -> None:
        from anki.collection import Collection
        from anki.lang import set_lang

        set_lang("en_US")
        col = Collection(str(self.root / "collection_orders.anki2"))
        self.addCleanup(col.close)
        col.crt -= 100 * 86400
        col._load_scheduler()
        did = col.decks.id("Chinese")
        today = col.sched.today

        # Create 3 cards: today (high R), overdue (medium R), overdue (low R), plus 1 future card (must stay excluded).
        def make_card(front: str, due_val: int, stability: float, rev_days_ago: int) -> int:
            note = col.new_note(col.models.current())
            note.fields = [front, "Ans"]
            col.add_note(note, did)
            c = note.cards()[0]
            c.type = c.queue = 2
            c.due = due_val
            c.ivl = max(1, int(stability))
            c.factor = 2500
            c.reps = 3
            c.data = json.dumps({"s": stability, "d": 5.0})
            col.update_card(c)
            col.db.execute(
                "INSERT INTO revlog VALUES (?, ?, 0, 3, ?, 1, 2500, 1000, 1)",
                (col.sched.day_cutoff - rev_days_ago * 86400) * 1000 + c.id % 1000,
                c.id,
                max(1, int(stability)),
            )
            return c.id

        cid_today_high = make_card("TodayHighR", today, 30.0, 10)
        cid_over_mid = make_card("OverMidR", today - 1, 20.0, 21)
        cid_over_low = make_card("OverLowR", today - 4, 3.0, 7)
        cid_future = make_card("FutureLocked", today + 3, 15.0, 12)

        # Create legacy nested filtered deck + empty 'AnkiNOS' shell to verify migration/cleanup.
        legacy_fdid = col.decks.new_filtered("AnkiNOS::Lịch hôm nay")
        self.assertIsNotNone(col.decks.id_for_name("AnkiNOS"))

        # Test both SM-2 (fsrs=False) and FSRS (fsrs=True) with desc_r and asc_r without DbError.
        for fsrs_enabled in (False, True):
            col.set_config("fsrs", fsrs_enabled)
            fdid, count = bridge_mod.prepare_today_filtered_deck(
                col, daily_cap=3, backlog_mode="virtual", review_order="desc_r"
            )
            self.assertEqual(count, 3)
            self.assertIsNone(col.decks.id_for_name("AnkiNOS::Lịch hôm nay"))
            self.assertIsNone(col.decks.id_for_name("AnkiNOS"))
            self.assertEqual(col.get_card(cid_future).odid, 0)
            # Home due dates are preserved untouched in odue!
            self.assertEqual(col.get_card(cid_today_high).odue, today)
            self.assertEqual(col.get_card(cid_over_mid).odue, today - 1)
            self.assertEqual(col.get_card(cid_over_low).odue, today - 4)

            served_desc = [item.card.id for item in col.sched.get_queued_cards(fetch_limit=10).cards]
            self.assertEqual(served_desc, [cid_today_high, cid_over_mid, cid_over_low])

            # Test asc_r order too.
            bridge_mod.prepare_today_filtered_deck(
                col, daily_cap=3, backlog_mode="virtual", review_order="asc_r", session_mode="rebuild"
            )
            served_asc = [item.card.id for item in col.sched.get_queued_cards(fetch_limit=10).cards]
            self.assertEqual(served_asc, [cid_over_low, cid_over_mid, cid_today_high])

        # Simulate active relearning card (queue=1) inside managed filtered deck -> smart & continue must preserve it!
        relearn_card = col.get_card(cid_over_low)
        relearn_card.queue = 1
        relearn_card.due = int(col.sched.day_cutoff) - 600
        col.update_card(relearn_card)

        active = bridge_mod.inspect_active_filtered_session(col)
        self.assertTrue(active["active"])
        self.assertEqual(active["relearning_count"], 1)

        with patch.object(col.sched, "empty_filtered_deck", wraps=col.sched.empty_filtered_deck) as empty_spy:
            resumed_did, resumed_count = bridge_mod.prepare_today_filtered_deck(
                col, daily_cap=3, backlog_mode="virtual", review_order="desc_r", session_mode="smart"
            )
            self.assertEqual(empty_spy.call_count, 0)
            self.assertEqual(resumed_did, fdid)
            self.assertEqual(resumed_count, 3)

        # Explicit empty_session returns all cards and deletes the managed filtered deck cleanly.
        returned = bridge_mod.empty_session_in_col(col)
        self.assertEqual(returned, 3)
        self.assertIsNone(col.decks.id_for_name(bridge_mod.FILTERED_DECK_NAME))
        self.assertEqual(col.get_card(cid_today_high).did, did)
        self.assertEqual(col.get_card(cid_over_mid).due, today - 1)
        self.assertEqual(col.get_card(cid_over_low).did, did)
        self.assertIsNotNone(legacy_fdid)


if __name__ == "__main__":
    unittest.main()
