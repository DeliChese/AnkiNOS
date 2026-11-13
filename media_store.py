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
                or identifier in seen or ext not in set(FORMATS.values())
                or not isinstance(name, str)):
            continue
        seen.add(identifier)
        result.append({"id": identifier, "ext": ext, "name": name[:160]})
    return result


def add_image(root: Path, profile: str, source: str | Path, image_format: str) -> dict:
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
    return {"id": identifier, "name": source.name[:160], "ext": ext}


def delete_image(root: Path, profile: str, entries: object, identifier: str) -> list[dict]:
    images = valid_images(entries)
    entry = next((item for item in images if item["id"] == identifier), None)
    if entry is None:
        raise ValueError("Ảnh không tồn tại trong thư viện.")
    # Only delete a fixed-name file that is registered in this profile.
    (profile_dir(root, profile) / (entry["id"] + entry["ext"])).unlink(missing_ok=True)
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
            result.append({**entry, "url": f"/_addons/{package}/user_files/{directory.name}/{filename}"})
    return result
