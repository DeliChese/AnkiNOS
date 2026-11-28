#!/usr/bin/env python3
"""Build a clean, reproducible .ankiaddon archive for AnkiNOS.

Usage:
    python scripts/build-addon.py --dry-run   # List files that would be packaged (writes nothing)
    python scripts/build-addon.py             # Write dist/AnkiNOS-<version>.ankiaddon
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
import zipfile

ROOT = Path(__file__).resolve().parent.parent

EXCLUDED_DIRS = {
    ".git",
    ".github",
    ".agents",
    ".claude",
    "__pycache__",
    "dist",
    "docs",
    "previews",
    "scripts",
    "tests",
    "user_files",
}

EXCLUDED_FILES = {
    ".gitignore",
    "AGENTS.md",
    "CLAUDE.md",
    "ankios-ui.original.html",
    "assets/background-prompt.txt",
    "meta.json",
}

EXCLUDED_SUFFIXES = {
    ".ankiaddon",
    ".log",
    ".orig",
    ".patch",
    ".pyc",
    ".pyo",
    ".sqlite3",
    ".tmp",
}

REQUIRED_FILES = {
    "__init__.py",
    "manifest.json",
    "config.json",
    "LICENSE",
    "README.md",
    "ankios-ui.html",
    "ankios-overview.html",
    "ankios-review.html",
    "ankios-tools.html",
    "assets/dashboard.js",
    "assets/i18n.js",
    "assets/i18n-en.js",
    "assets/i18n-zh-cn.js",
    "assets/theme.js",
}


def collect_files(root: Path = ROOT) -> list[Path]:
    files: list[Path] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(root)
        if any(part in EXCLUDED_DIRS for part in rel.parts[:-1]):
            continue
        if rel.name in EXCLUDED_FILES or rel.as_posix() in EXCLUDED_FILES:
            continue
        if path.suffix.lower() in EXCLUDED_SUFFIXES:
            continue
        files.append(rel)
    return files


def read_manifest(root: Path = ROOT) -> dict:
    manifest_path = root / "manifest.json"
    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not data.get("package") or not data.get("version"):
        raise ValueError("manifest.json must specify both 'package' and 'version'")
    return data


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Package AnkiNOS into a clean .ankiaddon zip.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate and print files that would be archived without writing any file.",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help="Optional output path (defaults to dist/AnkiNOS-<version>.ankiaddon).",
    )
    args = parser.parse_args(argv)

    manifest = read_manifest(ROOT)
    files = collect_files(ROOT)
    rel_set = {f.as_posix() for f in files}
    missing = sorted(REQUIRED_FILES - rel_set)
    if missing:
        print(f"ERROR: Missing required add-on files: {', '.join(missing)}", file=sys.stderr)
        return 1

    total_bytes = sum((ROOT / f).stat().st_size for f in files)
    version = manifest["version"]
    out_path = args.out or (ROOT / "dist" / f"AnkiNOS-{version}.ankiaddon")

    if args.dry_run:
        print(f"DRY RUN: AnkiNOS v{version} -> {out_path.relative_to(ROOT) if out_path.is_relative_to(ROOT) else out_path}")
        print(f"Files: {len(files)} · Uncompressed size: {total_bytes / 1024:.1f} KB")
        for rel in files:
            print(f"  + {rel.as_posix()}")
        return 0

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for rel in files:
            zf.write(ROOT / rel, arcname=rel.as_posix())
    archive_kb = out_path.stat().st_size / 1024
    print(f"Built {out_path} ({len(files)} files, {archive_kb:.1f} KB compressed)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
