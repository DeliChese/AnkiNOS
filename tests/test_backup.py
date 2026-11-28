"""Archive round trips, hostile inputs, rollback and cross-profile ownership."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
import warnings
import zipfile

ROOT = Path(__file__).resolve().parents[1]
package = types.ModuleType("nos_backup_test")
package.__path__ = [str(ROOT)]
sys.modules[package.__name__] = package
for name in ("media_store", "focus_store", "backup_store"):
    spec = importlib.util.spec_from_file_location(package.__name__ + "." + name, ROOT / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
backup = sys.modules[package.__name__ + ".backup_store"]
Focus = sys.modules[package.__name__ + ".focus_store"].FocusStore


class BackupTests(unittest.TestCase):
    def setUp(self):
        (ROOT / "tests/.tmp").mkdir(exist_ok=True)
        self.tmp = tempfile.TemporaryDirectory(dir=ROOT / "tests/.tmp")
        self.root = Path(self.tmp.name)
        self.photo = "a" * 32
        self.settings = {"theme": "night", "goal": 123, "study_budget": 30,
            "images": [{"id": self.photo, "name": "Summer", "ext": ".png"}],
            "image_dashboard": self.photo, "image_fit_dashboard": "cover", "wallpaper_dim": 40, "wallpaper_blur": 6,
            "favorites": ["100"], "colors": {"100": "blue"}, "last_study_deck": "100"}
        folder = backup.profile_dir(self.root, "Alice")
        folder.mkdir(parents=True)
        (folder / (self.photo + ".png")).write_bytes(b"original image bytes")
        (folder / (self.photo + "-thumb.png")).write_bytes(b"thumbnail bytes")
        (folder / (self.photo + "-wall.jpg")).write_bytes(b"wallpaper bytes")
        focus = Focus(self.root, "Alice")
        focus.start(30); focus.answer(); focus.stop()
        self.archive = backup.export_archive(self.root, "Alice", self.settings, self.root / "archive.nosbackup", deck_names={"100": "Languages::English"})

    def test_removed_learning_data_still_round_trips_without_an_engine(self):
        import sqlite3
        from contextlib import closing
        legacy=backup.profile_dir(self.root,"Alice")/"learning.sqlite3"
        with closing(sqlite3.connect(legacy)) as db:
            db.executescript('\n                CREATE TABLE IF NOT EXISTS mappings(collection_key TEXT,deck_id TEXT,model_id TEXT,config TEXT NOT NULL,\n                    PRIMARY KEY(collection_key,deck_id,model_id));\n                CREATE TABLE IF NOT EXISTS sources(source_key TEXT,revision TEXT,snapshot TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,\n                    PRIMARY KEY(source_key,revision));\n                CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,collection_key TEXT NOT NULL,started_at TEXT NOT NULL,\n                    ended_at TEXT,status TEXT NOT NULL,planned TEXT NOT NULL);\n                CREATE TABLE IF NOT EXISTS presentations(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,source_key TEXT NOT NULL,\n                    revision TEXT NOT NULL,mode TEXT NOT NULL,prior_exposure INTEGER NOT NULL);\n                CREATE TABLE IF NOT EXISTS exposures(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,source_key TEXT NOT NULL,\n                    revision TEXT NOT NULL,presentation_id TEXT NOT NULL,kind TEXT NOT NULL,at TEXT NOT NULL);\n                CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,presentation_id TEXT NOT NULL,\n                    request TEXT NOT NULL,result TEXT NOT NULL,at TEXT NOT NULL);\n                CREATE INDEX IF NOT EXISTS exposure_source ON exposures(session_id,source_key,revision);\n                CREATE INDEX IF NOT EXISTS attempt_presentation ON attempts(presentation_id);\n                PRAGMA user_version=3;\n            ')
            db.execute("INSERT INTO sessions VALUES (?,?,?,?,?,?)",("old","collection","2026-11-17",None,"stopped",'["source"]'))
            db.commit()
        original=legacy.read_bytes()
        archive=backup.export_archive(self.root,"Alice",self.settings,self.root/"legacy.nosbackup")
        preview=backup.inspect_archive(self.root,archive)
        self.assertEqual(preview["learning"]["sessions"],1)
        backup.restore_archive(self.root,"Bob",archive,preview["archive_sha256"],{},lambda _:None)
        restored=backup.profile_dir(self.root,"Bob")/"learning.sqlite3"
        with closing(sqlite3.connect(restored)) as db:self.assertEqual(db.execute("SELECT id FROM sessions").fetchone()[0],"old")
        self.assertEqual(legacy.read_bytes(),original)

    def tearDown(self):
        self.tmp.cleanup()

    def test_removed_brainexer_data_still_round_trips_without_hub(self):
        import sqlite3
        from contextlib import closing
        folder = backup.profile_dir(self.root, "Alice")
        legacy = folder / "brainexer.sqlite3"
        digest = "b" * 64
        audio_dir = folder / "brainexer_audio"
        audio_dir.mkdir()
        (audio_dir / f"{digest}.mp3").write_bytes(b"ID3test audio")
        with closing(sqlite3.connect(legacy)) as db:
            db.executescript("""
                CREATE TABLE sessions(id INTEGER PRIMARY KEY);
                CREATE TABLE exercises(id INTEGER PRIMARY KEY);
                CREATE TABLE attempts(id INTEGER PRIMARY KEY);
                CREATE TABLE mistakes(id INTEGER PRIMARY KEY);
                CREATE TABLE usage_events(id INTEGER PRIMARY KEY);
                CREATE TABLE limit_settings(key TEXT PRIMARY KEY, value INTEGER);
                CREATE TABLE deck_kinds(deck_name TEXT PRIMARY KEY, kind TEXT, question_field TEXT, answer_field TEXT);
                CREATE TABLE listening_items(id INTEGER PRIMARY KEY, audio_hash TEXT NOT NULL);
                CREATE TABLE audio_cache(hash TEXT PRIMARY KEY);
                CREATE TABLE highscores(deck_name TEXT, game TEXT, PRIMARY KEY(deck_name, game));
                CREATE TABLE overrides(id INTEGER PRIMARY KEY);
                CREATE TABLE tts_usage(month TEXT PRIMARY KEY);
                PRAGMA user_version = 4;
            """)
            db.execute("INSERT INTO sessions(id) VALUES (1)")
            db.execute("INSERT INTO deck_kinds VALUES ('Languages::English', 'language', '', '')")
            db.execute("INSERT INTO listening_items(id, audio_hash) VALUES (1, ?)", (digest,))
            db.commit()
        config = {"review_daily_limit": 9, "azure_region": "southeastasia"}
        archive = backup.export_archive(self.root, "Alice", self.settings,
                                        self.root / "brainexer.nosbackup",
                                        brainexer_settings=config)
        preview = backup.inspect_archive(self.root, archive)
        self.assertEqual(preview["version"], 4)
        self.assertEqual(preview["brainexer"]["sessions"], 1)
        self.assertEqual(preview["brainexer_settings"]["review_daily_limit"], 9)
        restored_config = []
        backup.restore_archive(self.root, "Bob", archive, preview["archive_sha256"], {},
                               lambda _: None, current_brainexer_settings={},
                               apply_brainexer_settings=restored_config.append)
        bob = backup.profile_dir(self.root, "Bob")
        self.assertEqual((bob / "brainexer_audio" / f"{digest}.mp3").read_bytes(), b"ID3test audio")
        with closing(sqlite3.connect(bob / "brainexer.sqlite3")) as db:
            self.assertEqual(db.execute("SELECT kind FROM deck_kinds WHERE deck_name='Languages::English'").fetchone()[0], "language")
        self.assertEqual(restored_config[-1]["azure_region"], "southeastasia")

    def test_daily_schedule_database_round_trips(self):
        from nos_backup_test.daily_store import DailyStore
        store = DailyStore(self.root, "Alice")
        store.save_preset("Tiếng Anh", scope_mode="decks", deck_names=["Languages::English"], include_children=True, daily_cap=35)
        store.record_batch(scope_label="Toàn bộ", daily_cap=35, window_days=14, summary="Dời 1 thẻ", moves=[{
            "card_id": 101, "deck_name": "Languages::English", "preview": "hello",
            "old_due": 95, "new_due": 100, "old_date": "2026-11-21", "new_date": "2026-11-26",
            "ivl": 5, "r_before": 68.0, "r_target": 68.0, "reason": "R thấp",
        }])
        archive = backup.export_archive(self.root, "Alice", self.settings, self.root / "daily.nosbackup")
        preview = backup.inspect_archive(self.root, archive)
        self.assertEqual(preview["daily_schedule"], {"presets": 1, "batches": 1})
        backup.restore_archive(self.root, "Bob", archive, preview["archive_sha256"], {}, lambda _: None)
        bob_store = DailyStore(self.root, "Bob")
        self.assertEqual(len(bob_store.list_presets()), 1)
        self.assertEqual(len(bob_store.list_batches()), 1)

    def rewrite(self, mutate):
        path = self.root / "changed.nosbackup"
        with zipfile.ZipFile(self.archive) as archive:
            files = {name: archive.read(name) for name in archive.namelist()}
        mutate(files)
        with zipfile.ZipFile(path, "w") as archive:
            for name, data in files.items():
                archive.writestr(name, data)
        return path

    def test_wallpaper_copy_and_display_options_are_backed_up(self):
        with zipfile.ZipFile(self.archive) as archive:
            self.assertIn("profile/" + self.photo + "-wall.jpg", archive.namelist())
        preview = backup.inspect_archive(self.root, self.archive)
        stored = preview["settings"]
        self.assertEqual((stored["image_fit_dashboard"], stored["wallpaper_dim"], stored["wallpaper_blur"]), ("cover", 40, 6))
        bad = backup.clean_settings({"wallpaper_dim": 999, "wallpaper_blur": -1, "image_fit_review": "stretch"})
        self.assertNotIn("wallpaper_dim", bad); self.assertNotIn("wallpaper_blur", bad); self.assertNotIn("image_fit_review", bad)

    def test_appearance_round_trip(self):
        appearance = {"theme": "system", "color_theme": "mononoke", "accent": "custom", "custom_accent": "#8abc32", "layout": "zen",
                      "theme_overrides": {"surface": "#224488", "danger": "#ed5268"}}
        appearance.update(surface_style="liquid", motion_preset="spring", motion_duration=360)
        archive = backup.export_archive(self.root, "Alice", {**self.settings, **appearance}, self.root / "theme.nosbackup")
        preview = backup.inspect_archive(self.root, archive)
        saved = []
        backup.restore_archive(self.root, "Bob", archive, preview["archive_sha256"], {}, saved.append)
        self.assertEqual({key: saved[-1][key] for key in appearance}, appearance)

    def test_complete_round_trip_remaps_decks_and_preserves_other_profile(self):
        preview = backup.inspect_archive(self.root, self.archive)
        self.assertEqual(preview["focus_sessions"], 1)
        self.assertNotIn("url", preview["settings"]["images"][0])
        stored = []
        recovery = backup.restore_archive(self.root, "Bob", self.archive, preview["archive_sha256"], {}, stored.append,
            deck_names={"900": "Languages::English"})
        self.assertTrue(recovery.is_file())
        self.assertEqual(stored[-1]["last_study_deck"], "900")
        self.assertEqual(stored[-1]["favorites"], ["900"])
        self.assertEqual(stored[-1]["colors"], {"900": "blue"})
        self.assertEqual(Focus(self.root, "Bob").history()["total_cards"], 1)
        self.assertTrue((backup.profile_dir(self.root, "Alice") / (self.photo + ".png")).is_file())
        self.assertEqual((backup.profile_dir(self.root, "Bob") / (self.photo + "-thumb.png")).read_bytes(), b"thumbnail bytes")

    def test_corrupt_or_unexpected_archive_cannot_touch_live_files(self):
        for mutate in (lambda f: f.update({"../escape.txt": b"bad"}),
                       lambda f: f.update({"profile/" + self.photo + ".png": b"corrupt"}),
                       lambda f: f.pop("profile/" + self.photo + ".png")):
            path = self.rewrite(mutate)
            with self.assertRaises(ValueError):
                backup.inspect_archive(self.root, path)
        self.assertEqual((backup.profile_dir(self.root, "Alice") / (self.photo + ".png")).read_bytes(), b"original image bytes")
        self.assertFalse((self.root / "escape.txt").exists())

    def test_reject_newer_version_duplicate_entries_and_changed_file(self):
        def upgrade(files):
            manifest = json.loads(files["manifest.json"]); manifest["version"] = 999
            files["manifest.json"] = json.dumps(manifest).encode()
        with self.assertRaises(ValueError):
            backup.inspect_archive(self.root, self.rewrite(upgrade))
        duplicate = self.rewrite(lambda files: None)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            with zipfile.ZipFile(duplicate, "a") as archive:
                archive.writestr("manifest.json", "{}")
        with self.assertRaises(ValueError):
            backup.inspect_archive(self.root, duplicate)
        preview = backup.inspect_archive(self.root, self.archive)
        self.archive.write_bytes(b"modified after preview")
        with self.assertRaises(ValueError):
            backup.restore_archive(self.root, "Alice", self.archive, preview["archive_sha256"], self.settings, lambda _: None)

    def test_config_write_failure_restores_exact_previous_data(self):
        preview = backup.inspect_archive(self.root, self.archive)
        live = backup.profile_dir(self.root, "Bob")
        live.mkdir(parents=True)
        (live / ("b" * 32 + ".png")).write_bytes(b"Bob photo")
        original = {"theme": "light", "goal": 456}
        calls = []
        def persist(settings):
            calls.append(settings)
            if len(calls) == 1:
                raise OSError("disk write failure")
        with self.assertRaises(OSError):
            backup.restore_archive(self.root, "Bob", self.archive, preview["archive_sha256"], original, persist)
        self.assertEqual(calls[-1], original)
        self.assertEqual([p.name for p in live.iterdir()], ["b" * 32 + ".png"])
        self.assertEqual((live / ("b" * 32 + ".png")).read_bytes(), b"Bob photo")
        self.assertEqual(len(list((self.root / "user_files/backups").glob("*.nosbackup"))), 1)

    def test_malformed_settings_are_not_executable_or_reused_as_paths(self):
        clean = backup.clean_settings({"theme": [], "favorites": ["../bad", "100"], "colors": [],
            "image_dashboard": "../../bad", "images": [{"id": "../bad", "ext": ".png", "name": "bad"}],
            "resources": [{"id": "1", "name": "bad", "path": "javascript:alert(1)", "kind": "link"}]})
        self.assertEqual(clean["favorites"], ["100"])
        self.assertEqual(clean["images"], [])
        self.assertEqual(clean["resources"], [])

    def test_cleanup_failure_cannot_undo_a_committed_restore(self):
        preview = backup.inspect_archive(self.root, self.archive)
        live = backup.profile_dir(self.root, "Bob")
        live.mkdir(parents=True)
        (live / ("b" * 32 + ".png")).write_bytes(b"Before restore")
        original_remove = backup._remove_scratch
        def fail_old_cleanup(path, root):
            if path.name.startswith(".nos-old-"):
                raise PermissionError("temporary file lock")
            original_remove(path, root)
        applied = []
        with patch.object(backup, "_remove_scratch", side_effect=fail_old_cleanup):
            recovery = backup.restore_archive(self.root, "Bob", self.archive, preview["archive_sha256"], {}, applied.append)
        self.assertTrue(recovery.is_file())
        self.assertEqual(len(applied), 1)
        self.assertEqual((live / (self.photo + ".png")).read_bytes(), b"original image bytes")

    def test_custom_greeting_is_sanitized_and_round_trips(self):
        clean = backup.clean_settings({"custom_greeting": "  Cố lên,\n{name}!\t ", "whats_new_seen_version": "1.0.0-beta.3"})
        self.assertEqual(clean["custom_greeting"], "Cố lên, {name}!")
        self.assertEqual(clean["whats_new_seen_version"], "1.0.0-beta.3")
        long_clean = backup.clean_settings({"custom_greeting": "A" * 200, "whats_new_seen_version": "../bad/ver"})
        self.assertEqual(len(long_clean["custom_greeting"]), 120)
        self.assertNotIn("whats_new_seen_version", long_clean)
        bad_clean = backup.clean_settings({"custom_greeting": ["not", "a", "string"]})
        self.assertNotIn("custom_greeting", bad_clean)
        archive = backup.export_archive(
            self.root, "Alice", {
                **self.settings,
                "custom_greeting": "Chào chiến thần Anki",
                "update_notice_muted": True,
                "custom_ui_active": "cui_1",
                "custom_ui_presets": [{
                    "id": "cui_1", "name": "Tối giản", "base": "zen", "columns": "1",
                    "gap": 16, "radius": 20, "width": "compact",
                    "show_greeting": True, "show_goal": False, "greeting_align": "center",
                    "blocks": [
                        {"id": "launchpad", "type": "launchpad", "span": "full", "hidden": False},
                        {"id": "w_note", "type": "memo", "title": "Mục tiêu", "body": "200 thẻ/ngày", "span": "full", "hidden": False},
                    ],
                }],
            },
            self.root / "greeting.nosbackup",
        )
        preview = backup.inspect_archive(self.root, archive)
        applied = []
        backup.restore_archive(self.root, "Bob", archive, preview["archive_sha256"], {}, applied.append)
        self.assertEqual(applied[0]["custom_greeting"], "Chào chiến thần Anki")
        self.assertTrue(applied[0]["update_notice_muted"])
        self.assertEqual(applied[0]["custom_ui_active"], "cui_1")
        self.assertEqual(len(applied[0]["custom_ui_presets"]), 1)
        self.assertEqual(applied[0]["custom_ui_presets"][0]["name"], "Tối giản")

    def test_pomodoro_database_and_audio_round_trip(self):
        from nos_backup_test.pomodoro_store import PomodoroStore, save_custom_sound
        store = PomodoroStore(self.root, "Alice")
        store.start(mode="classic", deck_id="100", deck_name="Languages::English")
        store.answer("100", "Languages::English")
        store.stop("completed")
        snd_src = self.root / "ding.mp3"
        snd_src.write_bytes(b"ID3" + b"\x00" * 48)
        entry = {**save_custom_sound(self.root, "Alice", snd_src), "start_ms": 1250, "duration_ms": 2750}
        settings = {**self.settings, "pomodoro": {"mode": "long", "ui_mode": "ring", "sound_study_end": "custom", "custom_study_sound": entry}}
        archive = backup.export_archive(self.root, "Alice", settings, self.root / "pomo.nosbackup")
        preview = backup.inspect_archive(self.root, archive)
        self.assertGreaterEqual(preview["pomodoro"]["sessions"], 1)
        restored = []
        backup.restore_archive(self.root, "Bob", archive, preview["archive_sha256"], {}, restored.append)
        self.assertEqual(restored[-1]["pomodoro"]["ui_mode"], "ring")
        self.assertEqual(restored[-1]["pomodoro"]["custom_study_sound"], entry)
        bob_audio = backup.profile_dir(self.root, "Bob") / "pomodoro_audio" / f"{entry['id']}.mp3"
        self.assertTrue(bob_audio.is_file())
        self.assertGreaterEqual(PomodoroStore(self.root, "Bob").analytics(period="week")["summary"]["total_cards"], 1)

    def test_size_limits_and_decoder_failure_reject_before_restore(self):
        with patch.object(backup, "MAX_IMAGE_BYTES", 2):
            with self.assertRaises(ValueError):
                backup.inspect_archive(self.root, self.archive)
        with self.assertRaises(ValueError):
            backup.inspect_archive(self.root, self.archive, validate_image=lambda _: (_ for _ in ()).throw(ValueError("bad image")))


if __name__ == "__main__":
    unittest.main()
