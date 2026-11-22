from __future__ import annotations

from pathlib import Path


PROMPT_VERSION = "1.3.0"
PROMPT_DIR = Path(__file__).resolve().parent / "prompts"


def load_system_prompt() -> str:
    return (PROMPT_DIR / "system_base.md").read_text(encoding="utf-8")


def load_task_prompt(name: str) -> str:
    allowed = {
        "fill_blank", "synonym_antonym", "word_form", "nuance",
        "writing_free", "writing_grading",
        "recall", "multiple_choice", "application", "application_grading", "listening", "sentence", "explain", "phrase",
    }
    if name not in allowed:
        raise ValueError("Loại prompt không được hỗ trợ: {}".format(name))
    return (PROMPT_DIR / (name + ".md")).read_text(encoding="utf-8")
