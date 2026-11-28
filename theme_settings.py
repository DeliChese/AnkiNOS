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
CUSTOM_UI_MAX_PRESETS = 12
CUSTOM_UI_MAX_BLOCKS = 16
CUSTOM_UI_MODES = {"freeform", "grid"}
CUSTOM_UI_COLUMNS = {"auto", "1", "2"}
CUSTOM_UI_WIDTHS = {"compact", "normal", "wide"}
CUSTOM_UI_GREETING_ALIGNS = {"default", "center"}
CUSTOM_UI_SPANS = {"auto", "half", "full"}
CUSTOM_UI_CORE_BLOCKS = ("greeting", "goal", "activity", "launchpad")
CUSTOM_UI_BLOCK_TYPES = {"greeting", "goal", "activity", "launchpad", "toolbox", "quick_stats", "clock", "memo", "shortcuts"}
CUSTOM_UI_TOOLBOX_STYLES = {"dock", "rail", "grid", "pill"}
CUSTOM_UI_NAV_PLACEMENTS = {"default", "left", "right", "top", "bottom", "floating", "hidden"}
CUSTOM_UI_NAV_ORIENTATIONS = {"auto", "vertical", "horizontal"}
CUSTOM_UI_NAV_ITEMS = ("home", "daily", "stats", "library", "notebook", "appearance", "preferences", "launcher")
CUSTOM_UI_TOOLS = {
    "home", "daily", "stats", "library", "notebook", "appearance", "preferences", "launcher",
    "add_cards", "browse", "sync", "import", "export", "studio", "commands", "fullscreen", "guide", "changelog",
}
_CUSTOM_ID_RE = re.compile(r"[A-Za-z0-9_-]{1,40}")
_CTRL_SPACE_RE = re.compile(r"[\x00-\x1f\x7f]+")
_CTRL_KEEP_NL_RE = re.compile(r"[\x00-\x09\x0b-\x1f\x7f]+")


def _clean_nav(raw: object) -> dict:
    if not isinstance(raw, dict):
        return {"placement": "default", "orientation": "auto", "x": 20, "y": 90, "order": list(CUSTOM_UI_NAV_ITEMS), "hidden": []}
    placement = raw.get("placement")
    if not isinstance(placement, str) or placement not in CUSTOM_UI_NAV_PLACEMENTS:
        placement = "default"
    orientation = raw.get("orientation")
    if not isinstance(orientation, str) or orientation not in CUSTOM_UI_NAV_ORIENTATIONS:
        orientation = "auto"
    x = max(0, min(2400, raw["x"])) if type(raw.get("x")) is int else 20
    y = max(0, min(1600, raw["y"])) if type(raw.get("y")) is int else 90
    raw_order = raw.get("order")
    order: list[str] = []
    if isinstance(raw_order, list):
        for item in raw_order:
            if isinstance(item, str) and item in CUSTOM_UI_NAV_ITEMS and item not in order:
                order.append(item)
    for item in CUSTOM_UI_NAV_ITEMS:
        if item not in order:
            order.append(item)
    raw_hidden = raw.get("hidden")
    hidden: list[str] = []
    if isinstance(raw_hidden, list):
        for item in raw_hidden:
            if isinstance(item, str) and item in CUSTOM_UI_NAV_ITEMS and item not in hidden:
                hidden.append(item)
    return {"placement": placement, "orientation": orientation, "x": x, "y": y, "order": order, "hidden": hidden}


