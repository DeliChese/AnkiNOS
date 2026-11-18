"""Profile theme preferences shared by the UI bridge and backup validation."""
import re

THEME_MODES = {"dusk", "night", "oled", "light", "system"}
COLOR_THEMES = {"nos", "tokyo", "mononoke", "catppuccin", "rosepine", "nord", "solarized", "dracula"}
ACCENTS = {"auto", "blue", "cyan", "mint", "purple", "amber", "pink", "custom"}
THEME_DEFAULTS = {"theme": "dusk", "color_theme": "nos", "accent": "blue", "custom_accent": "#83b8ff"}


def clean_theme_settings(raw: object) -> dict:
    if not isinstance(raw, dict):
        return {}
    result = {}
    for key, choices in (("theme", THEME_MODES), ("color_theme", COLOR_THEMES), ("accent", ACCENTS)):
        value = raw.get(key)
        if isinstance(value, str) and value in choices:
            result[key] = value
    custom = raw.get("custom_accent")
    if isinstance(custom, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", custom):
        result["custom_accent"] = custom.lower()
    return result
