"""Appearance validation at the persistence boundary; no Qt required."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("nos_theme_test", Path(__file__).resolve().parents[1] / "theme_settings.py")
theme = importlib.util.module_from_spec(spec)
spec.loader.exec_module(theme)


class ThemeTests(unittest.TestCase):
    def test_current_preferences_remain_compatible(self):
        for mode in ("dusk", "night", "oled", "light"):
            self.assertEqual(theme.clean_theme_settings({"theme": mode, "accent": "blue"}), {"theme": mode, "accent": "blue"})

    def test_material_and_motion_values_are_validated(self):
        valid = {"surface_style": "liquid", "motion_preset": "spring", "motion_duration": 320}
        self.assertEqual(theme.clean_theme_settings(valid), valid)
        invalid = {"surface_style": [], "motion_preset": "invalid", "motion_duration": True}
        self.assertEqual(theme.clean_theme_settings(invalid), {})

    def test_custom_and_automatic_colors_survive_validation(self):
        self.assertEqual(theme.clean_theme_settings({"theme": "system", "color_theme": "rosepine", "accent": "custom", "custom_accent": "#Ab12CD"}),
                         {"theme": "system", "color_theme": "rosepine", "accent": "custom", "custom_accent": "#ab12cd"})
        for palette in theme.COLOR_THEMES:
            self.assertEqual(theme.clean_theme_settings({"color_theme": palette, "accent": "auto"}), {"color_theme": palette, "accent": "auto"})

    def test_malformed_webview_or_import_data_is_ignored(self):
        for value in (None, [], {}, 42, False, "unknown", "url(https://example.com)"):
            self.assertEqual(theme.clean_theme_settings({key: value for key in (*theme.THEME_DEFAULTS, "layout")}), {})
        for color in ("red", "#abc", "#11223344", "#123456; color:red", "#gg1122"):
            self.assertEqual(theme.clean_theme_settings({"custom_accent": color}), {})

    def test_component_colors_are_normalized_and_resettable(self):
        clean = theme.clean_theme_settings
        self.assertEqual(clean({"theme_overrides": {"surface": "#ABCDEF", "danger": "invalid", "unknown": "#123456"}}),
                         {"theme_overrides": {"surface": "#abcdef"}})
        self.assertEqual(clean({"theme_overrides": {}}), {"theme_overrides": {}})
        self.assertEqual(clean({"theme_overrides": []}), {})

    def test_layouts_are_validated_independently_of_the_palette(self):
        for layout in ("aurora", "bento", "dock", "sidebar", "zen", "edges"):
            settings = {"layout": layout, "color_theme": "mononoke"}
            self.assertEqual(theme.clean_theme_settings(settings), settings)

    def test_sidebar_side_is_validated(self):
        for side in ("left", "right"):
            self.assertEqual(theme.clean_theme_settings({"sidebar_side": side}), {"sidebar_side": side})
        for invalid in ("top", "bottom", "", None, 123, True):
            self.assertEqual(theme.clean_theme_settings({"sidebar_side": invalid}), {})

    def test_glassmorphism_sliders_are_validated(self):
        self.assertEqual(theme.clean_theme_settings({"glass_blur": 24, "glass_opacity": 60}), {"glass_blur": 24, "glass_opacity": 60})
        self.assertEqual(theme.clean_theme_settings({"glass_blur": 0, "glass_opacity": 30}), {"glass_blur": 0, "glass_opacity": 30})
        self.assertEqual(theme.clean_theme_settings({"glass_blur": 32, "glass_opacity": 100}), {"glass_blur": 32, "glass_opacity": 100})
        for bad in (-1, 33, "16", True, None, 16.5):
            self.assertEqual(theme.clean_theme_settings({"glass_blur": bad}), {})
        for bad in (29, 101, "74", False, None, 74.5):
            self.assertEqual(theme.clean_theme_settings({"glass_opacity": bad}), {})

    def test_language_is_validated(self):
        for code in ("auto", "vi", "en", "zh-cn"):
            self.assertEqual(theme.clean_theme_settings({"language": code}), {"language": code})
        for invalid in ("fr", "EN", "ZH-CN", "", None, 1, True, ["en"]):
            self.assertEqual(theme.clean_theme_settings({"language": invalid}), {})
        self.assertIn(theme.DEFAULT_LANGUAGE, theme.LANGUAGES)

    def test_extensible_auto_language_resolution(self):
        # Current installed packs: vi + en + zh-cn
        self.assertEqual(theme.resolve_system_language("vi_VN"), "vi")
        self.assertEqual(theme.resolve_system_language("vi"), "vi")
        self.assertEqual(theme.resolve_system_language("en_US"), "en")
        self.assertEqual(theme.resolve_system_language("en-GB"), "en")
        self.assertEqual(theme.resolve_system_language("zh_CN"), "zh-cn")
        self.assertEqual(theme.resolve_system_language("zh-Hans"), "zh-cn")
        self.assertEqual(theme.resolve_system_language("zh"), "zh-cn")
        # Traditional Chinese and unsupported locales fall back to English
        self.assertEqual(theme.resolve_system_language("zh_TW"), "en")
        self.assertEqual(theme.resolve_system_language("ja_JP"), "en")
        self.assertEqual(theme.resolve_system_language("fr_FR"), "en")
        # Empty/missing locale falls back to DEFAULT_LANGUAGE
        self.assertEqual(theme.resolve_system_language(""), theme.DEFAULT_LANGUAGE)
        self.assertEqual(theme.resolve_system_language(None), theme.DEFAULT_LANGUAGE)
        # Future i18n expansion: simply adding packs to `supported` enables automatic matching
        future = {"vi", "en", "ja", "zh-cn", "zh-tw", "pt-br", "ko"}
        self.assertEqual(theme.resolve_system_language("ja_JP", future), "ja")
        self.assertEqual(theme.resolve_system_language("zh_CN", future), "zh-cn")
        self.assertEqual(theme.resolve_system_language("zh-Hans", future), "zh-cn")
        self.assertEqual(theme.resolve_system_language("zh_TW", future), "zh-tw")
        self.assertEqual(theme.resolve_system_language("pt_BR", future), "pt-br")
        self.assertEqual(theme.resolve_system_language("ko-KR", future), "ko")
        self.assertEqual(theme.resolve_system_language("de_DE", future), "en")

    def test_sixteen_palettes_and_font_library_are_validated(self):
        self.assertEqual(len(theme.COLOR_THEMES), 16)
        for palette in ("gruvbox", "everforest", "kanagawa", "sakura", "matcha", "synthwave", "espresso", "oceanic"):
            self.assertEqual(theme.clean_theme_settings({"color_theme": palette}), {"color_theme": palette})
        self.assertEqual(len(theme.FONT_FAMILIES), 8)
        for font in theme.FONT_FAMILIES:
            self.assertEqual(theme.clean_theme_settings({"font_family": font}), {"font_family": font})
        for bad in ("comic-sans", "", None, 123, True, ["serif"]):
            self.assertEqual(theme.clean_theme_settings({"font_family": bad}), {})
        self.assertIn(theme.DEFAULT_FONT, theme.FONT_FAMILIES)

    def test_text_color_and_reviewer_customization_are_validated(self):
        valid = {
            "text_color": "custom",
            "custom_text_color": "#F5E6C8",
            "rating_colors": "custom",
            "rating_color_again": "#FF3355",
            "rating_color_hard": "#EEAA22",
            "rating_color_good": "#3399FF",
            "rating_color_easy": "#22CC88",
            "reviewer_card_opacity": 64,
        }
        cleaned = theme.clean_theme_settings(valid)
        self.assertEqual(cleaned["text_color"], "custom")
        self.assertEqual(cleaned["custom_text_color"], "#f5e6c8")
        self.assertEqual(cleaned["rating_colors"], "custom")
        self.assertEqual(cleaned["rating_color_again"], "#ff3355")
        self.assertEqual(cleaned["rating_color_easy"], "#22cc88")
        self.assertEqual(cleaned["reviewer_card_opacity"], 64)
        for bad in (19, 101, "64", True, None, 64.5):
            self.assertEqual(theme.clean_theme_settings({"reviewer_card_opacity": bad}), {})
        for bad_hex in ("white", "#fff", "#12345678", "#zzzzzz", 123):
            self.assertEqual(theme.clean_theme_settings({"custom_text_color": bad_hex, "rating_color_again": bad_hex}), {})
        for bad_mode in ("manual", "", None, 1, True):
            self.assertEqual(theme.clean_theme_settings({"text_color": bad_mode, "rating_colors": bad_mode}), {})

    def test_custom_ui_presets_are_validated_and_sanitized(self):
        cleaned = theme.clean_theme_settings({
            "custom_ui_active": "preset_1",
            "custom_ui_presets": [
                {
                    "id": "preset_1",
                    "name": "  Góc học\nriêng  ",
                    "base": "bento",
                    "mode": "freeform",
                    "snap": False,
                    "show_topbar": False,
                    "columns": "2",
                    "gap": 99,
                    "radius": 4,
                    "width": "compact",
                    "show_greeting": False,
                    "show_goal": True,
                    "greeting_align": "center",
                    "nav": {
                        "placement": "floating",
                        "orientation": "horizontal",
                        "x": 120,
                        "y": -50,
                        "order": ["stats", "home", "invalid_nav"],
                        "hidden": ["notebook", "bad_key"],
                    },
                    "blocks": [
                        {"id": "w_memo", "type": "memo", "title": "  Nhắc\tnhở ", "body": "Dòng 1\nDòng 2\x00", "span": "full", "hidden": False, "x": 48, "y": 96, "w": 5000, "h": 20, "z": 99},
                        {"id": "w_tb", "type": "toolbox", "title": "Thanh nhanh", "style": "pill", "tools": ["sync", "add_cards", "evil_tool"], "x": 12, "y": 12, "w": 300, "h": 72},
                        {"id": "launchpad", "type": "launchpad", "span": "half", "hidden": False},
                        {"id": "../bad", "type": "clock", "span": "half"},
                        {"id": "w_unknown", "type": "evil_script"},
                    ],
                },
                {"id": "../invalid", "name": "Bad"},
            ],
        })
        self.assertEqual(cleaned["custom_ui_active"], "preset_1")
        self.assertEqual(len(cleaned["custom_ui_presets"]), 1)
        preset = cleaned["custom_ui_presets"][0]
        self.assertEqual(preset["name"], "Góc học riêng")
        self.assertEqual(preset["base"], "bento")
        self.assertEqual(preset["mode"], "freeform")
        self.assertFalse(preset["snap"])
        self.assertFalse(preset["show_topbar"])
        self.assertEqual(preset["gap"], 32)
        self.assertEqual(preset["radius"], 10)
        self.assertFalse(preset["show_greeting"])
        self.assertEqual(preset["nav"]["placement"], "floating")
        self.assertEqual(preset["nav"]["orientation"], "horizontal")
        self.assertEqual(preset["nav"]["x"], 120)
        self.assertEqual(preset["nav"]["y"], 0)
        self.assertEqual(preset["nav"]["order"][:2], ["stats", "home"])
        self.assertEqual(preset["nav"]["hidden"], ["notebook"])
        # Core block `activity` is auto-restored if omitted; malformed widgets are dropped.
        self.assertEqual([b["id"] for b in preset["blocks"]], ["w_memo", "w_tb", "launchpad", "activity"])
        self.assertEqual(preset["blocks"][0]["title"], "Nhắc nhở")
        self.assertEqual(preset["blocks"][0]["body"], "Dòng 1\nDòng 2")
        self.assertEqual(preset["blocks"][0]["w"], 1600)
        self.assertEqual(preset["blocks"][0]["h"], 56)
        self.assertEqual(preset["blocks"][0]["z"], 50)
        self.assertEqual(preset["blocks"][1]["style"], "pill")
        self.assertEqual(preset["blocks"][1]["tools"], ["sync", "add_cards"])
        self.assertEqual(theme.clean_theme_settings({"custom_ui_active": "../bad"}), {})


if __name__ == "__main__":
    unittest.main()
