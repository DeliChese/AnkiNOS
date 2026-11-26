"""Azure Speech synthesis with a profile-local, quota-limited MP3 cache."""

from __future__ import annotations

import hashlib
import re
import urllib.error
import urllib.request
from threading import Lock
from datetime import datetime, timedelta, timezone
from html import escape
from pathlib import Path

from .db.connection import Database, utc_now

MAX_AUDIO_BYTES = 4 * 1024 * 1024
MAX_PROFILE_AUDIO_BYTES = 1_500_000_000
PROFILE_AUDIO_TARGET_BYTES = 1_200_000_000
_lock_registry: dict[Path, Lock] = {}
_registry_lock = Lock()
VOICES = {
    "en-US": "en-US-JennyNeural",
    "en-GB": "en-GB-SoniaNeural",
    "vi-VN": "vi-VN-HoaiMyNeural",
    "ja-JP": "ja-JP-NanamiNeural",
    "zh-CN": "zh-CN-XiaoxiaoNeural",
    "fr-FR": "fr-FR-DeniseNeural",
    "de-DE": "de-DE-KatjaNeural",
    "es-ES": "es-ES-ElviraNeural",
}
SPEEDS = {"0.7": "-30%", "0.85": "-15%", "1": "0%", "slow-normal": "-30%"}


def cache_key(sentence: str, voice: str, speed: str) -> str:
    return hashlib.sha256((sentence + "\0" + voice + "\0" + speed).encode("utf-8")).hexdigest()


def cleanup_audio(database: Database, directory: Path, target_bytes: int,
                  preserve_newer_days: int = 0) -> dict:
    """Discard oldest unpinned cache entries, protecting pending and due listening work."""
    total = sum(path.stat().st_size for path in directory.glob("*.mp3") if path.is_file())
    original = total
    removed = 0
    if total <= target_bytes:
        return {"removed": 0, "freed_bytes": 0, "total_bytes": total}
    cutoff = (datetime.now(timezone.utc) - timedelta(days=preserve_newer_days)).isoformat(
        timespec="seconds").replace("+00:00", "Z")
    with database.immediate() as connection:
        rows = connection.execute(
            "SELECT ac.hash,ac.filename,ac.byte_size FROM audio_cache ac WHERE ac.created_at<=? "
            "AND NOT EXISTS (SELECT 1 FROM listening_items li WHERE li.audio_hash=ac.hash AND li.pinned=1) "
            "AND NOT EXISTS (SELECT 1 FROM listening_items li JOIN mistakes m "
            "ON m.deck_name=li.deck_name AND m.corrected_text=li.sentence "
            "WHERE li.audio_hash=ac.hash AND m.kind='listening' AND m.mastered=0) "
            "AND NOT EXISTS (SELECT 1 FROM listening_items li JOIN exercises e "
            "ON e.exercise_type='listening' AND e.status='generated' "
            "AND json_extract(e.exercise_payload,'$.question_prompt')=li.sentence "
            "WHERE li.audio_hash=ac.hash) ORDER BY ac.created_at,ac.hash", (cutoff,),
        ).fetchall()
        for row in rows:
            if total <= target_bytes:
                break
            path = directory / row["filename"]
            if path.name != f"{row['hash']}.mp3":
                continue
            size = path.stat().st_size if path.is_file() else row["byte_size"]
            try:
                path.unlink(missing_ok=True)
            except OSError:
                continue
            connection.execute("DELETE FROM listening_items WHERE audio_hash=? AND pinned=0", (row["hash"],))
            connection.execute("DELETE FROM audio_cache WHERE hash=?", (row["hash"],))
            total = max(0, total - size)
            removed += 1
    return {"removed": removed, "freed_bytes": original - total, "total_bytes": total}


