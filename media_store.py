"""Persistent, profile-local image library for AnkiNOS.

Images live under Anki's add-on user_files/ directory, which is preserved
across normal add-on updates. No image bytes are written to config.json or
Anki's collection.media, and nothing is uploaded to AnkiWeb.
"""
from __future__ import annotations

from hashlib import sha256
from pathlib import Path
import re
import shutil
from uuid import uuid4

MAX_IMAGE_BYTES = 16 * 1024 * 1024
MAX_IMAGES = 100
FORMATS = {"png": ".png", "jpeg": ".jpg", "jpg": ".jpg", "webp": ".webp"}
SLOTS = ("image_dashboard", "image_overview", "image_review", "image_avatar")
IMAGE_FITS = ("contain", "cover")
IMAGE_POSITIONS = ("center", "top", "bottom", "left", "right")
THUMBNAIL_SUFFIX = "-thumb.png"
_ID = re.compile(r"[0-9a-f]{32}\Z")


def profile_dir(root: Path, profile: str) -> Path:
    digest = sha256(profile.encode("utf-8")).hexdigest()[:20]
    return Path(root) / "user_files" / digest


def valid_images(entries: object) -> list[dict]:
    """Discard malformed configuration entries, including path traversal."""
    if not isinstance(entries, list):
        return []
    result = []
    seen = set()
    for raw in entries[:MAX_IMAGES]:
        if not isinstance(raw, dict):
            continue
        identifier = raw.get("id")
        ext = raw.get("ext")
        name = raw.get("name")
        if (not isinstance(identifier, str) or not _ID.fullmatch(identifier)
                or identifier in seen or not isinstance(ext, str)
                or ext not in set(FORMATS.values()) or not isinstance(name, str)):
            continue
        seen.add(identifier)
        entry = {"id": identifier, "ext": ext, "name": name[:160]}
        # Optional metadata for imports created after the thumbnail upgrade.
        # Older library records remain valid without these fields.
        for field in ("width", "height"):
            value = raw.get(field)
            if type(value) is int and 1 <= value <= 8000:
                entry[field] = value
        size = raw.get("size")
        if type(size) is int and 1 <= size <= MAX_IMAGE_BYTES:
            entry["size"] = size
        result.append(entry)
    return result


def add_image(root: Path, profile: str, source: str | Path, image_format: str,
              *, width: int | None = None, height: int | None = None) -> dict:
    """Store a validated image; caller must use an image decoder to check bytes."""
    ext = FORMATS.get(image_format.lower())
    if not ext:
        raise ValueError("Chỉ hỗ trợ PNG, JPG và WebP.")
    source = Path(source)
    size = source.stat().st_size
    if size <= 0 or size > MAX_IMAGE_BYTES:
        raise ValueError("Ảnh phải có dung lượng từ 1 byte đến 16 MB.")
    directory = profile_dir(root, profile)
    directory.mkdir(parents=True, exist_ok=True)
    identifier = uuid4().hex
    final = directory / (identifier + ext)
    temporary = directory / (identifier + ".tmp")
    try:
        with source.open("rb") as src, temporary.open("xb") as dest:
            shutil.copyfileobj(src, dest, 1024 * 1024)
        temporary.replace(final)
    finally:
        temporary.unlink(missing_ok=True)
    entry = {"id": identifier, "name": source.name[:160], "ext": ext, "size": size}
    if type(width) is int and 1 <= width <= 8000:
        entry["width"] = width
    if type(height) is int and 1 <= height <= 8000:
        entry["height"] = height
    return entry


def delete_image(root: Path, profile: str, entries: object, identifier: str) -> list[dict]:
    images = valid_images(entries)
    entry = next((item for item in images if item["id"] == identifier), None)
    if entry is None:
        raise ValueError("Ảnh không tồn tại trong thư viện.")
    # Only delete a fixed-name file that is registered in this profile.
    directory = profile_dir(root, profile)
    (directory / (entry["id"] + entry["ext"])).unlink(missing_ok=True)
    (directory / (entry["id"] + THUMBNAIL_SUFFIX)).unlink(missing_ok=True)
    return [item for item in images if item["id"] != identifier]


def public_images(root: Path, profile: str, entries: object, package: str) -> list[dict]:
    directory = profile_dir(root, profile)
    # Package names come from Anki, not the WebView.
    if not re.fullmatch(r"[A-Za-z0-9_-]+", package):
        return []
    result = []
    for entry in valid_images(entries):
        filename = entry["id"] + entry["ext"]
        if (directory / filename).is_file():
            url_root = f"/_addons/{package}/user_files/{directory.name}/"
            result.append({
                **entry,
                "url": url_root + filename,
                # Old imports without previews still use their full-resolution
                # original in the gallery, with no destructive migration.
                "thumb_url": (
                    url_root + entry["id"] + THUMBNAIL_SUFFIX
                    if (directory / (entry["id"] + THUMBNAIL_SUFFIX)).is_file()
                    else url_root + filename
                ),
            })
    return result
