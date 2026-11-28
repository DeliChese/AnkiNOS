"""Pomodoro store, custom alert audio, migration, and analytics unit tests (no Anki/Qt)."""
import importlib.util
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
package = types.ModuleType("nos_pomo_test")
package.__path__ = [str(ROOT)]
sys.modules[package.__name__] = package
for name in ("media_store", "focus_store", "pomodoro_store"):
    spec = importlib.util.spec_from_file_location(package.__name__ + "." + name, ROOT / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)

pomo = sys.modules[package.__name__ + ".pomodoro_store"]
focus = sys.modules[package.__name__ + ".focus_store"]


class PomodoroStoreTests(unittest.TestCase):
    def setUp(self):
        (ROOT / "tests/.tmp").mkdir(exist_ok=True)
        self.tmp = tempfile.TemporaryDirectory(dir=ROOT / "tests/.tmp")
        self.root = Path(self.tmp.name)
        self.clock = [1000.0]
        self.patch = patch.object(pomo.time, "monotonic", side_effect=lambda: self.clock[0])
        self.patch.start()
        self.store = pomo.PomodoroStore(self.root, "Learner")

    def tearDown(self):
        self.patch.stop()
        self.tmp.cleanup()

    def test_four_modes_and_study_break_analytics(self):
        # 1. Classic 25/5: completes study -> awaiting break -> runs break
        self.store.start(mode="classic", deck_id="101", deck_name="English")
        self.assertEqual(self.store.status()["target_seconds"], 1500)
        self.clock[0] += 600
        self.store.answer("101", "English")
        self.store.answer("101", "English")
        self.clock[0] += 905
        st = self.store.checkpoint()
        self.assertFalse(st["active"])
        self.assertEqual(st["awaiting_phase"], "break")
        self.assertEqual(st["awaiting_target_seconds"], 300)
        self.assertEqual(st["last_event"]["kind"], "study_done")
        self.assertEqual(st["cycle_count"], 1)

        # Start break from awaiting state
        st = self.store.switch_phase()
        self.assertTrue(st["active"])
        self.assertEqual(st["phase"], "break")
        self.assertEqual(st["target_seconds"], 300)
        self.clock[0] += 305
        st = self.store.checkpoint()
        self.assertEqual(st["awaiting_phase"], "study")
        self.assertEqual(st["last_event"]["kind"], "break_done")

        # 2. Long Pomodoro 50/10
        st = self.store.start(mode="long", deck_id="202", deck_name="Japanese")
        self.assertEqual(st["target_seconds"], 3000)
        self.clock[0] += 1200
        self.store.answer("202", "Japanese")
        self.store.stop("stopped")

        # 3. Custom 15/3
        st = self.store.start(mode="custom", study_minutes=15, break_minutes=3)
        self.assertEqual(st["target_seconds"], 900)
        self.clock[0] += 900
        self.store.checkpoint()

        # 4. Stopwatch (count-up)
        st = self.store.start(mode="stopwatch", deck_id="101", deck_name="English")
        self.assertEqual(st["target_seconds"], 0)
        self.clock[0] += 420
        self.store.answer("101", "English")
        self.store.switch_phase("break")
        self.clock[0] += 180
        self.store.stop("completed")

        # Analytics across week/month/year and filters
        week = self.store.analytics(period="week")
        self.assertEqual(week["summary"]["study_seconds"], 1500 + 1200 + 900 + 420)
        self.assertEqual(week["summary"]["break_seconds"], 300 + 180)
        self.assertEqual(week["summary"]["total_seconds"], 1500 + 1200 + 900 + 420 + 300 + 180)
        self.assertEqual(week["summary"]["total_cards"], 4)
        self.assertEqual(len(week["buckets"]), 7)
        self.assertGreater(week["summary"]["focus_ratio"], 80.0)

        month = self.store.analytics(period="month", mode="classic")
        self.assertEqual(month["summary"]["study_seconds"], 1500)
        self.assertEqual(month["summary"]["break_seconds"], 300)

        year = self.store.analytics(period="year", deck_id="202")
        self.assertEqual(len(year["buckets"]), 12)
        self.assertEqual(year["summary"]["study_seconds"], 1200)
        self.assertEqual(year["summary"]["break_seconds"], 0)

        completed_only = self.store.analytics(period="week", status="completed")
        stopped_only = self.store.analytics(period="week", status="stopped")
        self.assertEqual(stopped_only["summary"]["study_seconds"], 1200)
        self.assertEqual(completed_only["summary"]["study_seconds"], 1500 + 900 + 420)

        # Read-only backup validation passes
        meta = pomo.validate_database(self.store.path)
        self.assertEqual(meta["sessions"], 6)

    def test_extend_and_pause_resume(self):
        self.store.start(mode="classic")
        self.clock[0] += 100
        self.store.pause()
        self.clock[0] += 500
        self.assertEqual(self.store.status()["seconds"], 100)
        self.store.extend(5)
        self.assertEqual(self.store.status()["target_seconds"], 1800)
        self.store.resume()
        self.clock[0] += 50
        self.store.stop()
        self.assertEqual(self.store.analytics(period="week")["summary"]["study_seconds"], 150)

    def test_legacy_focus_migration_preserves_history(self):
        legacy = focus.FocusStore(self.root, "Migrated")
        with patch.object(focus.time, "monotonic", side_effect=lambda: self.clock[0]):
            legacy.start(25)
            self.clock[0] += 900
            legacy.answer()
            legacy.stop("stopped")
        migrated = pomo.PomodoroStore(self.root, "Migrated")
        stats = migrated.analytics(period="week")
        self.assertEqual(stats["summary"]["study_seconds"], 900)
        self.assertEqual(stats["summary"]["total_cards"], 1)

    def test_custom_sound_validation_and_settings_cleaning(self):
        mp3 = self.root / "bell.mp3"
        mp3.write_bytes(b"ID3" + b"\x00" * 64)
        saved = pomo.save_custom_sound(self.root, "Learner", mp3)
        self.assertEqual(saved["ext"], ".mp3")
        pub = pomo.public_pomodoro_settings({"custom_study_sound": saved, "sound_study_end": "custom"}, self.root, "Learner", "NOS")
        self.assertIn("/pomodoro_audio/" + saved["id"] + ".mp3", pub["custom_study_sound"]["url"])
        pomo.delete_custom_sound(self.root, "Learner", saved)
        pub_after = pomo.public_pomodoro_settings({"custom_study_sound": saved}, self.root, "Learner", "NOS")
        self.assertIsNone(pub_after["custom_study_sound"])

        bad = self.root / "fake.mp3"
        bad.write_bytes(b"NOT_AN_AUDIO_FILE")
        with self.assertRaises(ValueError):
            pomo.save_custom_sound(self.root, "Learner", bad)

        clean = pomo.clean_pomodoro_settings({"mode": "bad", "ui_mode": "flip", "study_minutes": 999, "sound_volume": 80})
        self.assertEqual(clean["mode"], "classic")
        self.assertEqual(clean["ui_mode"], "flip")
        self.assertEqual(clean["study_minutes"], 25)
        self.assertEqual(clean["sound_volume"], 80)


if __name__ == "__main__":
    unittest.main()
