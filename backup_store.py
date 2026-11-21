"""Versioned, local AnkiNOS profile archives. No Anki collection is included."""
from __future__ import annotations

from datetime import datetime, timezone
from contextlib import closing
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import stat
import tempfile
from uuid import uuid4
import zipfile

from .media_store import (IMAGE_FITS, MAX_IMAGE_BYTES, SLOTS, WALLPAPER_BLUR_MAX, WALLPAPER_DIM_MAX,
                          profile_dir, valid_albums, valid_images)

from .theme_settings import clean_theme_settings

FORMAT = "AnkiNOS-profile"
MAX_TOTAL = 2 * 1024**3
MAX_FILES = 310
MAX_CONFIG = 4 * 1024**2
FILE_NAME = re.compile(r"(?:[0-9a-f]{32}(?:-thumb|-wall)?\.(?:png|jpg|webp)|(?:focus|learning|workspace|brainexer)\.sqlite3)\Z")
DATABASES = {"focus.sqlite3", "learning.sqlite3", "workspace.sqlite3", "brainexer.sqlite3"}


def _file_limit(name: str) -> int:
    return (64 if name=="focus.sqlite3" else 256)*1024**2 if name in DATABASES else MAX_IMAGE_BYTES


def _check_database(name: str, path: Path) -> dict:
    if name=="focus.sqlite3":
        return {"sessions":_check_focus(path)}
    if name=="learning.sqlite3":
        from .legacy_learning_backup import validate_database
    elif name=="brainexer.sqlite3":
        from .brainexer.db.connection import validate_database
    else:
        from .workspace_store import validate_database
    return validate_database(path)


def clean_settings(raw: object) -> dict:
    if not isinstance(raw, dict):
        raise ValueError("Cấu hình trong gói sao lưu không hợp lệ.")
    result = clean_theme_settings(raw)
    for key in ("activity_collapsed", "library_collapsed", "sidebar_collapsed", "blur", "animations",
                "lite_mode", "stat_retention", "stat_pace", "stat_time", "stat_studied"):
        if type(raw.get(key)) is bool:
            result[key] = raw[key]
    for key, allowed in {"view": {"list", "grid"},
        "heatmap_day": {"monday", "sunday"}, "heatmap_palette": {"default", "green", "orange", "purple"}}.items():
        if isinstance(raw.get(key), str) and raw[key] in allowed:
            result[key] = raw[key]
    for key, allowed in (("ui_scale", {85, 90, 100, 110, 120}), ("study_budget", {15, 30, 60})):
        if type(raw.get(key)) is int and raw[key] in allowed:
            result[key] = raw[key]
    if type(raw.get("goal")) is int and 1 <= raw["goal"] <= 100000:
        result["goal"] = raw["goal"]
    for key, limit in (("wallpaper_dim", WALLPAPER_DIM_MAX), ("wallpaper_blur", WALLPAPER_BLUR_MAX)):
        if type(raw.get(key)) is int and 0 <= raw[key] <= limit:
            result[key] = raw[key]
    for surface in ("dashboard", "overview", "review"):
        if raw.get("image_fit_" + surface) in IMAGE_FITS:
            result["image_fit_" + surface] = raw["image_fit_" + surface]
    result["images"] = valid_images(raw.get("images"))
    result["image_albums"] = valid_albums(raw.get("image_albums"))
    image_ids = {entry["id"] for entry in result["images"]}
    for slot in SLOTS:
        result[slot] = raw.get(slot) if isinstance(raw.get(slot), str) and raw[slot] in image_ids else None
    def deck_id(value):
        return isinstance(value, str) and bool(re.fullmatch(r"[1-9][0-9]{0,18}", value))
    result["favorites"] = list(dict.fromkeys(x for x in raw.get("favorites", []) if deck_id(x)))[:10000] if isinstance(raw.get("favorites"), list) else []
    colors = raw.get("colors", {})
    result["colors"] = {k: v for k, v in colors.items() if deck_id(k) and isinstance(v, str) and v in {"blue", "purple", "pink", "green", "amber"}} if isinstance(colors, dict) else {}
    if deck_id(raw.get("last_study_deck")):
        result["last_study_deck"] = raw["last_study_deck"]
    resources = raw.get("resources", [])
    result["resources"] = []
    for item in resources[:1000] if isinstance(resources, list) else []:
        if not isinstance(item, dict) or not all(isinstance(item.get(k), str) for k in ("id", "name", "path", "kind")):
            continue
        if len(item["path"]) > 8192 or any(ord(c) < 32 for c in item["path"]):
            continue
        if item["kind"] == "link" and not item["path"].lower().startswith(("https://", "http://")):
            continue
        result["resources"].append({"id": item["id"][:80], "name": item["name"][:160],
            "path": item["path"], "kind": item["kind"][:20], "detail": str(item.get("detail", ""))[:160]})
    return result