def synthesize(sentence: str, voice: str, speed: str, region: str, key: str,
               timeout: int = 30) -> bytes:
    if not re.fullmatch(r"[a-z0-9-]{2,40}", region):
        raise ValueError("Khu vực Azure không hợp lệ.")
    if voice not in VOICES.values() or speed not in SPEEDS:
        raise ValueError("Giọng hoặc tốc độ không hợp lệ.")
    language = next(locale for locale, name in VOICES.items() if name == voice)
    spoken = f'<prosody rate="{SPEEDS[speed]}">{escape(sentence)}</prosody>'
    if speed == "slow-normal":
        spoken += f'<break time="600ms"/><prosody rate="0%">{escape(sentence)}</prosody>'
    ssml = (
        f'<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="{language}">'
        f'<voice name="{voice}">'
        f'{spoken}'
        '</voice></speak>'
    )
    request = urllib.request.Request(
        f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1",
        data=ssml.encode("utf-8"),
        headers={
            "Ocp-Apim-Subscription-Key": key,
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": "audio-16khz-32kbitrate-mono-mp3",
            "User-Agent": "AnkiNOS-BrainExer",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            audio = response.read(MAX_AUDIO_BYTES + 1)
    except urllib.error.HTTPError as error:
        raise ValueError(f"Azure Speech trả lỗi HTTP {error.code}. Kiểm tra khóa, khu vực và hạn mức.") from error
    except (urllib.error.URLError, TimeoutError) as error:
        raise ValueError("Không kết nối được Azure Speech.") from error
    if not audio:
        raise ValueError(f"Azure Speech không trả audio. Hãy kiểm tra giọng {voice} có phù hợp ngôn ngữ câu nghe.")
    if len(audio) > MAX_AUDIO_BYTES:
        raise ValueError("Audio Azure vượt quá giới hạn dung lượng.")
    if not (audio.startswith(b"ID3") or audio[:1] == b"\xff"):
        raise ValueError("Azure Speech không trả về audio MP3 hợp lệ.")
    return audio


def cached_audio(database: Database, directory: Path, sentence: str, voice: str, speed: str,
                 region: str, key: str, monthly_limit: int) -> str:
    with _registry_lock:
        lock = _lock_registry.setdefault(directory.resolve(), Lock())
    with lock:
        return _cached_audio_locked(database, directory, sentence, voice, speed,
                                    region, key, monthly_limit)


def _cached_audio_locked(database: Database, directory: Path, sentence: str, voice: str, speed: str,
                         region: str, key: str, monthly_limit: int) -> str:
    digest = cache_key(sentence, voice, speed)
    path = directory / f"{digest}.mp3"
    if path.is_file():
        return digest
    billed_chars = len(sentence) * (2 if speed == "slow-normal" else 1)
    month = datetime.now().astimezone().strftime("%Y-%m")
    with database.immediate() as connection:
        usage = connection.execute("SELECT chars FROM tts_usage WHERE month=?", (month,)).fetchone()
        if (usage[0] if usage else 0) + billed_chars > monthly_limit:
            raise ValueError("Đã đạt giới hạn ký tự Azure Speech trong tháng.")
    audio = synthesize(sentence, voice, speed, region, key)
    total = sum(path.stat().st_size for path in directory.glob("*.mp3") if path.is_file())
    if total + len(audio) > MAX_PROFILE_AUDIO_BYTES:
        total = cleanup_audio(database, directory, PROFILE_AUDIO_TARGET_BYTES,
                              preserve_newer_days=1)["total_bytes"]
        if total + len(audio) > MAX_PROFILE_AUDIO_BYTES:
            raise ValueError("Thư viện audio gần đầy. Hãy dọn các câu chưa ghim trong Thư viện.")
    with database.immediate() as connection:
        if path.is_file():
            return digest
        usage = connection.execute("SELECT chars FROM tts_usage WHERE month=?", (month,)).fetchone()
        if (usage[0] if usage else 0) + billed_chars > monthly_limit:
            raise ValueError("Đã đạt giới hạn ký tự Azure Speech trong tháng.")
        directory.mkdir(parents=True, exist_ok=True)
        temporary = directory / f".{digest}.tmp"
        try:
            temporary.write_bytes(audio)
            temporary.replace(path)
            connection.execute(
                "INSERT INTO audio_cache(hash,filename,voice,speed,chars,byte_size,created_at) "
                "VALUES(?,?,?,?,?,?,?) ON CONFLICT(hash) DO NOTHING",
                (digest, path.name, voice, speed, billed_chars, len(audio), utc_now()),
            )
            connection.execute(
                "INSERT INTO tts_usage(month,chars) VALUES(?,?) "
                "ON CONFLICT(month) DO UPDATE SET chars=chars+excluded.chars",
                (month, billed_chars),
            )
        except Exception:
            path.unlink(missing_ok=True)
            raise
        finally:
            temporary.unlink(missing_ok=True)
    return digest
