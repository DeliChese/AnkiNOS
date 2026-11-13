"""Pure-Python regression tests for AnkiNOS profile image storage.

Run with: python -m unittest discover -s tests -p 'test_media.py'
"""
from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("nos_media_store", ROOT / "media_store.py")
media = importlib.util.module_from_spec(spec)
spec.loader.exec_module(media)


class ImageLibraryTests(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory()
        self.root = Path(self.scratch.name)
        self.source = self.root / "ảnh mùa hè.png"
        self.source.write_bytes(b"PNG test payload (the Qt reader validates images before import)")

    def tearDown(self):
        self.scratch.cleanup()

    def test_import_reuses_immutable_copy_and_survives_source_deletion(self):
        entry = media.add_image(self.root, "Profile 1", self.source, "png")
        original = self.source.read_bytes()
        self.source.unlink()
        stored = media.profile_dir(self.root, "Profile 1") / (entry["id"] + ".png")
        self.assertEqual(stored.read_bytes(), original)
        published = media.public_images(self.root, "Profile 1", [entry], "NOS")
        self.assertEqual(len(published), 1)
        self.assertIn("/_addons/NOS/user_files/", published[0]["url"])
        self.assertNotIn("ảnh mùa hè", published[0]["url"])

    def test_profiles_are_isolated_and_deletion_does_not_touch_original(self):
        entry = media.add_image(self.root, "Alice", self.source, "png")
        self.assertEqual(media.public_images(self.root, "Bob", [entry], "NOS"), [])
        remaining = media.delete_image(self.root, "Alice", [entry], entry["id"])
        self.assertEqual(remaining, [])
        self.assertTrue(self.source.is_file())
        self.assertEqual(media.public_images(self.root, "Alice", [entry], "NOS"), [])

    def test_invalid_ids_extensions_and_types_cannot_escape_media_folder(self):
        valid = media.add_image(self.root, "Alice", self.source, "jpeg")
        invalid = [{"id": "../../outside", "ext": ".png", "name": "bad"},
                   {"id": "a" * 32, "ext": ["bad"], "name": "bad"},
                   {"id": "a" * 32, "ext": "../.json", "name": "bad"},
                   {"id": "b" * 32, "ext": ".png", "name": 4}]
        self.assertEqual(media.valid_images([*invalid, valid]), [valid])
        with self.assertRaises(ValueError):
            media.delete_image(self.root, "Alice", [valid], "../../outside")
        self.assertTrue(self.source.is_file())
        self.assertEqual(media.public_images(self.root, "Alice", [valid], "../../../bad"), [])

    def test_thumbnail_and_metadata_preserve_original(self):
        entry = media.add_image(self.root, "Alice", self.source, "png", width=1200, height=800)
        self.assertEqual((entry["width"], entry["height"], entry["size"]), (1200, 800, self.source.stat().st_size))
        directory = media.profile_dir(self.root, "Alice")
        preview = directory / (entry["id"] + media.THUMBNAIL_SUFFIX)
        preview.write_bytes(b"small preview")
        published = media.public_images(self.root, "Alice", [entry], "NOS")[0]
        self.assertTrue(published["thumb_url"].endswith("-thumb.png"))
        self.assertNotEqual(published["thumb_url"], published["url"])
        media.delete_image(self.root, "Alice", [entry], entry["id"])
        self.assertFalse(preview.exists())
        self.assertTrue(self.source.exists())

    def test_legacy_library_without_thumbnails_stays_valid(self):
        entry = media.add_image(self.root, "Old", self.source, "png")
        legacy = {key:entry[key] for key in ("id", "name", "ext")}
        item = media.public_images(self.root, "Old", [legacy], "NOS")[0]
        self.assertEqual(item["thumb_url"], item["url"])
        self.assertEqual(media.valid_images([legacy]), [legacy])

    def test_bad_metadata_is_ignored(self):
        entry = media.add_image(self.root, "Alice", self.source, "png")
        entry.update({"width": -1, "height": True, "size": 9999999999})
        clean = media.valid_images([entry])[0]
        self.assertNotIn("width", clean)
        self.assertNotIn("height", clean)
        self.assertNotIn("size", clean)

    def test_album_metadata_sanitization_and_photo_grouping(self):
        from uuid import uuid4
        first = uuid4().hex
        album = {"id": first, "name": "  Phong cảnh  "}
        self.assertEqual(media.valid_albums([album, album]), [{"id": first, "name": "Phong cảnh"}])
        self.assertEqual(media.valid_albums([{"id":"../", "name":"Bad"}, {"id":first, "name":"\x00Bad"}]), [])
        entry=media.add_image(self.root, "Alice", self.source, "png")
        entry["album_id"]=first
        stored=media.valid_images([entry])[0]
        self.assertEqual(stored["album_id"],first)
        self.assertEqual(media.public_images(self.root, "Alice", [stored], "NOS")[0]["album_id"],first)
        self.assertFalse(any("album_id" in x for x in media.valid_images([{**entry, "album_id": "../evil"}])))

    def test_size_limit_format_and_unique_ids(self):
        with self.assertRaises(ValueError):
            media.add_image(self.root, "Alice", self.source, "svg")
        first = media.add_image(self.root, "Alice", self.source, "png")
        second = media.add_image(self.root, "Alice", self.source, "png")
        self.assertNotEqual(first["id"], second["id"])
        self.assertEqual(len(media.valid_images([first, first, second])), 2)
        oversized = self.root / "big.jpg"
        with oversized.open("wb") as handle:
            handle.truncate(media.MAX_IMAGE_BYTES + 1)
        with self.assertRaises(ValueError):
            media.add_image(self.root, "Alice", oversized, "jpeg")


if __name__ == "__main__":
    unittest.main()