def _safe_dir(root: Path, profile: str) -> Path:
    root = Path(root).resolve()
    directory = profile_dir(root, profile)
    if directory.is_symlink() or not directory.resolve().is_relative_to(root) or directory.resolve().parent != (root / "user_files").resolve():
        raise ValueError("Thư mục dữ liệu hồ sơ không an toàn.")
    return directory


def _hash_file(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024**2), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _remove_scratch(path: Path, root: Path) -> None:
    if not path.resolve().is_relative_to(root.resolve()) or not path.name.startswith(".nos-"):
        raise ValueError("Thư mục tạm không hợp lệ.")
    if path.exists():
        shutil.rmtree(path)


def _check_focus(path: Path) -> int:
    with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)) as db:
        if db.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise ValueError("Lịch sử Focus bị hỏng.")
        objects = db.execute("SELECT type,name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").fetchall()
        if objects != [("table", "sessions")]:
            raise ValueError("Cấu trúc lịch sử Focus không được hỗ trợ.")
        columns = {row[1] for row in db.execute("PRAGMA table_info(sessions)")}
        if columns != {"id", "started_at", "ended_at", "seconds", "target_seconds", "cards", "status"}:
            raise ValueError("Cột dữ liệu Focus không hợp lệ.")
        invalid = db.execute("""SELECT count(*) FROM sessions WHERE
            typeof(id)!='integer' OR typeof(started_at)!='text'
            OR (ended_at IS NOT NULL AND typeof(ended_at)!='text')
            OR typeof(seconds) NOT IN ('integer','real') OR seconds<0 OR seconds>target_seconds
            OR typeof(target_seconds)!='integer' OR target_seconds NOT IN (300,900,1500,1800,2700,3600,5400)
            OR typeof(cards)!='integer' OR cards<0
            OR status NOT IN ('running','paused','completed','stopped','interrupted')""").fetchone()[0]
        if invalid:
            raise ValueError("Lịch sử Focus chứa phiên không hợp lệ.")
        return int(db.execute("SELECT count(*) FROM sessions").fetchone()[0])


