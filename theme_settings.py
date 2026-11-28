"""Profile appearance preferences shared by the UI bridge and backups."""
import re

THEME_MODES = {"dusk", "night", "oled", "light", "system"}
COLOR_THEMES = {
    "nos", "tokyo", "mononoke", "catppuccin", "rosepine", "nord", "solarized", "dracula",
    "gruvbox", "everforest", "kanagawa", "sakura",
    "matcha", "synthwave", "espresso", "oceanic",
}
ACCENTS = {"auto", "blue", "cyan", "mint", "purple", "amber", "pink", "custom"}
TEXT_COLOR_MODES = {"auto", "custom"}
THEME_COLOR_ROLES = ("surface", "primary", "success", "warning", "danger")
DEFAULT_TEXT_COLOR = "#f3f6ff"
RATING_COLOR_MODES = {"auto", "custom"}
DEFAULT_RATING_COLORS = {
    "rating_color_again": "#f26d85",
    "rating_color_hard": "#f0b85b",
    "rating_color_good": "#6ea8fe",
    "rating_color_easy": "#4fd19b",
}
DEFAULT_REVIEWER_CARD_OPACITY = 100
DEFAULT_FONT = "system"
FONT_FAMILIES = {"system", "humanist", "geometric", "clean", "serif", "literary", "rounded", "mono"}
DEFAULT_LAYOUT = "aurora"
DASHBOARD_LAYOUTS = {DEFAULT_LAYOUT, "bento", "dock", "sidebar", "zen", "edges"}
DEFAULT_SIDEBAR_SIDE = "left"
SIDEBAR_SIDES = {DEFAULT_SIDEBAR_SIDE, "right"}
DEFAULT_GLASS_BLUR = 16
DEFAULT_GLASS_OPACITY = 74
THEME_DEFAULTS = {
    "theme": "dusk",
    "color_theme": "nos",
    "accent": "blue",
    "custom_accent": "#83b8ff",
    "text_color": "auto",
    "custom_text_color": DEFAULT_TEXT_COLOR,
    "rating_colors": "auto",
    **DEFAULT_RATING_COLORS,
    "font_family": DEFAULT_FONT,
}
# Interface languages. Vietnamese is the source language; every other code
# needs a pack in assets/i18n-<code>.js. Adding a new code to LANGUAGES
# automatically enables auto-detection in resolve_system_language().
DEFAULT_LANGUAGE = "vi"
FALLBACK_INTERNATIONAL_LANGUAGE = "en"
LANGUAGE_AUTO = "auto"
LANGUAGES = {DEFAULT_LANGUAGE, "en", "zh-cn"}
LANGUAGE_PREFERENCES = {LANGUAGE_AUTO, *LANGUAGES}
# Optional regional aliases for installed & future language packs (e.g. zh-cn, zh-tw, pt-br).
LANGUAGE_ALIASES = {
    "zh": "zh-cn",
    "zh_cn": "zh-cn",
    "zh_hans": "zh-cn",
    "zh_hans_cn": "zh-cn",
    "zh_hans_sg": "zh-cn",
    "zh_sg": "zh-cn",
    "zh_tw": "zh-tw",
    "zh_hant": "zh-tw",
    "zh_hant_tw": "zh-tw",
    "zh_hk": "zh-tw",
    "zh_hant_hk": "zh-tw",
    "pt_br": "pt-br",
    "nb": "no",
}


def resolve_system_language(
    raw_locale: object,
    supported: set[str] | frozenset[str] = LANGUAGES,
) -> str:
    """Resolve an Anki/OS locale tag (e.g. 'vi_VN', 'en_US', 'ja_JP', 'zh-CN')
    to the best installed language pack in `supported`.

    Matching order (extensible for future packs):
      1. Exact alias match (e.g. 'zh_cn' -> 'zh-cn')
      2. Exact tag match (underscore or hyphen form)
      3. Base language match (e.g. 'ja_JP' -> 'ja', 'vi_VN' -> 'vi') — skipped if
         an explicit regional alias mapped to a different uninstalled variant (e.g. zh_TW -> zh-tw)
      4. International English fallback ('en') when a non-empty locale is unsupported
      5. DEFAULT_LANGUAGE when locale is missing/empty
    """
    if isinstance(raw_locale, str):
        normalized = raw_locale.strip().replace("-", "_").lower()
        if normalized:
            aliased = LANGUAGE_ALIASES.get(normalized)
            if aliased:
                if aliased in supported:
                    return aliased
                if FALLBACK_INTERNATIONAL_LANGUAGE in supported:
                    return FALLBACK_INTERNATIONAL_LANGUAGE
                return DEFAULT_LANGUAGE
            hyphenated = normalized.replace("_", "-")
            for candidate in (normalized, hyphenated):
                if candidate in supported:
                    return candidate
            base = normalized.split("_", 1)[0]
            aliased_base = LANGUAGE_ALIASES.get(base)
            if aliased_base and aliased_base in supported:
                return aliased_base
            if base in supported:
                return base
            if FALLBACK_INTERNATIONAL_LANGUAGE in supported:
                return FALLBACK_INTERNATIONAL_LANGUAGE
    return DEFAULT_LANGUAGE


def clean_theme_settings(raw: object) -> dict:
    if not isinstance(raw, dict):
        return {}
    result = {}
    for key, choices in (("theme", THEME_MODES), ("color_theme", COLOR_THEMES),
                         ("accent", ACCENTS), ("text_color", TEXT_COLOR_MODES),
                         ("rating_colors", RATING_COLOR_MODES), ("font_family", FONT_FAMILIES),
                         ("layout", DASHBOARD_LAYOUTS), ("sidebar_side", SIDEBAR_SIDES),
                         ("language", LANGUAGE_PREFERENCES)):
        value = raw.get(key)
        if isinstance(value, str) and value in choices:
            result[key] = value
    for hex_key in ("custom_accent", "custom_text_color", *DEFAULT_RATING_COLORS):
        color = raw.get(hex_key)
        if isinstance(color, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", color):
            result[hex_key] = color.lower()
    overrides = raw.get("theme_overrides")
    if isinstance(overrides, dict):
        result["theme_overrides"] = {
            role: color.lower() for role in THEME_COLOR_ROLES
            if isinstance(color := overrides.get(role), str) and re.fullmatch(r"#[0-9a-fA-F]{6}", color)
        }
    glass_blur = raw.get("glass_blur")
    if type(glass_blur) is int and 0 <= glass_blur <= 32:
        result["glass_blur"] = glass_blur
    glass_opacity = raw.get("glass_opacity")
    if type(glass_opacity) is int and 30 <= glass_opacity <= 100:
        result["glass_opacity"] = glass_opacity
    card_opacity = raw.get("reviewer_card_opacity")
    if type(card_opacity) is int and 20 <= card_opacity <= 100:
        result["reviewer_card_opacity"] = card_opacity
    return result