def clean_custom_ui_presets(raw: object) -> list[dict]:
    """Validate and sanitize user-created Custom UI layout presets."""
    if not isinstance(raw, list):
        return []
    out: list[dict] = []
    seen_preset_ids: set[str] = set()
    for item in raw:
        if len(out) >= CUSTOM_UI_MAX_PRESETS:
            break
        if not isinstance(item, dict):
            continue
        pid = item.get("id")
        if not isinstance(pid, str) or not _CUSTOM_ID_RE.fullmatch(pid) or pid in seen_preset_ids:
            continue
        raw_name = item.get("name")
        name = _CTRL_SPACE_RE.sub(" ", raw_name).strip()[:48] if isinstance(raw_name, str) else ""
        if not name:
            name = "Bố cục tùy chỉnh"
        base = item.get("base")
        if not isinstance(base, str) or base not in DASHBOARD_LAYOUTS:
            base = DEFAULT_LAYOUT
        mode = item.get("mode")
        if not isinstance(mode, str) or mode not in CUSTOM_UI_MODES:
            mode = "grid"
        snap = item.get("snap") if type(item.get("snap")) is bool else True
        columns = item.get("columns")
        if not isinstance(columns, str) or columns not in CUSTOM_UI_COLUMNS:
            columns = "auto"
        gap = item.get("gap")
        gap = max(8, min(32, gap)) if type(gap) is int else 18
        radius = item.get("radius")
        radius = max(10, min(30, radius)) if type(radius) is int else 22
        width = item.get("width")
        if not isinstance(width, str) or width not in CUSTOM_UI_WIDTHS:
            width = "normal"
        show_topbar = item.get("show_topbar") if type(item.get("show_topbar")) is bool else True
        show_greeting = item.get("show_greeting") if type(item.get("show_greeting")) is bool else True
        show_goal = item.get("show_goal") if type(item.get("show_goal")) is bool else True
        greeting_align = item.get("greeting_align")
        if not isinstance(greeting_align, str) or greeting_align not in CUSTOM_UI_GREETING_ALIGNS:
            greeting_align = "default"
        nav = _clean_nav(item.get("nav"))
        raw_blocks = item.get("blocks")
        blocks: list[dict] = []
        seen_block_ids: set[str] = set()
        seen_core: set[str] = set()
        if isinstance(raw_blocks, list):
            for blk in raw_blocks:
                if len(blocks) >= CUSTOM_UI_MAX_BLOCKS:
                    break
                if not isinstance(blk, dict):
                    continue
                btype = blk.get("type")
                if not isinstance(btype, str) or btype not in CUSTOM_UI_BLOCK_TYPES:
                    continue
                if btype in CUSTOM_UI_CORE_BLOCKS:
                    if btype in seen_core:
                        continue
                    bid = btype
                    seen_core.add(btype)
                else:
                    bid = blk.get("id")
                    if not isinstance(bid, str) or not _CUSTOM_ID_RE.fullmatch(bid):
                        continue
                if bid in seen_block_ids:
                    continue
                seen_block_ids.add(bid)
                span = blk.get("span")
                if not isinstance(span, str) or span not in CUSTOM_UI_SPANS:
                    span = "auto"
                hidden = blk.get("hidden") if type(blk.get("hidden")) is bool else False
                entry: dict = {"id": bid, "type": btype, "span": span, "hidden": hidden}
                for coord, hi in (("x", 2400), ("y", 2400)):
                    if type(blk.get(coord)) is int:
                        entry[coord] = max(0, min(hi, blk[coord]))
                if type(blk.get("w")) is int:
                    entry["w"] = 0 if blk["w"] <= 0 else max(140, min(1600, blk["w"]))
                if type(blk.get("h")) is int:
                    entry["h"] = 0 if blk["h"] <= 0 else max(56, min(1200, blk["h"]))
                if type(blk.get("z")) is int:
                    entry["z"] = max(1, min(50, blk["z"]))
                if btype not in CUSTOM_UI_CORE_BLOCKS:
                    raw_title = blk.get("title")
                    if isinstance(raw_title, str):
                        title = _CTRL_SPACE_RE.sub(" ", raw_title).strip()[:60]
                        if title:
                            entry["title"] = title
                    raw_body = blk.get("body")
                    if isinstance(raw_body, str):
                        body = _CTRL_KEEP_NL_RE.sub("", raw_body).strip()[:320]
                        if body:
                            entry["body"] = body
                if btype == "toolbox":
                    style = blk.get("style")
                    entry["style"] = style if isinstance(style, str) and style in CUSTOM_UI_TOOLBOX_STYLES else "dock"
                    raw_tools = blk.get("tools")
                    tools: list[str] = []
                    if isinstance(raw_tools, list):
                        for t in raw_tools:
                            if isinstance(t, str) and t in CUSTOM_UI_TOOLS and t not in tools and len(tools) < 16:
                                tools.append(t)
                    if not tools:
                        tools = ["add_cards", "browse", "daily", "stats", "notebook", "sync"]
                    entry["tools"] = tools
                blocks.append(entry)
        for core in ("activity", "launchpad"):
            if core not in seen_core:
                blocks.append({"id": core, "type": core, "span": "auto", "hidden": False})
        seen_preset_ids.add(pid)
        out.append({
            "id": pid,
            "name": name,
            "base": base,
            "mode": mode,
            "snap": snap,
            "columns": columns,
            "gap": gap,
            "radius": radius,
            "width": width,
            "show_topbar": show_topbar,
            "show_greeting": show_greeting,
            "show_goal": show_goal,
            "greeting_align": greeting_align,
            "nav": nav,
            "blocks": blocks,
        })
    return out
THEME_DEFAULTS = {
    "theme": "dusk",
    "surface_style": "frosted",
    "motion_preset": "fade",
    "motion_duration": 220,
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
                         ("language", LANGUAGE_PREFERENCES),
                         ("surface_style", {"frosted", "liquid"}),
                         ("motion_preset", {"none", "fade", "rise", "slide", "zoom", "spring"})):
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
    duration = raw.get("motion_duration")
    if type(duration) is int and 120 <= duration <= 480:
        result["motion_duration"] = duration
    glass_blur = raw.get("glass_blur")
    if type(glass_blur) is int and 0 <= glass_blur <= 32:
        result["glass_blur"] = glass_blur
    glass_opacity = raw.get("glass_opacity")
    if type(glass_opacity) is int and 30 <= glass_opacity <= 100:
        result["glass_opacity"] = glass_opacity
    card_opacity = raw.get("reviewer_card_opacity")
    if type(card_opacity) is int and 20 <= card_opacity <= 100:
        result["reviewer_card_opacity"] = card_opacity
    if "custom_ui_presets" in raw and isinstance(raw.get("custom_ui_presets"), list):
        result["custom_ui_presets"] = clean_custom_ui_presets(raw["custom_ui_presets"])
    if "custom_ui_active" in raw and isinstance(raw.get("custom_ui_active"), str):
        active_id = raw["custom_ui_active"].strip()
        if active_id == "" or _CUSTOM_ID_RE.fullmatch(active_id):
            result["custom_ui_active"] = active_id
    return result