def export_archive(root: Path, profile: str, settings: dict, destination: Path, *, deck_names: dict | None = None) -> Path:
    root, destination = Path(root).resolve(), Path(destination).resolve()
    directory = _safe_dir(root, profile)
    # Backups must not recursively include themselves in the managed profile.
    if destination.is_relative_to(directory.resolve()):
        raise ValueError("Hãy lưu gói sao lưu bên ngoài thư mục dữ liệu hồ sơ.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    scratch = Path(tempfile.mkdtemp(prefix=".nos-export-", dir=root))
    temporary = destination.with_name(destination.name + "." + uuid4().hex + ".tmp")
    try:
        config = clean_settings(settings)
        sources = {}
        if directory.is_dir():
            for path in directory.iterdir():
                if FILE_NAME.fullmatch(path.name):
                    if path.is_symlink() or path.resolve().parent != directory.resolve():
                        raise ValueError("Không sao lưu liên kết ngoài thư mục hồ sơ.")
                    if path.is_file():
                        sources[path.name] = path
        if len(sources) > MAX_FILES - 1:
            raise ValueError("Gói sao lưu có quá nhiều tệp.")
        for name in DATABASES.intersection(sources):
            snapshot = scratch / name
            with closing(sqlite3.connect(sources[name].as_uri() + "?mode=ro", uri=True)) as src, closing(sqlite3.connect(snapshot)) as target:
                src.backup(target)
            _check_database(name,snapshot)
            sources[name] = snapshot
        for entry in config["images"]:
            if entry["id"] + entry["ext"] not in sources:
                raise ValueError("Thiếu ảnh trong thư viện: " + entry["name"])
        sizes = {name: path.stat().st_size for name, path in sources.items()}
        if sum(sizes.values()) > MAX_TOTAL or any(size > _file_limit(name) for name, size in sizes.items()):
            raise ValueError("Dữ liệu vượt giới hạn dung lượng sao lưu.")
        manifest = {"format": FORMAT, "version": 3 if "brainexer.sqlite3" in sources else 2, "profile": profile,
            "created_at": datetime.now(timezone.utc).isoformat(), "settings": config,
            "deck_names": {str(k): str(v) for k, v in (deck_names or {}).items()},
            "files": {name: {"size": sizes[name], "sha256": _hash_file(path)} for name, path in sources.items()}}
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False).encode("utf-8"))
            for name, path in sources.items():
                archive.write(path, "profile/" + name)
        os.replace(temporary, destination)
        return destination
    finally:
        temporary.unlink(missing_ok=True)
        _remove_scratch(scratch, root)


def _read_archive(path: Path, stage: Path) -> dict:
    with zipfile.ZipFile(path) as archive:
        infos = archive.infolist()
        names = [entry.filename for entry in infos]
        if len(infos) > MAX_FILES or len(names) != len(set(names)) or "manifest.json" not in names:
            raise ValueError("Danh sách tệp sao lưu không hợp lệ.")
        for entry in infos:
            if entry.flag_bits & 1 or stat.S_ISLNK(entry.external_attr >> 16):
                raise ValueError("Không hỗ trợ tệp mã hóa hoặc liên kết.")
            if entry.filename != "manifest.json" and not (entry.filename.startswith("profile/") and FILE_NAME.fullmatch(entry.filename[8:])):
                raise ValueError("Gói sao lưu chứa đường dẫn hoặc tệp không được hỗ trợ.")
        if archive.getinfo("manifest.json").file_size > MAX_CONFIG or sum(x.file_size for x in infos) > MAX_TOTAL:
            raise ValueError("Gói sao lưu vượt giới hạn dung lượng.")
        manifest = json.loads(archive.read("manifest.json"))
        if not isinstance(manifest, dict) or manifest.get("format") != FORMAT or type(manifest.get("version")) is not int or manifest["version"] not in {1,2,3}:
            raise ValueError("Định dạng hoặc phiên bản gói sao lưu không được hỗ trợ.")
        manifest["settings"] = clean_settings(manifest.get("settings"))
        files = manifest.get("files")
        if not isinstance(files, dict) or set(names) != {"manifest.json", *("profile/" + name for name in files)}:
            raise ValueError("Nội dung gói sao lưu không khớp bản kê.")
        if "brainexer.sqlite3" in files and manifest["version"] < 3:
            raise ValueError("Phiên bản gói sao lưu không hỗ trợ dữ liệu BrainExer.")
        for name, meta in files.items():
            if not FILE_NAME.fullmatch(name) or not isinstance(meta, dict):
                raise ValueError("Bản kê tệp không hợp lệ.")
            info = archive.getinfo("profile/" + name)
            limit = _file_limit(name)
            if info.file_size > limit or info.file_size != meta.get("size"):
                raise ValueError("Dung lượng tệp không khớp bản kê.")
            target = stage / name
            with archive.open(info) as source, target.open("xb") as dest:
                shutil.copyfileobj(source, dest, 1024**2)
            if _hash_file(target) != meta.get("sha256"):
                raise ValueError("Tệp sao lưu không vượt qua kiểm tra toàn vẹn.")
        for image in manifest["settings"]["images"]:
            if image["id"] + image["ext"] not in files:
                raise ValueError("Gói sao lưu thiếu ảnh đã đăng ký.")
        manifest["focus_sessions"] = _check_focus(stage / "focus.sqlite3") if "focus.sqlite3" in files else 0
        for name in ("learning.sqlite3","workspace.sqlite3","brainexer.sqlite3"):
            manifest[name.split('.')[0]] = _check_database(name,stage/name) if name in files else {}
        if not isinstance(manifest.get("deck_names", {}), dict):
            raise ValueError("Danh sách bộ thẻ không hợp lệ.")
        return manifest


