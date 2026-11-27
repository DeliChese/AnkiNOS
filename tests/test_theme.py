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
        for code in ("vi", "en"):
            self.assertEqual(theme.clean_theme_settings({"language": code}), {"language": code})
        for invalid in ("fr", "EN", "", None, 1, True, ["en"]):
            self.assertEqual(theme.clean_theme_settings({"language": invalid}), {})
        self.assertIn(theme.DEFAULT_LANGUAGE, theme.LANGUAGES)


if __name__ == "__main__":
    unittest.main()
