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
            "image_dashboard": self.photo, "favorites": ["100"], "colors": {"100": "blue"}, "last_study_deck": "100"}
        folder = backup.profile_dir(self.root, "Alice")
        folder.mkdir(parents=True)
        (folder / (self.photo + ".png")).write_bytes(b"original image bytes")
        (folder / (self.photo + "-thumb.png")).write_bytes(b"thumbnail bytes")
        focus = Focus(self.root, "Alice")
        focus.start(30); focus.answer(); focus.stop()
        self.archive = backup.export_archive(self.root, "Alice", self.settings, self.root / "archive.nosbackup", deck_names={"100": "Languages::English"})

    def tearDown(self):
        self.tmp.cleanup()

    def rewrite(self, mutate):
        path = self.root / "changed.nosbackup"
        with zipfile.ZipFile(self.archive) as archive:
            files = {name: archive.read(name) for name in archive.namelist()}
        mutate(files)
        with zipfile.ZipFile(path, "w") as archive:
            for name, data in files.items():
                archive.writestr(name, data)
        return path

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

    def test_size_limits_and_decoder_failure_reject_before_restore(self):
        with patch.object(backup, "MAX_IMAGE_BYTES", 2):
            with self.assertRaises(ValueError):
                backup.inspect_archive(self.root, self.archive)
        with self.assertRaises(ValueError):
            backup.inspect_archive(self.root, self.archive, validate_image=lambda _: (_ for _ in ()).throw(ValueError("bad image")))


if __name__ == "__main__":
    unittest.main()