def inspect_archive(root: Path, path: Path, *, validate_image=None) -> dict:
    root, path = Path(root).resolve(), Path(path).resolve()
    stage = Path(tempfile.mkdtemp(prefix=".nos-inspect-", dir=root))
    try:
        expected_hash = _hash_file(path)
        manifest = _read_archive(path, stage)
        if validate_image:
            for name in manifest["files"]:
                if name not in DATABASES:
                    validate_image(stage / name)
        if _hash_file(path) != expected_hash:
            raise ValueError("Gói sao lưu đã thay đổi trong khi đọc. Hãy chọn lại.")
        return {**manifest, "archive_sha256": _hash_file(path)}
    finally:
        _remove_scratch(stage, root)


def restore_archive(root: Path, profile: str, path: Path, expected_hash: str, current_settings: dict,
                    apply_settings, *, deck_names: dict | None = None) -> Path:
    """Stage/validate first, back up current state, swap, roll back on failure."""
    root, path = Path(root).resolve(), Path(path).resolve()
    live = _safe_dir(root, profile)
    live.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=".nos-restore-", dir=live.parent))
    old = live.parent / (".nos-old-" + uuid4().hex)
    swapped = False
    try:
        if _hash_file(path) != expected_hash:
            raise ValueError("Gói sao lưu đã thay đổi. Hãy chọn lại để xem trước.")
        manifest = _read_archive(path, stage)
        if _hash_file(path) != expected_hash:
            raise ValueError("Gói sao lưu đã thay đổi trong khi đọc. Hãy chọn lại.")
        backup = root / "user_files" / "backups" / ("before-restore-" + datetime.now().strftime("%Y%m%d-%H%M%S-") + uuid4().hex[:8] + ".nosbackup")
        export_archive(root, profile, current_settings, backup, deck_names=deck_names)
        restored = manifest["settings"]
        # IDs differ across collections. Remap by full deck names, never guess.
        if deck_names is not None:
            current = {name: str(did) for did, name in deck_names.items()}
            mapping = {str(did): current.get(name) for did, name in manifest.get("deck_names", {}).items() if isinstance(name, str)}
            restored["favorites"] = [mapping[x] for x in restored["favorites"] if mapping.get(x)]
            restored["colors"] = {mapping[k]: v for k, v in restored["colors"].items() if mapping.get(k)}
            restored["last_study_deck"] = mapping.get(restored.get("last_study_deck"))
        # Unknown profile files are preserved; archives never overwrite them.
        if live.exists():
            for extra in live.iterdir():
                if any(extra.name==name+suffix for name in DATABASES for suffix in ("-wal","-shm","-journal")):
                    continue
                if not FILE_NAME.fullmatch(extra.name):
                    if not extra.is_file() or extra.is_symlink():
                        raise ValueError("Thư mục hồ sơ chứa mục chưa hỗ trợ khôi phục.")
                    shutil.copy2(extra, stage / extra.name)
            if live.resolve().parent != (root / "user_files").resolve():
                raise ValueError("Thư mục đích nằm ngoài dữ liệu AnkiNOS.")
            os.replace(live, old)
        os.replace(stage, live)
        swapped = True
        apply_settings(restored)
        try:
            _remove_scratch(old, live.parent)
        except OSError:
            # The restore is committed. Cleanup failure must not roll back to
            # a directory that may already be partially removed.
            pass
        return backup
    except Exception:
        if swapped:
            _remove_scratch(live.rename(live.parent / (".nos-failed-" + uuid4().hex)), live.parent)
        if old.exists():
            os.replace(old, live)
        if swapped:
            apply_settings(current_settings)
        raise
    finally:
        _remove_scratch(stage, live.parent)
